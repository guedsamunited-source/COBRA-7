from __future__ import annotations

from dataclasses import dataclass
from time import time


@dataclass(frozen=True)
class AuditEvent:
    event: str
    status: str
    timestamp: float
    request_id: str


class AuditLog:
    def __init__(self, max_events: int = 1000):
        self.max_events = max_events
        self.events: list[AuditEvent] = []

    def record(self, event: str, status: str, request_id: str) -> None:
        self.events.append(AuditEvent(event, status, time(), request_id))
        del self.events[:-self.max_events]
