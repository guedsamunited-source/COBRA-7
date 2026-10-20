from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any

import httpx


class QGError(RuntimeError):
    pass


@dataclass(frozen=True)
class QGConfig:
    base_url: str
    api_key: str
    timeout: float = 60.0
    max_retries: int = 2


class GUEDLLMClient:
    """Small, bounded client for the GUED-LLM agent API."""

    def __init__(self, config: QGConfig):
        if not config.base_url.startswith("https://") and not config.base_url.startswith("http://127.0.0.1") and not config.base_url.startswith("http://localhost"):
            raise ValueError("GUED-LLM must use HTTPS unless it is local")
        if not config.api_key.startswith("glk_"):
            raise ValueError("Invalid GUED-LLM agent credential")
        self.config = config

    async def chat(self, messages: list[dict[str, str]], model: str = "default", conversation_id: str | None = None, remember: bool = True) -> dict[str, Any]:
        if not messages or len(messages) > 40:
            raise ValueError("messages must contain between 1 and 40 items")
        payload = {"model": model, "messages": messages, "remember": remember}
        if conversation_id:
            payload["conversation_id"] = conversation_id

        headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
        timeout = httpx.Timeout(self.config.timeout)
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            for attempt in range(self.config.max_retries + 1):
                try:
                    response = await client.post(f"{self.config.base_url.rstrip('/')}/v1/chat/completions", headers=headers, json=payload)
                    if response.status_code in {429, 502, 503, 504} and attempt < self.config.max_retries:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    if response.status_code >= 400:
                        raise QGError(f"GUED-LLM request failed with HTTP {response.status_code}")
                    return response.json()
                except (httpx.TimeoutException, httpx.NetworkError) as exc:
                    last_error = exc
                    if attempt < self.config.max_retries:
                        await asyncio.sleep(2 ** attempt)
                    else:
                        raise QGError("GUED-LLM is temporarily unavailable") from exc
        raise QGError("GUED-LLM request failed") from last_error


async def build_client() -> GUEDLLMClient:
    base_url = os.getenv("GUED_LLM_URL", "http://127.0.0.1:8080")
    key = os.getenv("COBRA7_GUED_LLM_KEY", "")
    return GUEDLLMClient(QGConfig(base_url=base_url, api_key=key))
