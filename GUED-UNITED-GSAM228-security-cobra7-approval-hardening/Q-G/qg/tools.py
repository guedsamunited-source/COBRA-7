from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass(frozen=True)
class ToolPermission:
    name: str
    enabled: bool = False
    max_runtime_seconds: int = 10
    max_output_chars: int = 8000


class ToolRegistry:
    """Explicit allowlist. No dynamic imports, shell commands or arbitrary URLs."""

    def __init__(self):
        self._handlers: dict[str, Callable[[dict[str, Any]], Awaitable[Any]]] = {}
        self._permissions: dict[str, ToolPermission] = {}

    def register(self, permission: ToolPermission, handler: Callable[[dict[str, Any]], Awaitable[Any]]) -> None:
        self._permissions[permission.name] = permission
        self._handlers[permission.name] = handler

    def allowed(self, name: str) -> bool:
        permission = self._permissions.get(name)
        return bool(permission and permission.enabled and name in self._handlers)

    def names(self) -> list[str]:
        return sorted(name for name, p in self._permissions.items() if p.enabled)
