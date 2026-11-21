# Personal AI OS

A private-first, modular personal AI operating system. This application is isolated under `personal-ai/`; the existing HkTube application remains intact on the original `main` branch and is preserved in `hktube-preserved-2026-11-21`.

## Current implementation

- Next.js web workspace with a working AI chat interface.
- FastAPI backend with server-side provider credentials.
- Provider adapter support for OpenAI, Gemini, Anthropic, DeepSeek and Ollama.
- Provider availability endpoint that never returns secrets.
- Request validation, CORS allow-list, API rate limiting and bounded upstream timeouts.

## Development

API:
```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Web:
```bash
cd apps/web
pnpm install
pnpm dev
```

Copy `.env.example` to the API and web environment files as appropriate. Never commit real credentials.

## Provider setup

Set one or more provider keys in the API environment. Ollama can be used with a local Ollama server. The web app only talks to the backend; provider keys are never sent to the browser.

## Roadmap

See `ARCHITECTURE.md`, `FEATURE_MATRIX.md`, `SECURITY_MODEL.md` and `IMPLEMENTATION_STATUS.md`. Features are marked implemented only after code and tests exist. No marketplace entry should claim a connector is connected until OAuth/API setup and a live connection test succeed.
