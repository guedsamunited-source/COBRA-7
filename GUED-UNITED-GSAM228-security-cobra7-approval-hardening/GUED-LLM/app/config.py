from dataclasses import dataclass
from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

def _int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be an integer") from None
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value

@dataclass(frozen=True)
class Settings:
    provider: str
    ollama_url: str
    ollama_model: str
    openai_base_url: str
    openai_model: str
    openai_api_key: str
    admin_key: str
    host: str
    port: int
    db_path: str
    max_body_bytes: int
    max_message_chars: int
    max_messages: int
    rate_limit_per_minute: int
    request_timeout: int
    allowed_origins: tuple[str, ...]

def load_settings() -> Settings:
    provider = os.getenv("GUED_LLM_PROVIDER", "ollama").strip().lower()
    if provider not in {"ollama", "openai_compat"}:
        raise ValueError("GUED_LLM_PROVIDER must be ollama or openai_compat")
    admin = os.getenv("GUED_LLM_ADMIN_KEY", "").strip()
    if len(admin) < 32:
        raise ValueError("GUED_LLM_ADMIN_KEY must contain at least 32 characters")
    db = Path(os.getenv("GUED_LLM_DB", "data/gued_llm.sqlite3"))
    db.parent.mkdir(parents=True, exist_ok=True)
    origins = tuple(x.strip() for x in os.getenv("GUED_LLM_ALLOWED_ORIGINS", "").split(",") if x.strip())
    return Settings(
        provider=provider,
        ollama_url=os.getenv("GUED_LLM_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/"),
        ollama_model=os.getenv("GUED_LLM_OLLAMA_MODEL", "").strip(),
        openai_base_url=os.getenv("GUED_LLM_OPENAI_BASE_URL", "").rstrip("/"),
        openai_model=os.getenv("GUED_LLM_OPENAI_MODEL", "").strip(),
        openai_api_key=os.getenv("GUED_LLM_OPENAI_API_KEY", ""),
        admin_key=admin,
        host=os.getenv("GUED_LLM_HOST", "127.0.0.1"),
        port=_int("GUED_LLM_PORT", 8080, 1, 65535),
        db_path=str(db),
        max_body_bytes=_int("GUED_LLM_MAX_BODY_BYTES", 1048576, 16384, 16777216),
        max_message_chars=_int("GUED_LLM_MAX_MESSAGE_CHARS", 16000, 256, 100000),
        max_messages=_int("GUED_LLM_MAX_MESSAGES", 40, 1, 200),
        rate_limit_per_minute=_int("GUED_LLM_RATE_LIMIT_PER_MINUTE", 60, 1, 10000),
        request_timeout=_int("GUED_LLM_REQUEST_TIMEOUT", 120, 5, 600),
        allowed_origins=origins,
    )

settings = load_settings()
