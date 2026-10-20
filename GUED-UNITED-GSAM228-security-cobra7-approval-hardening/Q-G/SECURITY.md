# Q-G / COBRA-7 security boundary

COBRA-7 is an agent runtime, not an unrestricted computer operator.

## Default-deny

- Web search, external APIs, files, RAG, automated tasks and voice are disabled by default.
- No shell execution.
- No arbitrary Python/plugin loading.
- No arbitrary outbound URLs from model input.
- File access is confined to an administrator-defined sandbox.
- API access uses named, administrator-configured HTTPS endpoints.
- No dynamic tool execution is inferred from arbitrary model text.
- Tool execution must pass authentication and a capability switch.
- High-risk approvals require a separate `COBRA7_APPROVAL_KEY`; the general agent key must not authorize approvals.
- Approval requests expire after a bounded interval, are single-use, and are rejected if the capability has since been disabled.
- Configure `COBRA7_APPROVAL_KEY` as a distinct random secret in the deployment secret manager. Leave it unset until an authorized approval workflow is ready; approval requests then fail closed.
- Planner/task budgets are bounded.
- RAG and audio payloads have explicit size limits.

## Voice

Voice uses a controlled STT -> GUED-LLM -> TTS pipeline. COBRA-7 never receives direct unrestricted access to a microphone, speaker, operating system audio device, or provider credentials. The caller supplies audio to the authenticated `/v1/voice/turn` endpoint.

## Network

Q-G may connect to GUED-LLM over HTTPS. Search, API, STT and TTS providers must also use HTTPS. Plain HTTP is accepted only for local GUED-LLM development. Redirects are disabled for outbound tool calls to reduce SSRF/open-redirect risk.

## Secrets

`COBRA7_GUED_LLM_KEY`, `COBRA7_AGENT_KEY`, provider keys and all external service credentials must be supplied through environment variables or a secrets manager. They must never be committed to Git.

## Files

The file tool uses `QG_SANDBOX_ROOT`, resolves paths before access, rejects path traversal and caps file size. It must not be pointed at a system root or a directory containing unrelated secrets.

## External APIs

The API tool maps a short tool name to an administrator-defined `QG_API_<NAME>_URL`. The model cannot supply a URL. Each endpoint must be HTTPS and can have its own bearer key.

## Tasks

Tasks can execute only registered handlers. The built-in `agent_prompt` handler sends a bounded prompt to GUED-LLM. No arbitrary command or code handler exists.

## Audit

Audit records contain event, status, timestamp and request ID only. Secrets, API keys, raw audio and conversation contents are deliberately excluded.

## Production requirements

Use HTTPS, a secrets manager, network segmentation, strict egress policy, container isolation, resource limits, regular key rotation and monitoring. High-risk future tools should execute in a separate sandboxed worker rather than in the Q-G web process.

## High-risk approvals

`POST /v1/agent/approve` requires `X-COBRA7-APPROVAL-KEY`, backed by `COBRA7_APPROVAL_KEY`. Do not reuse `COBRA7_AGENT_KEY`. The approval token is single-use and expires; the runtime rechecks that the tool is still enabled at execution time. This is an additional control, not a substitute for per-user identity, audited operator workflows, or network restrictions.
