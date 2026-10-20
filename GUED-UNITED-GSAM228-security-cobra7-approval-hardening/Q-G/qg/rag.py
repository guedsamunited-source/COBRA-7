from __future__ import annotations

import re
import sqlite3
from pathlib import Path


class RagStore:
    """Small local RAG store with bounded text and deterministic lexical retrieval."""

    def __init__(self, path: str = "data/rag.sqlite3"):
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(p, check_same_thread=False)
        self.db.execute("CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, title TEXT, content TEXT NOT NULL)")
        self.db.commit()

    def add(self, title: str, content: str) -> int:
        if not title or len(title) > 500 or not content or len(content) > 500_000:
            raise ValueError("Invalid RAG document")
        cur = self.db.execute("INSERT INTO documents(title,content) VALUES(?,?)", (title, content))
        self.db.commit()
        return int(cur.lastrowid)

    def search(self, query: str, limit: int = 5) -> list[dict[str, str]]:
        terms = set(re.findall(r"[\wÀ-ÿ]{3,}", query.lower()))
        rows = self.db.execute("SELECT id,title,content FROM documents").fetchall()
        scored = []
        for ident, title, content in rows:
            hay = (title + " " + content).lower()
            score = sum(hay.count(term) for term in terms)
            if score:
                scored.append((score, ident, title, content[:5000]))
        scored.sort(reverse=True)
        return [{"id": str(i), "title": t, "content": c} for _, i, t, c in scored[:max(1, min(limit, 10))]]
