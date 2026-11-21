# HkTube Autonomous Agent Backend — Phase 1

A provider-neutral Node.js/TypeScript backend for the Salman Assistant platform. It is intentionally isolated under `/backend` so the existing HkTube web application is not changed.

## Included in Phase 1

- OpenAI, Gemini and Groq provider adapters with automatic task-based routing.
- SSE streaming for OpenAI/Groq and safe non-stream fallback for Gemini.
- Plan-and-execute agent loop with bounded steps and streamed execution events.
- Approval gate for GitHub writes, destructive file actions and outbound webhook writes.
- GitHub connector: list repositories, read files, create branches, commit files and open pull requests.
- Webhook/MCP connector with SSRF-safe URL validation and explicit approval for writes.
- Web search/fetch connector with bounded response sizes.
- Text/document, image, audio and video attachment normalization for multimodal requests.
- Docker and Render deployment files.

## Run locally

```bash
cd backend
npm install
cp .env.example .env
npm run check
npm run build
npm start
```

The API listens on `http://localhost:8787` by default.

## API outline

- `GET /health`
- `POST /v1/chat` — one provider-routed response
- `POST /v1/chat/stream` — SSE token/event stream
- `POST /v1/agent/plan` — create a bounded plan without executing tools
- `POST /v1/agent/run` — execute safe steps and pause at approval gates
- `POST /v1/agent/approve` — resume one approved action using its approval token
- `POST /v1/files/inspect` — inspect a base64 attachment and return safe metadata/text

Provider credentials can be passed per request in `credentials`. They are held in memory for that request only and are never written to logs or disk. Production deployments must use HTTPS and an authenticated app-to-backend channel; this Phase 1 service does not pretend to replace the Android client's encrypted key storage.

## Safety model

The backend never executes a risky tool merely because an LLM requested it. Risky actions return `approval_required` with a short-lived opaque approval token. The client must show the exact action and call `/v1/agent/approve`; approval tokens are single-use and expire after ten minutes.
