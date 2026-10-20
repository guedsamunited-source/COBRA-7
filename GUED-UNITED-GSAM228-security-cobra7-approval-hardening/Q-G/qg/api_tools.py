from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx


class ApiToolError(RuntimeError):
    pass


def _endpoint(name: str) -> str:
    raw = os.getenv(f"QG_API_{name.upper()}_URL", "").strip()
    if not raw:
        raise ApiToolError(f"API tool {name} is not configured")
    parsed = urlparse(raw)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ApiToolError("Configured API tools must use HTTPS")
    return raw


async def call_api(name: str, payload: dict, timeout: float = 15) -> dict:
    if not name.replace("_", "").isalnum() or len(name) > 40:
        raise ValueError("Invalid API tool name")
    endpoint = _endpoint(name)
    key = os.getenv(f"QG_API_{name.upper()}_KEY", "")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"} if key else {"Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        response = await client.post(endpoint, headers=headers, json=payload)
    if response.status_code >= 400:
        raise ApiToolError(f"API tool returned HTTP {response.status_code}")
    data = response.json()
    if not isinstance(data, dict):
        raise ApiToolError("API tool must return a JSON object")
    return data
