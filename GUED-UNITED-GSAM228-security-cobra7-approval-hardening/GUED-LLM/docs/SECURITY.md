# Security model

## Credentials
Agent credentials are high-entropy bearer tokens. Only a salted `scrypt` digest is stored in SQLite. The plaintext token is returned once and cannot be recovered.

## Trust boundaries
- Provider URL/model are server configuration, never client-controlled URLs.
- Inputs are bounded by Pydantic validation and server-side truncation.
- `stream=true` is rejected until a dedicated streaming implementation with equivalent controls exists.
- Errors do not expose stack traces, internal paths or secrets.
- Docker runs without `docker.sock`, as an unprivileged user, with `no-new-privileges` and dropped Linux capabilities.

## Production
TLS must terminate before public traffic reaches GUED-LLM. For higher-risk deployments, add external Redis rate limiting, centralized audit logs, a secret manager, network egress policy, WAF/API gateway, key rotation automation, and signed-request/HMAC mode.
