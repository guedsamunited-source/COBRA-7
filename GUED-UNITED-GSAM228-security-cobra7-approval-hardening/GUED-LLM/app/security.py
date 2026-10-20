from __future__ import annotations
import hashlib, hmac, secrets, sqlite3, threading, time
from dataclasses import dataclass
from pathlib import Path

@dataclass(frozen=True)
class AgentIdentity:
    agent_id: str
    name: str

class CredentialStore:
    def __init__(self, db_path: str):
        self.db_path = db_path; self._lock = threading.RLock()
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER)")
            db.execute("CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name)")
            db.commit()
    def _connect(self):
        db = sqlite3.connect(self.db_path, timeout=10); db.row_factory = sqlite3.Row; return db
    @staticmethod
    def _hash(secret: str, salt: bytes | None = None) -> str:
        salt = salt or secrets.token_bytes(16)
        digest = hashlib.scrypt(secret.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
        return f"scrypt${salt.hex()}${digest.hex()}"
    @staticmethod
    def _verify(secret: str, encoded: str) -> bool:
        try:
            scheme, salt_hex, digest_hex = encoded.split("$", 2)
            if scheme != "scrypt": return False
            actual = hashlib.scrypt(secret.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1, dklen=32)
            return hmac.compare_digest(actual, bytes.fromhex(digest_hex))
        except (ValueError, TypeError): return False
    def create(self, name: str):
        agent_id = secrets.token_hex(8); secret = secrets.token_urlsafe(36); token = f"glk_{agent_id}_{secret}"
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO agents VALUES (?, ?, ?, ?, NULL)", (agent_id, name, self._hash(secret), int(time.time()))); db.commit()
        return token, AgentIdentity(agent_id, name)
    def rotate(self, agent_id: str):
        with self._lock, self._connect() as db:
            row = db.execute("SELECT name FROM agents WHERE id=? AND revoked_at IS NULL", (agent_id,)).fetchone()
            if not row: return None
            db.execute("UPDATE agents SET revoked_at=? WHERE id=?", (int(time.time()), agent_id)); db.commit()
        return self.create(row["name"])
    def authenticate(self, token: str):
        parts = token.split("_", 2)
        if len(parts) != 3 or parts[0] != "glk" or len(parts[1]) != 16: return None
        with self._connect() as db:
            row = db.execute("SELECT id,name,secret_hash,revoked_at FROM agents WHERE id=?", (parts[1],)).fetchone()
        if not row or row["revoked_at"] is not None or not self._verify(parts[2], row["secret_hash"]): return None
        return AgentIdentity(row["id"], row["name"])
    def revoke(self, agent_id: str) -> bool:
        with self._lock, self._connect() as db:
            cur = db.execute("UPDATE agents SET revoked_at=? WHERE id=? AND revoked_at IS NULL", (int(time.time()), agent_id)); db.commit(); return cur.rowcount == 1

class RateLimiter:
    def __init__(self, limit: int, window: int = 60): self.limit, self.window, self._lock, self._events = limit, window, threading.Lock(), {}
    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            events = [t for t in self._events.get(key, []) if now-t < self.window]
            if len(events) >= self.limit: self._events[key] = events; return False
            events.append(now); self._events[key] = events
            if len(self._events) > 10000: self._events = {k:v for k,v in self._events.items() if v and now-v[-1] < self.window}
            return True
