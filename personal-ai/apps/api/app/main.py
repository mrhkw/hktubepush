from __future__ import annotations

import os
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

Provider = Literal["openai", "gemini", "anthropic", "deepseek", "ollama"]

WEB_ORIGIN = os.getenv("WEB_ORIGIN", "http://localhost:3000")
TIMEOUT = httpx.Timeout(float(os.getenv("UPSTREAM_TIMEOUT_SECONDS", "45")))
MAX_PROMPT_CHARS = int(os.getenv("MAX_PROMPT_CHARS", "20000"))
RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "20"))
OLLAMA_ENABLED = os.getenv("OLLAMA_ENABLED", "false").lower() == "true"

limiter = Limiter(key_func=get_remote_address, default_limits=[f"{RATE_LIMIT}/minute"])
app = FastAPI(title="Personal AI OS API", version="0.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in WEB_ORIGIN.split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


class ChatRequest(BaseModel):
    provider: Provider
    message: str = Field(min_length=1, max_length=MAX_PROMPT_CHARS)
    model: str | None = Field(default=None, max_length=120)
    system: str | None = Field(default=None, max_length=4000)


class ChatResponse(BaseModel):
    provider: Provider
    model: str
    response: str


def provider_status() -> dict[str, bool]:
    return {
        "openai": bool(os.getenv("OPENAI_API_KEY")),
        "gemini": bool(os.getenv("GEMINI_API_KEY")),
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
        "deepseek": bool(os.getenv("DEEPSEEK_API_KEY")),
        "ollama": OLLAMA_ENABLED,
    }


def model_for(provider: Provider, requested: str | None) -> str:
    defaults = {
        "openai": os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
        "gemini": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        "anthropic": os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"),
        "deepseek": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        "ollama": os.getenv("OLLAMA_MODEL", "llama3.2"),
    }
    return requested or defaults[provider]


async def openai_compatible(
    base_url: str, api_key: str | None, model: str, message: str, system: str | None
) -> str:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": message})
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers=headers,
            json={"model": model, "messages": messages, "temperature": 0.4},
        )
        response.raise_for_status()
        data = response.json()
    return str(data["choices"][0]["message"]["content"])


async def run_provider(payload: ChatRequest, model: str) -> str:
    provider = payload.provider
    if provider == "openai":
        key = os.getenv("OPENAI_API_KEY")
        if not key:
            raise HTTPException(status_code=503, detail="OpenAI provider is not configured.")
        return await openai_compatible("https://api.openai.com/v1", key, model, payload.message, payload.system)

    if provider == "deepseek":
        key = os.getenv("DEEPSEEK_API_KEY")
        if not key:
            raise HTTPException(status_code=503, detail="DeepSeek provider is not configured.")
        return await openai_compatible("https://api.deepseek.com/v1", key, model, payload.message, payload.system)

    if provider == "ollama":
        if not OLLAMA_ENABLED:
            raise HTTPException(status_code=503, detail="Ollama is disabled. Set OLLAMA_ENABLED=true on the API host.")
        base = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
        messages = []
        if payload.system:
            messages.append({"role": "system", "content": payload.system})
        messages.append({"role": "user", "content": payload.message})
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{base}/api/chat",
                json={"model": model, "messages": messages, "stream": False},
            )
            response.raise_for_status()
            data = response.json()
        return str(data["message"]["content"])

    if provider == "gemini":
        key = os.getenv("GEMINI_API_KEY")
        if not key:
            raise HTTPException(status_code=503, detail="Gemini provider is not configured.")
        prompt = f"{payload.system}\n\n{payload.message}" if payload.system else payload.message
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={"x-goog-api-key": key},
                json={"contents": [{"parts": [{"text": prompt}]}]},
            )
            response.raise_for_status()
            data = response.json()
        return str(data["candidates"][0]["content"]["parts"][0]["text"])

    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="Anthropic provider is not configured.")
    headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body: dict[str, object] = {
        "model": model,
        "max_tokens": 2048,
        "messages": [{"role": "user", "content": payload.message}],
    }
    if payload.system:
        body["system"] = payload.system
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=body)
        response.raise_for_status()
        data = response.json()
    return "".join(
        str(block.get("text", "")) for block in data.get("content", []) if block.get("type") == "text"
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "personal-ai-api"}


@app.get("/api/v1/providers")
async def providers() -> dict[str, dict[str, bool]]:
    return {"configured": provider_status()}


@app.post("/api/v1/chat", response_model=ChatResponse)
@limiter.limit(f"{RATE_LIMIT}/minute")
async def chat(request: Request, payload: ChatRequest) -> ChatResponse:
    model = model_for(payload.provider, payload.model)
    try:
        result = await run_provider(payload, model)
        return ChatResponse(provider=payload.provider, model=model, response=result)
    except HTTPException:
        raise
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="AI provider timed out.") from exc
    except httpx.HTTPStatusError as exc:
        status = 502 if exc.response.status_code < 500 else 503
        raise HTTPException(status_code=status, detail="AI provider request failed. Check provider configuration and quota.") from exc
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="AI provider returned an unexpected response.") from exc
