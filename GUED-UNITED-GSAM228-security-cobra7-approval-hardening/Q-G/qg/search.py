from __future__ import annotations

import os
from urllib.parse import urlparse

import httpx


class SearchError(RuntimeError):
    pass


async def web_search(query: str, limit: int = 5) -> list[dict[str, str]]:
    """Call a configured search provider. The provider URL is administrator-controlled."""
    query = query.strip()
    if not query or len(query) > 1000:
        raise ValueError("Invalid search query")
    endpoint = os.getenv("QG_SEARCH_URL", "").strip()
    if not endpoint:
        raise SearchError("Web search provider is not configured")
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.hostname:
        raise SearchError("Search provider must use HTTPS")
    api_key = os.getenv("QG_SEARCH_API_KEY", "")
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    params = {"q": query, "limit": max(1, min(limit, 10))}
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        response = await client.get(endpoint, params=params, headers=headers)
    if response.status_code >= 400:
        raise SearchError(f"Search provider returned HTTP {response.status_code}")
    data = response.json()
    rows = data.get("results", []) if isinstance(data, dict) else []
    return [
        {"title": str(r.get("title", ""))[:500], "url": str(r.get("url", ""))[:2000], "snippet": str(r.get("snippet", ""))[:2000]}
        for r in rows[:10] if isinstance(r, dict)
    ]
