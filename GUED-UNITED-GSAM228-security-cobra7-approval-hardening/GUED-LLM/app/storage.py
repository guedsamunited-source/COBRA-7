from __future__ import annotations
import sqlite3, threading, time, secrets
from pathlib import Path

class RuntimeStore:
    """Persistent conversations and security audit events, isolated from credentials."""
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.RLock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA foreign_keys=ON")
            db.execute("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_id, updated_at DESC)")
            db.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, id)")
            db.execute("CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, agent_id TEXT, event TEXT NOT NULL, status INTEGER NOT NULL, latency_ms INTEGER NOT NULL, created_at INTEGER NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_events(created_at DESC)")
            db.commit()

    def _connect(self):
        return sqlite3.connect(self.db_path, timeout=10)

    def conversation(self, agent_id: str, conversation_id: str | None) -> str:
        now = int(time.time())
        with self._lock, self._connect() as db:
            if conversation_id:
                row = db.execute("SELECT id FROM conversations WHERE id=? AND agent_id=?", (conversation_id, agent_id)).fetchone()
                if row:
                    db.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now, conversation_id)); db.commit(); return conversation_id
            cid = "conv_" + secrets.token_urlsafe(18)
            db.execute("INSERT INTO conversations VALUES (?, ?, ?, ?)", (cid, agent_id, now, now)); db.commit(); return cid

    def history(self, agent_id: str, conversation_id: str, limit: int):
        with self._connect() as db:
            rows = db.execute("SELECT m.role,m.content FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.id=? AND c.agent_id=? ORDER BY m.id DESC LIMIT ?", (conversation_id, agent_id, limit)).fetchall()
        return [{"role": r[0], "content": r[1]} for r in reversed(rows)]

    def append(self, agent_id: str, conversation_id: str, role: str, content: str):
        now = int(time.time())
        with self._lock, self._connect() as db:
            ok = db.execute("SELECT 1 FROM conversations WHERE id=? AND agent_id=?", (conversation_id, agent_id)).fetchone()
            if not ok: raise ValueError("Conversation does not belong to agent")
            db.execute("INSERT INTO messages(conversation_id,role,content,created_at) VALUES (?,?,?,?)", (conversation_id, role, content, now))
            db.execute("UPDATE conversations SET updated_at=? WHERE id=?", (now, conversation_id)); db.commit()

    def audit(self, request_id: str, agent_id: str | None, event: str, status: int, latency_ms: int):
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO audit_events(request_id,agent_id,event,status,latency_ms,created_at) VALUES (?,?,?,?,?,?)", (request_id, agent_id, event, status, latency_ms, int(time.time()))); db.commit()

    def usage(self, agent_id: str, since: int) -> int:
        with self._connect() as db:
            row = db.execute("SELECT COUNT(*) FROM audit_events WHERE agent_id=? AND created_at>=?", (agent_id, since)).fetchone()
            return int(row[0])
