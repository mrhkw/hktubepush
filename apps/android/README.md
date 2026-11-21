# Personal AI OS Android

This is the Android-only personal client. It does not deploy or require the Next.js web workspace or a hosted API backend.

## Local development

```bash
npm install
npx expo start
```

## Build

The GitHub Actions workflow `.github/workflows/android-agent-apk.yml` builds a release APK when files in this app change or when manually dispatched. The APK is uploaded as a workflow artifact.

## API key handling

Provider keys are stored with Expo SecureStore, backed by Android Keystore on Android. Keys are never committed to Git and are not sent to a Personal AI OS server. A rooted, compromised, instrumented or modified device can still expose keys, so this direct-device architecture is appropriate only for a private personal installation. Use provider-side spending limits and revoke a key if the device is lost.

## Supported direct providers

- OpenAI Chat Completions
- Google Gemini generateContent
- Anthropic Messages
- DeepSeek Chat Completions

The app currently provides single-turn text chat only. Multi-agent orchestration, memory sync, tools, browser automation, file ingestion and background tasks are not implemented by this initial Android client.
