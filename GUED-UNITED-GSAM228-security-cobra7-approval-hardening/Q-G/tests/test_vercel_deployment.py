from pathlib import Path
import tomllib


def test_vercel_entrypoint_is_configured():
    config = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
    assert config["tool"]["vercel"]["entrypoint"] == "qg.vercel_app:app"


def test_vercel_entrypoint_exports_fastapi_app():
    from qg.vercel_app import app

    assert app.title == "Q-G / COBRA-7"
    assert any(route.path == "/health" for route in app.routes)
