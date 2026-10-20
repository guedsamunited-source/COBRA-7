# Architecture

GUED-LLM extracts the strongest production-oriented ideas from the uploaded GUEDSAM AI v2.2 project while keeping the first deployment deliberately small.

1. API: FastAPI validates the public contract.
2. Security: credential store, rate limiting, request bounds and secure headers.
3. Orchestration: bounded conversation context and server-side provider selection.
4. Provider: adapters isolate Ollama and OpenAI-compatible backends.
5. Model: the actual model remains replaceable.

This separation makes GUED-LLM a secure control plane for the newly created AI agent, rather than coupling the agent to one model vendor.
