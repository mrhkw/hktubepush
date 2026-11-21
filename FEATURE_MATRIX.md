# Feature Matrix

Status vocabulary: IMPLEMENTED, PARTIAL, PLANNED, BLOCKED. A feature is not IMPLEMENTED until its code path and relevant tests pass.

| Area | Capability | Status | Acceptance evidence |
|---|---|---|---|
| Core | Responsive web workspace | PARTIAL | Initial shell and chat client |
| Core | Secure backend API | PARTIAL | FastAPI, CORS allow-list, rate limiting |
| Models | OpenAI adapter | IMPLEMENTED | Server-side request adapter |
| Models | Gemini adapter | IMPLEMENTED | Server-side request adapter |
| Models | Anthropic adapter | IMPLEMENTED | Server-side request adapter |
| Models | DeepSeek adapter | IMPLEMENTED | OpenAI-compatible adapter |
| Models | Ollama adapter | IMPLEMENTED | Local chat endpoint adapter |
| Models | Provider connection self-test | PLANNED | Live authenticated health test |
| Agents | Master orchestrator | PLANNED | Plan/delegate/verify execution |
| Agents | Research, coding, design, backend, database, QA, browser, docs, data, security, project agents | PLANNED | Per-agent tests and tool scopes |
| Tools | Sandboxed code execution | PLANNED | Isolation and resource-limit tests |
| Integrations | Plugin catalog and lifecycle | PLANNED | Connect/test/permissions/disconnect |
| Integrations | MCP client and server registry | PLANNED | Protocol conformance tests |
| Memory | Conversations and project memory | PLANNED | Persistence and isolation tests |
| Memory | RAG and pgvector | PLANNED | Retrieval evaluation |
| Automation | Visual workflow builder and runner | PLANNED | Trigger/action execution tests |
| Files | Secure upload and document analysis | PLANNED | File validation and access tests |
| Desktop | Windows Tauri app | PLANNED | Signed build and smoke test |
| Mobile | Android/iOS Expo app | PLANNED | Device builds and API tests |
| Operations | Audit logs, backups, monitoring | PLANNED | Restore and observability tests |

Do not remove planned rows to make progress appear better. Update status only with evidence.
