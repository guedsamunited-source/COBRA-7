from __future__ import annotations

from dataclasses import dataclass, field
from time import time


@dataclass
class MemoryItem:
    key: str
    value: str
    created_at: float = field(default_factory=time)


class MemoryPolicy:
    def __init__(self, max_items: int = 100):
        self.max_items = max_items


class AgentMemory:
    """Ephemeral, bounded memory for the agent layer; durable memory remains in GUED-LLM."""

    def __init__(self, policy: MemoryPolicy | None = None):
        self.policy = policy or MemoryPolicy()
        self._items: list[MemoryItem] = []

    def put(self, key: str, value: str) -> None:
        if not key or len(value) > 16000:
            raise ValueError("Invalid memory item")
        self._items = [x for x in self._items if x.key != key]
        self._items.append(MemoryItem(key, value))
        self._items = self._items[-self.policy.max_items:]

    def get(self, key: str) -> str | None:
        for item in reversed(self._items):
            if item.key == key:
                return item.value
        return None
