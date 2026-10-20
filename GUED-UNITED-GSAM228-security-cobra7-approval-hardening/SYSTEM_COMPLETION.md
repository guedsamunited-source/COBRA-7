# GSAM228 / GUED-LLM / COBRA-7 — system completion contract

## Roles

### GSAM228
User-facing application and serverless product layer. It owns the web experience, authentication/application APIs, media and user-facing orchestration.

### GUED-LLM
Controlled LLM gateway. It owns model-provider abstraction, agent credentials, bounded conversation memory, validation, rate limiting and audit boundaries.

### Q-G / COBRA-7
Secure agent runtime. It owns tool policy, action validation, tool execution, task scheduling, RAG/file boundaries and the agent loop.

## Non-negotiable trust boundary

GSAM228 must not expose provider credentials to the browser.

COBRA-7 must not receive unrestricted operating-system access.

GUED-LLM must not become an arbitrary HTTP proxy.

Model output must never be interpreted as executable code.

All tools are default-deny and must be explicitly configured.

## Completed runtime contract

COBRA-7 uses:

1. objective;
2. model decision;
3. strict JSON action validation;
4. capability/risk policy;
5. optional human approval;
6. bounded tool execution;
7. bounded tool result;
8. next model decision;
9. final answer or step-budget stop.

This closes the previously missing gap between a collection of tools and an actual bounded agent runtime.

## Production requirements

For a single host:

- Q-G local SQLite is acceptable for task/RAG persistence.
- GUED-LLM may use its current SQLite runtime.
- All public traffic must terminate at TLS.
- Secrets remain in environment/secrets manager.
- Tools remain default-deny.

For horizontal scaling:

- PostgreSQL for durable shared state;
- Redis for distributed rate limiting/coordination;
- dedicated workers for tasks;
- centralized logs/traces/metrics;
- secret manager;
- backups and restore tests;
- egress allowlists;
- API gateway/WAF.

## Compatibility

No provider-specific model feature is required by the agent protocol. The model only needs to return a JSON object matching:

{"type":"tool","tool":"NAME","input":{...}}

or:

{"type":"final","answer":"..."}

This keeps the runtime compatible with Ollama, vLLM and OpenAI-compatible providers behind GUED-LLM.

## Operational definition of "complete"

The project is not declared bug-free merely because code exists. A release is considered complete only when:

- unit tests pass;
- Q-G CI passes;
- GUED-LLM CI passes;
- GSAM228 E2E tests pass;
- local end-to-end smoke test succeeds with a real configured model;
- secrets are absent from Git;
- all enabled tools are explicitly reviewed;
- production observability and backups are configured.

The architecture intentionally keeps these requirements visible rather than hiding them behind a claim of zero bugs.
