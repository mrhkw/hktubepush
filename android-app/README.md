# HkTube Agent Android Client — Phase 2

Native-feeling Expo client for the Salman Assistant Phase 1 backend.

## Local development

```bash
cd android-app
npm install
npm start
```

For an Android emulator, the default backend URL is `http://10.0.2.2:8787`. For a physical device, set the Backend URL in Settings to the HTTPS URL of the deployed backend or the LAN IP of the development machine.

## Features

- Direct calls to `/v1/chat`, `/v1/chat/stream`, `/v1/agent/plan`, `/v1/agent/run`, `/v1/agent/approve`, and `/v1/files/inspect`.
- Provider/model selection for OpenAI, Gemini, and Groq.
- Personas/system prompts.
- Document, image, audio, and video attachment picker with base64 forwarding.
- Live agent event timeline and approval modal for the backend's ten-minute single-use approval flow.
- Local chat history, saved/pinned chats, and message/code bookmarks.
- SecureStore-backed API keys, GitHub token, and optional backend auth secret.
- Connector settings for webhook/MCP allowlist entries.

Secrets are stored with Expo SecureStore on the device. The app never commits keys or writes them to AsyncStorage.
