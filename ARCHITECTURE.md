# Personal AI OS Architecture

## Product goals
Private-first, low-cost, autonomous within explicitly granted permissions, and available across web, Windows desktop and mobile.

## System boundaries
- Web: Next.js App Router. It is a client for the backend, never a secret store.
- API: FastAPI. Owns provider credentials, authorization, rate limits, agent execution and integration credentials.
- Model adapters: provider-specific adapters behind one normalized interface.
- Orchestrator: plans tasks, selects agents/tools, tracks runs and checks results.
- Agent registry: declarative agent definitions with capabilities and permission scopes.
- Tool registry: typed tools with schemas, risk levels and execution policies.
- Memory: PostgreSQL + pgvector for hosted/private server deployments; SQLite for single-user local mode.
- Files: local/private object storage adapter with per-project access controls.
- Desktop: Tauri shell around the web client with explicit filesystem grants.
- Mobile: Expo client using the same authenticated API; no direct provider secrets.

## Initial provider adapters
OpenAI, Gemini, Anthropic, DeepSeek and Ollama. Provider availability is configuration-based. A provider is unavailable until credentials or a reachable local endpoint are configured and tested.

## Execution lifecycle
1. Validate user identity, request and project scope.
2. Classify task and risk.
3. Produce a plan.
4. Select only agents/tools permitted for the user and project.
5. Execute reversible, scoped tasks.
6. Require approval for external communication, publishing, payments, production deployment and destructive operations.
7. Record redacted audit events.
8. Evaluate output and report partial failures honestly.

## Platform strategy
Build and verify the web/API foundation first. Reuse the API for Tauri desktop and Expo mobile clients. Local-only functions are available only when a trusted local companion service is installed and paired.

## Cost controls
Prefer local Ollama where suitable, allow model selection per task, enforce request budgets and token limits, cache safe deterministic results, and expose provider usage when available.
