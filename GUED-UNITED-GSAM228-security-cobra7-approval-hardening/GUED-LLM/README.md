# GUED-LLM

Production-oriented LLM gateway and secure agent bridge built from the uploaded `GUEDSAM AI v2.2` architecture.

GUED-LLM is not a model by itself. It is the controlled orchestration layer between a newly created AI agent and an LLM provider.

## What was added in v1.1
- Persistent, agent-isolated conversation memory in SQLite/WAL.
- Conversation IDs that can be reused safely by the owning agent only.
- Security audit ledger with request IDs, event names, status and latency; no credentials or message bodies are logged.
- Secure API-token rotation: the previous token is revoked before a replacement is issued.
- Conversation retrieval endpoint for the authenticated owner.
- Regression tests for credential rotation and memory isolation.

## Security model
- OpenAI-compatible `/v1/chat/completions` contract.
- Ollama and OpenAI-compatible backends.
- One-time agent credentials; plaintext secrets are never stored.
- `scrypt` password-derived credential hashing with constant-time verification.
- Request-size limits, rate limiting, security headers and request IDs.
- Strict Pydantic validation and bounded conversation context.
- Provider URLs/model selection remain server-side, preventing clients from turning GUED-LLM into an arbitrary HTTP proxy.
- Agent isolation is enforced at the persistence layer.
- Tokens can be revoked or rotated without exposing the previous secret.
- Docker remains hardened and does not require access to `docker.sock`.

## Architecture
```text
New AI Agent
    |
    | HTTPS + Bearer token
    v
GUED-LLM API
    |-- authentication / rate limit / validation
    |-- token lifecycle / permissions boundary
    |-- conversation memory / audit ledger
    |-- orchestration / bounded context
    |-- provider adapter
    v
Ollama / vLLM / LM Studio / OpenAI-compatible API
```

The uploaded v2.2 project remains the conceptual foundation: provider abstraction, bounded orchestration, RAG/tool-ready architecture, memory and security-first boundaries. GUED-LLM deliberately introduces these capabilities incrementally so each layer can be tested and audited before adding more powerful tool execution or retrieval capabilities.

## API
- `GET /health/live`
- `GET /health/ready`
- `POST /v1/agents` — admin only; creates a one-time credential
- `POST /v1/agents/{agent_id}/rotate` — admin only; revokes the old credential and issues a new one
- `DELETE /v1/agents/{agent_id}` — admin only
- `GET /v1/agents/me`
- `GET /v1/conversations/{conversation_id}/messages` — authenticated owner only
- `POST /v1/chat/completions`
- `GET /docs`

### Stateful chat
Send `remember: true` and optionally a `conversation_id`:
```json
{
  "model": "default",
  "conversation_id": "conv_...",
  "remember": true,
  "messages": [{"role":"user","content":"Continue our previous discussion."}]
}
```
If no conversation ID is supplied, GUED-LLM creates one and returns it in `metadata.conversation_id`.

### Token rotation
```bash
curl -X POST http://127.0.0.1:8080/v1/agents/AGENT_ID/rotate \\
  -H "X-Admin-Key: YOUR_ADMIN_KEY"
```
The replacement token is returned once. The old credential is immediately invalid.

## Quick start

1. Copy `.env.example` to `.env`.
2. Set a long random `GUED_LLM_ADMIN_KEY`.
3. Configure the provider and model.
4. Install and run:
```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
```

## Production requirements
Put GUED-LLM behind HTTPS/TLS. Keep the LLM backend on a private network. Never commit `.env`, database files, API keys or model credentials. Use a secret manager for deployment secrets. Rotate agent credentials when an integration changes.

### Deliberate safety boundary
Native streaming, arbitrary tool execution and remote RAG ingestion are **not** enabled merely by exposing an endpoint. They will be added only with provider capability checks, explicit tool allowlists, resource limits, sandboxing and audit controls.

No software can honestly promise zero bugs. GUED-LLM is designed so failures are bounded, observable and testable, with automated CI and security-focused regression tests.
