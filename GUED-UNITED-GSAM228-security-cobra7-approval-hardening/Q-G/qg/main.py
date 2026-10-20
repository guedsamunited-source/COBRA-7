from __future__ import annotations

import asyncio
import base64
import hmac
import os
import secrets
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .agent_engine import AgentEngine, AgentProtocolError, ToolPolicy
from .api_tools import ApiToolError, call_api
from .audit import AuditLog
from .client import GUEDLLMClient, QGConfig, QGError
from .rag import RagStore
from .sandbox import FileSandbox, SandboxError
from .search import SearchError, web_search
from .tasks import TaskScheduler
from .voice import VoiceError, synthesize, transcribe

AGENT_NAME = "COBRA-7"
LOCAL_KEY = os.getenv("COBRA7_AGENT_KEY", "")
APPROVAL_KEY = os.getenv("COBRA7_APPROVAL_KEY", "")
GUED_URL = os.getenv("GUED_LLM_URL", "http://127.0.0.1:8080")
GUED_KEY = os.getenv("COBRA7_GUED_LLM_KEY", "")
MAX_AUDIO_B64 = 14_000_000

app = FastAPI(title="Q-G / COBRA-7", version="3.0.0", docs_url=None, redoc_url=None)
audit = AuditLog()
rag = RagStore(os.getenv("QG_RAG_DB", "data/rag.sqlite3"))
sandbox = FileSandbox()
scheduler = TaskScheduler(os.getenv("QG_TASK_DB", "data/tasks.sqlite3"))
worker_task: asyncio.Task | None = None
engine: AgentEngine | None = None

def enabled(name: str) -> bool:
    return os.getenv(name, "false").lower() in {"1", "true", "yes"}

def _key_ok(value: str | None) -> bool:
    return bool(LOCAL_KEY and value and hmac.compare_digest(value, LOCAL_KEY))

def _auth(key: str | None) -> None:
    if not _key_ok(key):
        raise HTTPException(401, "Agent authorization required")


def _approval_auth(key: str | None) -> None:
    # High-risk actions require a credential separate from the general agent key.
    if not APPROVAL_KEY:
        raise HTTPException(503, "Approval authorization is not configured")
    if not key or not hmac.compare_digest(key, APPROVAL_KEY):
        raise HTTPException(401, "Approval authorization required")

def _rid(value: str | None) -> str:
    return value if value and len(value) <= 128 else secrets.token_hex(12)

class ChatBody(BaseModel):
    messages: list[dict[str, str]] = Field(min_length=1, max_length=40)
    model: str = Field(default="default", min_length=1, max_length=128)
    conversation_id: str | None = Field(default=None, max_length=128)
    remember: bool = True

class AgentBody(BaseModel):
    task: str = Field(min_length=1, max_length=8000)
    conversation_id: str | None = Field(default=None, max_length=128)

class ApprovalBody(BaseModel):
    approval_id: str = Field(min_length=10, max_length=100)

