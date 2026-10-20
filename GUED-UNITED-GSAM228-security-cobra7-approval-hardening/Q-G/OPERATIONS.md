# COBRA-7 production operations

## Architecture

GSAM228 is the application layer, GUED-LLM is the controlled LLM gateway, and Q-G is the secure agent runtime.

The supported control flow is:

user -> GSAM228 -> Q-G/COBRA-7 -> GUED-LLM -> configured model provider

COBRA-7 can only call administrator-enabled tools. Model text is never interpreted as shell, Python, URLs, or plugin code.

## Local startup

### 1. GUED-LLM

cd GUED-LLM
python -m venv .venv

Windows:
.venv\Scripts\activate

Linux/macOS:
source .venv/bin/activate

python -m pip install -r requirements.txt

Copy .env.example to .env and set a strong GUED_LLM_ADMIN_KEY plus a configured model provider.

Start:

python -m uvicorn app.main:app --host 127.0.0.1 --port 8080

Verify:

curl http://127.0.0.1:8080/health/live

Create an agent credential through the documented admin endpoint. Save the one-time glk_ credential securely.

### 2. Q-G / COBRA-7

cd Q-G
python -m venv .venv

Windows:
.venv\Scripts\activate

Linux/macOS:
source .venv/bin/activate

python -m pip install -r requirements.txt

Copy .env.example to .env.

Set:
GUED_LLM_URL=http://127.0.0.1:8080
COBRA7_GUED_LLM_KEY=glk_your_real_credential
COBRA7_AGENT_KEY=your_long_random_secret

Start with all QG_ENABLE_* flags false. Run:

pytest -q
python -m qg.main

Verify:

curl http://127.0.0.1:8090/health

Then:

curl http://127.0.0.1:8090/v1/agent -H "X-COBRA7-KEY: your_long_random_secret"

### 3. First agent test

Set QG_ENABLE_AGENT=true.

Keep write capabilities disabled. Then:

curl -X POST http://127.0.0.1:8090/v1/agent/run ^
  -H "Content-Type: application/json" ^
  -H "X-COBRA7-KEY: your_long_random_secret" ^
  -d "{"task":"Réponds simplement bonjour."}"

On PowerShell, use Invoke-RestMethod instead of cmd curl quoting.

## Progressive capability rollout

1. Agent runtime only.
2. RAG search.
3. Web search.
4. File read.
5. RAG write after approval flow is verified.
6. File write after approval flow is verified.
7. Automated tasks.
8. External API tools.
9. Voice.

Do not enable everything at once.

## Approval model

Read-only tools may run automatically when enabled.

Write/high-risk tools return an approval_id. They do not execute immediately. A separate authenticated approval request executes the single-use action.

Never expose the approval endpoint publicly without an authenticated gateway and audit trail.

## Production deployment

For a single-machine deployment, SQLite is acceptable for local RAG and task persistence.

For multiple Q-G/GUED-LLM instances, migrate durable state to PostgreSQL and coordination/rate limiting to Redis. Run tasks in dedicated workers. Put public traffic behind TLS, an API gateway/WAF, strict egress policy, secret management, backups, monitoring and alerting.

## GitHub workflow

The repository already has CI for GUED-LLM and Q-G. Every change must pass tests before merge. Treat production changes as pull requests rather than direct edits to main.

## What is intentionally not provided

- shell execution;
- arbitrary Python execution;
- arbitrary model-selected network URLs;
- unrestricted filesystem access;
- automatic high-risk writes;
- secrets in prompts;
- unaudited self-modification.

These are security boundaries, not missing features.
