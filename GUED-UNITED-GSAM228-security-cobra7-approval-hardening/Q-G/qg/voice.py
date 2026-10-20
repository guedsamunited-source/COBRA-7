from __future__ import annotations

import base64
import os
from typing import Any

import httpx


class VoiceError(RuntimeError):
    pass


def _url(name: str) -> str:
    url = os.getenv(name, "").strip()
    if not url.startswith("https://"):
        raise VoiceError(f"{name} must be configured with HTTPS")
    return url


async def transcribe(audio: bytes, content_type: str) -> str:
    if not audio or len(audio) > 10_000_000:
        raise ValueError("Audio must be between 1 byte and 10 MB")
    url = _url("QG_STT_URL")
    key = os.getenv("QG_STT_API_KEY", "")
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    files = {"audio": ("audio", audio, content_type)}
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        response = await client.post(url, headers=headers, files=files)
    if response.status_code >= 400:
        raise VoiceError(f"STT provider returned HTTP {response.status_code}")
    data = response.json()
    text = data.get("text") if isinstance(data, dict) else None
    if not isinstance(text, str) or not text.strip():
        raise VoiceError("STT provider returned no text")
    return text[:16_000]


async def synthesize(text: str, voice: str = "default") -> tuple[bytes, str]:
    if not text or len(text) > 16_000:
        raise ValueError("Text is empty or too long")
    url = _url("QG_TTS_URL")
    key = os.getenv("QG_TTS_API_KEY", "")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"} if key else {"Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        response = await client.post(url, headers=headers, json={"text": text, "voice": voice})
    if response.status_code >= 400:
        raise VoiceError(f"TTS provider returned HTTP {response.status_code}")
    data: Any = response.json()
    if not isinstance(data, dict) or not isinstance(data.get("audio_base64"), str):
        raise VoiceError("TTS provider must return audio_base64")
    try:
        audio = base64.b64decode(data["audio_base64"], validate=True)
    except Exception as exc:
        raise VoiceError("Invalid TTS audio payload") from exc
    if len(audio) > 10_000_000:
        raise VoiceError("TTS output too large")
    return audio, str(data.get("content_type", "audio/mpeg"))
