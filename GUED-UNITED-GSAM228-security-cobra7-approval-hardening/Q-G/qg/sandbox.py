from __future__ import annotations

import os
from pathlib import Path


class SandboxError(RuntimeError):
    pass


class FileSandbox:
    """Confines agent file access to an administrator-defined directory."""

    def __init__(self, root: str | None = None, max_bytes: int = 2_000_000):
        self.root = Path(root or os.getenv("QG_SANDBOX_ROOT", "sandbox")).resolve()
        self.max_bytes = max_bytes
        self.root.mkdir(parents=True, exist_ok=True)

    def _safe(self, name: str) -> Path:
        candidate = (self.root / name).resolve()
        if candidate != self.root and self.root not in candidate.parents:
            raise SandboxError("Path escapes sandbox")
        return candidate

    def read(self, name: str) -> str:
        path = self._safe(name)
        if not path.is_file() or path.stat().st_size > self.max_bytes:
            raise SandboxError("File unavailable or too large")
        return path.read_text(encoding="utf-8")

    def write(self, name: str, content: str) -> None:
        if len(content.encode("utf-8")) > self.max_bytes:
            raise SandboxError("File too large")
        path = self._safe(name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
