from qg.rag import RagStore
from qg.sandbox import FileSandbox, SandboxError
from qg.tasks import TaskScheduler
import pytest


def test_file_sandbox_blocks_escape(tmp_path):
    box = FileSandbox(str(tmp_path))
    with pytest.raises(SandboxError):
        box.read("../secret.txt")


def test_rag_retrieval_is_bounded(tmp_path):
    store = RagStore(str(tmp_path / "rag.sqlite3"))
    store.add("Togo", "Lome is the capital of Togo")
    assert store.search("capital Togo")


def test_task_scheduler_default_denies_unknown():
    scheduler = TaskScheduler()
    with pytest.raises(ValueError):
        scheduler.schedule("shell", 0, {})
