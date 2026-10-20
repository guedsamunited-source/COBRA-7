# Q-G — COBRA-7

Q-G is the secure agent application layer that connects COBRA-7 to GUED-LLM.

```text
Interlocuteur
   | text OR voice
   v
COBRA-7
   |-- Web search (configured HTTPS provider)
   |-- API tools (named HTTPS allowlist)
   |-- Files (confined sandbox)
   |-- RAG (bounded local store)
   |-- Tasks (registered handlers only)
   |-- Voice: STT -> GUED-LLM -> TTS
   |
   | HTTPS + Bearer glk_...
   v
GUED-LLM
   |
   +-- Authentication / permissions / memory / rate limits / audit
   |
   v
Ollama / vLLM / OpenAI-compatible provider
```

## Security model

- All tools are **default-deny** and individually enabled with environment flags.
- Secrets are never committed to Git.
- Remote GUED-LLM, search, API, STT and TTS endpoints require HTTPS.
- The file tool is confined to `QG_SANDBOX_ROOT`; path traversal is rejected.
- API tools are administrator-configured by named environment variables; the model cannot choose arbitrary URLs.
- RAG text is bounded and stored locally in SQLite; retrieval is deterministic and bounded.
- Automated tasks can execute only registered handlers. The only built-in handler is `agent_prompt`, and its delay is capped at 24 hours.
- Voice audio is capped at 10 MB, and the voice turn is `STT -> LLM -> TTS`.
- Audit events exclude secrets and conversation content.
- No shell execution, arbitrary code loading or unrestricted filesystem access is provided.

## Tool endpoints

All require `X-COBRA7-KEY: $COBRA7_AGENT_KEY`.

- `POST /v1/tools/web-search`
- `POST /v1/tools/api`
- `POST /v1/tools/files/read`
- `POST /v1/tools/files/write`
- `POST /v1/tools/rag/add`
- `POST /v1/tools/rag/search`
- `POST /v1/tools/tasks/schedule`
- `POST /v1/voice/turn`
- `GET /v1/audit/recent`

## Voice conversation

`/v1/voice/turn` accepts base64 audio from the interlocutor, sends it to the configured STT provider, sends the transcript to GUED-LLM, then sends COBRA-7's answer to the configured TTS provider and returns base64 audio.

This gives a complete two-way voice loop without embedding a vendor secret or provider URL in the application. The STT/TTS providers are administrator-controlled.

## Provider contracts

### Search

`QG_SEARCH_URL` must be HTTPS and return:

```json
{"results":[{"title":"...","url":"...","snippet":"..."}]}
```

### STT

POST multipart field `audio`; response:

```json
{"text":"recognized speech"}
```

### TTS

POST JSON:

```json
{"text":"COBRA-7 response","voice":"default"}
```

Response:

```json
{"audio_base64":"...","content_type":"audio/mpeg"}
```

## Run

```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python -m qg.main
```

The local API listens on `127.0.0.1:8090` by default. For production, put it behind HTTPS and restrict network access.

## Configuration

Copy `.env.example` to `.env`. Keep real credentials in environment variables or a secrets manager. Start with every tool disabled, then enable only the capabilities required by COBRA-7.
