# HkTube Agent Android Client — Phase 2

Native-feeling Expo client for the Salman Assistant Phase 1 backend.

## Local development

```bash
cd android-app
npm install
npm start
```

The app does not assume an emulator-only host. On first launch, open Settings and enter the backend's HTTPS URL (or a LAN URL reachable from the phone), then press **Save settings**. The URL, provider keys, GitHub token, and optional backend secret remain stored across restarts. Secrets use Android SecureStore when the device keystore is available; if Android rejects SecureStore (for example, no screen lock is configured), the app uses an explicitly labelled app-storage fallback so the user is not blocked and shows a reduced-protection warning. Enable a screen lock and save again to restore SecureStore.

## Features

- Direct calls to `/v1/chat`, `/v1/chat/stream`, `/v1/agent/plan`, `/v1/agent/run`, `/v1/agent/approve`, and `/v1/files/inspect`.
- Provider/model selection for OpenAI, Gemini, and Groq.
- Personas/system prompts.
- Document, image, audio, and video attachment picker with base64 forwarding.
- Live agent event timeline and approval modal for the backend's ten-minute single-use approval flow.
- Local chat history, saved/pinned chats, and message/code bookmarks.
- SecureStore-backed API keys, GitHub token, and optional backend auth secret, with a visible reduced-protection fallback for devices whose Android keystore is unavailable.
- Connector settings for webhook/MCP allowlist entries.

Secrets are stored with Expo SecureStore on the device whenever possible. If SecureStore cannot operate, the app stores them in a separate AsyncStorage fallback and clearly warns the user; values are never logged, committed, or sent anywhere except the configured backend request.
