"""Deployment entrypoint for the Q-G FastAPI service."""
import os

os.environ.setdefault("QG_RAG_DB", "/tmp/cobra7-rag.sqlite3")
os.environ.setdefault("QG_TASK_DB", "/tmp/cobra7-tasks.sqlite3")
os.environ.setdefault("QG_SANDBOX_ROOT", "/tmp/cobra7-sandbox")

from qg.main import app
