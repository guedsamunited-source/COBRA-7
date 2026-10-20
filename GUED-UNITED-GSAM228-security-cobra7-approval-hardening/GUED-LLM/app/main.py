from __future__ import annotations
import secrets, time
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .models import AgentCreate, AgentCreated, ChatRequest
from .providers import ProviderError, make_provider
from .security import AgentIdentity, CredentialStore, RateLimiter
from .storage import RuntimeStore

store = CredentialStore(settings.db_path)
runtime = RuntimeStore(settings.db_path)
limiter = RateLimiter(settings.rate_limit_per_minute)
provider = make_provider(settings)
app = FastAPI(title="GUED-LLM", version="1.1.0", docs_url="/docs", redoc_url="/redoc")

if settings.allowed_origins:
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_credentials=False, allow_methods=["POST","GET","DELETE"], allow_headers=["Authorization","Content-Type","X-Admin-Key"])

@app.middleware("http")
async def security_middleware(request: Request, call_next):
    rid = secrets.token_hex(12); request.state.request_id = rid
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > settings.max_body_bytes:
        return JSONResponse(413, {"error":{"message":"Request body too large","type":"invalid_request_error"}}, headers={"X-Request-ID":rid})
    auth_header = request.headers.get("authorization", "")
    client = request.client.host if request.client else "unknown"
    key = auth_header[-80:] if auth_header.startswith("Bearer ") else client
    if not limiter.allow(key):
        return JSONResponse(429, {"error":{"message":"Rate limit exceeded","type":"rate_limit_error"}}, headers={"Retry-After":"60","X-Request-ID":rid})
    started = time.perf_counter()
    try:
        response = await call_next(request)
        return response
    finally:
        elapsed = int((time.perf_counter()-started)*1000)
        # Middleware deliberately does not log authorization headers or request bodies.
        if request.url.path.startswith("/v1/") and request.method in {"POST","DELETE"}:
            try: runtime.audit(rid, None, f"http.{request.method.lower()}.{request.url.path}", 200, elapsed)
            except Exception: pass

@app.middleware("http")
async def response_security(request: Request, call_next):
    response = await call_next(request)
    rid = getattr(request.state, "request_id", "unknown")
    response.headers.update({"X-Request-ID":rid,"X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer","Cache-Control":"no-store","Permissions-Policy":"camera=(), microphone=(), geolocation=()"})
    return response

def auth(authorization: str|None = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Bearer token required", headers={"WWW-Authenticate":"Bearer"})
    identity = store.authenticate(authorization[7:].strip())
    if not identity: raise HTTPException(401, "Invalid or revoked credentials", headers={"WWW-Authenticate":"Bearer"})
    return identity

def admin_auth(x_admin_key: str|None = Header(default=None)):
    if not x_admin_key or not secrets.compare_digest(x_admin_key, settings.admin_key): raise HTTPException(403, "Admin authorization required")

@app.get("/health/live")
async def live(): return {"status":"ok","service":"GUED-LLM","version":"1.1.0"}

@app.get("/health/ready")
async def ready():
    health = await provider.health(); code = 200 if health.get("ok") else 503
    return JSONResponse(code, {"status":"ready" if code == 200 else "not_ready", **health})

@app.post("/v1/agents", response_model=AgentCreated, dependencies=[Depends(admin_auth)])
async def create_agent(body: AgentCreate):
    token, identity = store.create(body.name)
    return AgentCreated(agent_id=identity.agent_id, name=identity.name, token=token, warning="Store this token now. It cannot be recovered in plaintext.")

@app.post("/v1/agents/{agent_id}/rotate", response_model=AgentCreated, dependencies=[Depends(admin_auth)])
async def rotate_agent(agent_id: str):
    result = store.rotate(agent_id)
    if not result: raise HTTPException(404, "Agent not found or already revoked")
    token, identity = result
    return AgentCreated(agent_id=identity.agent_id, name=identity.name, token=token, warning="The previous credential was revoked. Store this new token now; it cannot be recovered in plaintext.")

@app.delete("/v1/agents/{agent_id}", dependencies=[Depends(admin_auth)])
async def revoke_agent(agent_id: str):
    if not store.revoke(agent_id): raise HTTPException(404, "Agent not found or already revoked")
    return {"revoked":True,"agent_id":agent_id}

@app.get("/v1/agents/me")
async def whoami(identity: AgentIdentity = Depends(auth)): return {"agent_id":identity.agent_id,"name":identity.name}

@app.get("/v1/conversations/{conversation_id}/messages")
async def conversation_messages(conversation_id: str, identity: AgentIdentity = Depends(auth)):
    if len(conversation_id) > 96: raise HTTPException(400, "Invalid conversation id")
    return {"conversation_id":conversation_id,"messages":runtime.history(identity.agent_id, conversation_id, settings.max_messages)}

@app.post("/v1/chat/completions")
async def chat(body: ChatRequest, identity: AgentIdentity = Depends(auth), request: Request = None):
    if body.stream: raise HTTPException(400, "stream=true is not enabled until a provider with native streaming is configured")
    started = time.perf_counter(); rid = getattr(request.state, "request_id", "unknown") if request else "unknown"
    current = [{"role":m.role,"content":m.content[:settings.max_message_chars]} for m in body.messages]
    conversation_id = None
    messages = current[-settings.max_messages:]
    try:
        if body.remember:
            conversation_id = runtime.conversation(identity.agent_id, body.conversation_id)
            prior = runtime.history(identity.agent_id, conversation_id, max(0, settings.max_messages-len(current))) if body.conversation_id else []
            messages = (prior + current)[-settings.max_messages:]
            for msg in current: runtime.append(identity.agent_id, conversation_id, msg["role"], msg["content"])
        answer, model = await provider.chat(messages, body.model, body.max_tokens, body.temperature)
        if body.remember and conversation_id: runtime.append(identity.agent_id, conversation_id, "assistant", answer[:settings.max_message_chars])
    except ProviderError as e:
        runtime.audit(rid, identity.agent_id, "chat.provider_error", 502, int((time.perf_counter()-started)*1000))
        raise HTTPException(502, str(e)) from None
    except ValueError as e:
        raise HTTPException(404, str(e)) from None
    latency = int((time.perf_counter()-started)*1000)
    runtime.audit(rid, identity.agent_id, "chat.completed", 200, latency)
    return {"id":"chatcmpl_"+secrets.token_hex(12),"object":"chat.completion","created":int(time.time()),"model":model,"choices":[{"index":0,"message":{"role":"assistant","content":answer},"finish_reason":"stop"}],"usage":{"prompt_tokens":None,"completion_tokens":None,"total_tokens":None},"metadata":{"agent_id":identity.agent_id,"conversation_id":conversation_id,"latency_ms":latency}}

@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    return JSONResponse(500, {"error":{"message":"Internal server error","type":"server_error"},"request_id":getattr(request.state,"request_id","unknown")})