class SearchBody(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    limit: int = Field(default=5, ge=1, le=10)

class ApiBody(BaseModel):
    tool: str = Field(min_length=1, max_length=40)
    payload: dict[str, Any] = Field(default_factory=dict)

class FileBody(BaseModel):
    path: str = Field(min_length=1, max_length=300)
    content: str | None = Field(default=None, max_length=2_000_000)

class RagAddBody(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1, max_length=500_000)

class RagSearchBody(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    limit: int = Field(default=5, ge=1, le=10)

class TaskBody(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    delay_seconds: int = Field(ge=0, le=86_400)
    payload: dict[str, Any] = Field(default_factory=dict)

class VoiceBody(BaseModel):
    audio_base64: str = Field(min_length=1, max_length=MAX_AUDIO_B64)
    content_type: str = Field(default="audio/webm", max_length=100)
    model: str = Field(default="default", max_length=128)
    conversation_id: str | None = Field(default=None, max_length=128)
    voice: str = Field(default="default", max_length=100)
    remember: bool = True

async def _agent_prompt(payload: dict[str, Any]) -> None:
    prompt = str(payload.get("prompt", "")).strip()
    if not prompt or len(prompt) > 4000:
        return
    client = GUEDLLMClient(QGConfig(base_url=GUED_URL, api_key=GUED_KEY))
    await client.chat([{"role": "user", "content": prompt}], remember=True)
    audit.record("task:agent_prompt", "ok", secrets.token_hex(12))

def _strict_payload(payload: dict[str, Any], required: set[str], optional: set[str] | None = None) -> None:
    optional = optional or set()
    if not isinstance(payload, dict):
        raise ValueError("Tool input must be an object")
    keys = set(payload)
    if not required <= keys or keys - required - optional:
        raise ValueError("Tool input contains missing or unknown fields")


def _text_field(payload: dict[str, Any], name: str, maximum: int, *, allow_empty: bool = False) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or len(value) > maximum or (not allow_empty and not value.strip()):
        raise ValueError(f"Invalid tool field: {name}")
    return value


def _limit_field(payload: dict[str, Any], default: int = 5) -> int:
    value = payload.get("limit", default)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 10:
        raise ValueError("Tool limit must be an integer between 1 and 10")
    return value


async def _tool_web(payload: dict[str, Any]) -> Any:
    _strict_payload(payload, {"query"}, {"limit"})
    query = _text_field(payload, "query", 1000)
    return {"results": await web_search(query, _limit_field(payload))}


async def _tool_rag_search(payload: dict[str, Any]) -> Any:
    _strict_payload(payload, {"query"}, {"limit"})
    query = _text_field(payload, "query", 1000)
    return {"results": rag.search(query, _limit_field(payload))}


async def _tool_rag_add(payload: dict[str, Any]) -> Any:
    _strict_payload(payload, {"title", "content"})
    title = _text_field(payload, "title", 500)
    content = _text_field(payload, "content", 500_000)
    return {"id": str(rag.add(title, content))}


async def _tool_file_read(payload: dict[str, Any]) -> Any:
    _strict_payload(payload, {"path"})
    path = _text_field(payload, "path", 300)
    return {"path": path, "content": sandbox.read(path)}


async def _tool_file_write(payload: dict[str, Any]) -> Any:
    _strict_payload(payload, {"path", "content"})
    path = _text_field(payload, "path", 300)
    content = _text_field(payload, "content", 2_000_000, allow_empty=True)
    sandbox.write(path, content)
    return {"status": "written", "path": path}

def _build_engine() -> AgentEngine:
    policies = {
        "web_search": ToolPolicy("web_search", enabled=enabled("QG_ENABLE_WEB_SEARCH"), risk="low"),
        "rag_search": ToolPolicy("rag_search", enabled=enabled("QG_ENABLE_RAG"), risk="low"),
        "rag_add": ToolPolicy("rag_add", enabled=enabled("QG_ENABLE_RAG"), risk="medium", requires_approval=True),
        "files_read": ToolPolicy("files_read", enabled=enabled("QG_ENABLE_FILES"), risk="low"),
        "files_write": ToolPolicy("files_write", enabled=enabled("QG_ENABLE_FILES"), risk="high", requires_approval=True),
    }
    handlers = {
        "web_search": _tool_web,
        "rag_search": _tool_rag_search,
        "rag_add": _tool_rag_add,
        "files_read": _tool_file_read,
        "files_write": _tool_file_write,
    }
    return AgentEngine(GUEDLLMClient(QGConfig(base_url=GUED_URL, api_key=GUED_KEY)), policies, handlers, int(os.getenv("QG_AGENT_MAX_STEPS", "8")))


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "agent": AGENT_NAME,
        "version": "3.0.0",
        "agent_runtime": enabled("QG_ENABLE_AGENT"),
        "tools": {
            "web_search": enabled("QG_ENABLE_WEB_SEARCH"),
            "api": enabled("QG_ENABLE_API_TOOLS"),
            "files": enabled("QG_ENABLE_FILES"),
            "rag": enabled("QG_ENABLE_RAG"),
            "tasks": enabled("QG_ENABLE_TASKS"),
            "voice": enabled("QG_ENABLE_VOICE"),
        },
    }

@app.get("/v1/agent")
async def agent(x_cobra7_key: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    return {"name": AGENT_NAME, "role": "secure agent runtime", "version": "3.0.0"}

@app.get("/v1/agent/tools")
async def agent_tools(x_cobra7_key: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    return {"tools": engine.catalog() if engine else []}

@app.post("/v1/agent/run")
async def agent_run(body: AgentBody, x_cobra7_key: str | None = Header(default=None), x_request_id: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_AGENT") or engine is None:
        raise HTTPException(403, "Agent runtime is disabled")
    rid = _rid(x_request_id)
    try:
        result = await engine.run(body.task, body.conversation_id)
        audit.record("agent_run", result.get("status", "unknown"), rid)
        return result
    except (AgentProtocolError, QGError, ValueError) as exc:
        audit.record("agent_run", "error", rid)
        raise HTTPException(502, str(exc)) from None

@app.post("/v1/agent/approve")
async def agent_approve(body: ApprovalBody, x_cobra7_approval_key: str | None = Header(default=None)) -> dict[str, Any]:
    _approval_auth(x_cobra7_approval_key)
    if not enabled("QG_ENABLE_AGENT") or engine is None:
        raise HTTPException(403, "Agent runtime is disabled")
    request_id = secrets.token_hex(12)
    try:
        result = await engine.approve(body.approval_id)
        audit.record("agent_approval", "executed", request_id)
        return result
    except ValueError as exc:
        audit.record("agent_approval", "rejected", request_id)
        raise HTTPException(400, str(exc)) from None
    except (RuntimeError, asyncio.TimeoutError) as exc:
        audit.record("agent_approval", "error", request_id)
        raise HTTPException(502, str(exc)) from None

@app.post("/v1/chat")
async def chat(body: ChatBody, x_cobra7_key: str | None = Header(default=None), x_request_id: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    rid = _rid(x_request_id)
    try:
        client = GUEDLLMClient(QGConfig(base_url=GUED_URL, api_key=GUED_KEY))
        result = await client.chat(body.messages, body.model, body.conversation_id, body.remember)
        audit.record("chat", "ok", rid)
        return result
    except (QGError, ValueError) as exc:
        audit.record("chat", "error", rid)
        raise HTTPException(502, str(exc)) from None

@app.post("/v1/tools/web-search")
async def search(body: SearchBody, x_cobra7_key: str | None = Header(default=None), x_request_id: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_WEB_SEARCH"):
        raise HTTPException(403, "Web search tool is disabled")
    try:
        result = await web_search(body.query, body.limit)
        audit.record("web_search", "ok", _rid(x_request_id))
        return {"results": result}
    except (SearchError, ValueError) as exc:
        audit.record("web_search", "error", _rid(x_request_id))
        raise HTTPException(502, str(exc)) from None

@app.post("/v1/tools/api")
async def api_tool(body: ApiBody, x_cobra7_key: str | None = Header(default=None), x_request_id: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_API_TOOLS"):
        raise HTTPException(403, "API tools are disabled")
    try:
        result = await call_api(body.tool, body.payload)
        audit.record(f"api:{body.tool}", "ok", _rid(x_request_id))
        return result
    except (ApiToolError, ValueError) as exc:
        audit.record(f"api:{body.tool}", "error", _rid(x_request_id))
        raise HTTPException(502, str(exc)) from None

@app.post("/v1/tools/files/read")
async def file_read(body: FileBody, x_cobra7_key: str | None = Header(default=None)) -> dict[str, str]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_FILES"):
        raise HTTPException(403, "File tools are disabled")
    try:
        return {"path": body.path, "content": sandbox.read(body.path)}
    except SandboxError as exc:
        raise HTTPException(400, str(exc)) from None

@app.post("/v1/tools/files/write")
async def file_write(body: FileBody, x_cobra7_key: str | None = Header(default=None)) -> dict[str, str]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_FILES") or body.content is None:
        raise HTTPException(403, "File writing is disabled")
    try:
        sandbox.write(body.path, body.content)
        return {"status": "written", "path": body.path}
    except SandboxError as exc:
        raise HTTPException(400, str(exc)) from None

@app.post("/v1/tools/rag/add")
async def rag_add(body: RagAddBody, x_cobra7_key: str | None = Header(default=None)) -> dict[str, str]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_RAG"):
        raise HTTPException(403, "RAG is disabled")
    return {"id": str(rag.add(body.title, body.content))}

@app.post("/v1/tools/rag/search")
async def rag_search(body: RagSearchBody, x_cobra7_key: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_RAG"):
        raise HTTPException(403, "RAG is disabled")
    return {"results": rag.search(body.query, body.limit)}

@app.post("/v1/tools/tasks/schedule")
async def task_schedule(body: TaskBody, x_cobra7_key: str | None = Header(default=None)) -> dict[str, str]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_TASKS"):
        raise HTTPException(403, "Automated tasks are disabled")
    try:
        task = scheduler.schedule(body.name, body.delay_seconds, body.payload)
        return {"id": task.id, "status": "scheduled"}
    except ValueError as exc:
        raise HTTPException(403, str(exc)) from None

@app.post("/v1/voice/turn")
async def voice_turn(body: VoiceBody, x_cobra7_key: str | None = Header(default=None), x_request_id: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    if not enabled("QG_ENABLE_VOICE"):
        raise HTTPException(403, "Voice is disabled")
    try:
        raw = base64.b64decode(body.audio_base64, validate=True)
        text = await transcribe(raw, body.content_type)
        client = GUEDLLMClient(QGConfig(base_url=GUED_URL, api_key=GUED_KEY))
        result = await client.chat([{"role": "user", "content": text}], body.model, body.conversation_id, body.remember)
        answer = result.get("choices", [{}])[0].get("message", {}).get("content", "")
        audio, audio_type = await synthesize(answer, body.voice)
        audit.record("voice_turn", "ok", _rid(x_request_id))
        return {"transcript": text, "answer": answer, "audio_base64": base64.b64encode(audio).decode("ascii"), "content_type": audio_type}
    except (ValueError, VoiceError, QGError) as exc:
        audit.record("voice_turn", "error", _rid(x_request_id))
        raise HTTPException(502, str(exc)) from None

@app.get("/v1/audit/recent")
async def audit_recent(x_cobra7_key: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_cobra7_key)
    return {"events": [e.__dict__ for e in audit.events[-100:]]}

@app.on_event("startup")
async def startup() -> None:
    global worker_task, engine
    engine = _build_engine()
    if enabled("QG_ENABLE_TASKS"):
        scheduler.register("agent_prompt", _agent_prompt)
        worker_task = asyncio.create_task(scheduler.worker())

@app.on_event("shutdown")
async def shutdown() -> None:
    if worker_task:
        worker_task.cancel()
    scheduler.close()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("QG_PORT", "8090")))
