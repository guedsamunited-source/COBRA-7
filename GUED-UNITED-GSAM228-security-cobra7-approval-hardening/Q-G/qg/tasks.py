from __future__ import annotations

import asyncio
import json
import sqlite3
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Any

@dataclass(frozen=True)
class Task:
    id: str
    run_at: float
    name: str
    payload: dict[str, Any]
    attempts: int = 0
    status: str = "pending"

class TaskScheduler:
    """Durable SQLite task queue. Only registered handlers can run."""

    def __init__(self, path: str = "data/tasks.sqlite3", max_attempts: int = 3, max_payload_bytes: int = 100_000):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.max_attempts = max(1, min(max_attempts, 10))
        self.max_payload_bytes = max(1024, max_payload_bytes)
        self.handlers: dict[str, Callable[[dict[str, Any]], Awaitable[Any]]] = {}
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute(
            "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, run_at REAL NOT NULL, name TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', last_error TEXT)"
        )
        self.db.execute("CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(status, run_at)")
        self.db.execute("UPDATE tasks SET status='pending' WHERE status='running'")
        self.db.commit()
        self._lock = asyncio.Lock()

    def register(self, name: str, handler: Callable[[dict[str, Any]], Awaitable[Any]]) -> None:
        if not name.isidentifier():
            raise ValueError("Invalid task name")
        self.handlers[name] = handler

    def schedule(self, name: str, delay_seconds: int, payload: dict[str, Any]) -> Task:
        if name not in self.handlers or not 0 <= delay_seconds <= 86_400:
            raise ValueError("Task is not permitted")
        encoded = json.dumps(payload, ensure_ascii=False)
        if len(encoded.encode("utf-8")) > self.max_payload_bytes:
            raise ValueError("Task payload is too large")
        task = Task(uuid.uuid4().hex, time.time() + delay_seconds, name, payload)
        self.db.execute(
            "INSERT INTO tasks(id,run_at,name,payload) VALUES(?,?,?,?)",
            (task.id, task.run_at, task.name, encoded),
        )
        self.db.commit()
        return task

    async def run_due(self) -> list[str]:
        done: list[str] = []
        async with self._lock:
            rows = self.db.execute(
                "SELECT id,run_at,name,payload,attempts FROM tasks WHERE status='pending' AND run_at<=? ORDER BY run_at LIMIT 20",
                (time.time(),),
            ).fetchall()
            for ident, run_at, name, payload, attempts in rows:
                self.db.execute("UPDATE tasks SET status='running' WHERE id=? AND status='pending'", (ident,))
                self.db.commit()
                handler = self.handlers.get(name)
                if not handler:
                    self.db.execute("UPDATE tasks SET status='failed',last_error=? WHERE id=?", ("handler_not_registered", ident))
                    self.db.commit()
                    continue
                try:
                    await handler(json.loads(payload))
                except Exception as exc:
                    next_attempt = attempts + 1
                    status = "pending" if next_attempt < self.max_attempts else "failed"
                    delay = min(300, 2 ** next_attempt)
                    self.db.execute(
                        "UPDATE tasks SET status=?,attempts=?,run_at=?,last_error=? WHERE id=?",
                        (status, next_attempt, time.time() + delay, type(exc).__name__, ident),
                    )
                    self.db.commit()
                    continue
                self.db.execute("UPDATE tasks SET status='done' WHERE id=?", (ident,))
                self.db.commit()
                done.append(ident)
        return done

    async def worker(self, interval: float = 1.0) -> None:
        while True:
            await self.run_due()
            await asyncio.sleep(max(0.2, interval))

    def close(self) -> None:
        self.db.close()
