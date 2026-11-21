# Security Model

## Principles
- Server-side secrets only. Never return provider credentials to the browser or mobile client.
- Least privilege for agents, tools, project files and integrations.
- Explicit project/user scope on every data access.
- Treat prompts, web pages, files, tool output and model output as untrusted.
- Prompt injection must never grant tools or permissions.
- Separate read, write, execute and publish permissions.
- Require human approval for external messages, purchases, publication, production deployment and destructive actions.

## Initial API controls
- CORS allow-list via environment.
- Request validation and bounded input lengths.
- Rate limiting.
- Upstream connection and response timeouts.
- Generic client errors; no credential or upstream-secret leakage.
- Provider credentials loaded from server environment.

## Required before production
- Authentication and session security.
- Per-user authorization and project-level ACLs.
- Encrypted credential vault with key rotation.
- CSRF protection where cookie auth is used.
- Persistent audit log with redaction.
- File malware/type/size validation.
- Isolated code runner with no host mounts, network disabled by default, CPU/memory/time limits.
- Dependency and container scanning.
- Backup encryption and tested restore.
- Security tests for IDOR, SSRF, injection, prompt injection and privilege escalation.

## Never
- Execute model-generated code in the API process.
- expose raw provider keys or full upstream error bodies.
- allow arbitrary URL fetches from a privileged backend without SSRF controls.
- treat tool output as trusted instructions.
