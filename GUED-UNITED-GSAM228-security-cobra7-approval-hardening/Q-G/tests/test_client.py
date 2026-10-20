import pytest
from qg.client import GUEDLLMClient, QGConfig


def test_rejects_insecure_remote_url():
    with pytest.raises(ValueError):
        GUEDLLMClient(QGConfig("http://example.com", "glk_test"))


def test_accepts_local_url():
    client = GUEDLLMClient(QGConfig("http://127.0.0.1:8080", "glk_test"))
    assert client.config.base_url.startswith("http://127.0.0.1")
