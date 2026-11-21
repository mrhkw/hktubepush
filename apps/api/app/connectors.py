from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])
TIMEOUT = httpx.Timeout(20.0)
DB_PATH = Path(os.getenv("PAIOS_CONNECTOR_DB", "./data/connectors.sqlite3"))
PROVIDERS: dict[str, dict[str, Any]] = {
    "google": {
        "label": "Google Workspace",
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "revoke": "https://oauth2.googleapis.com/revoke",
        "client_id_env": "GOOGLE_CLIENT_ID",
        "client_secret_env": "GOOGLE_CLIENT_SECRET",
        "scopes": ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.readonly"],
        "extra": {"access_type": "offline", "prompt": "consent", "include_granted_scopes": "true"},
    },
    "github": {
        "label": "GitHub",
        "authorize": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token",
        "revoke": None,
        "client_id_env": "GITHUB_OAUTH_CLIENT_ID",
        "client_secret_env": "GITHUB_OAUTH_CLIENT_SECRET",
        "scopes": ["read:user", "user:email", "repo"],
        "extra": {},
    },
}


def _db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL)")
    connection.execute("CREATE TABLE IF NOT EXISTS connected_accounts (provider TEXT PRIMARY KEY, account_label TEXT NOT NULL, token_cipher BLOB NOT NULL, nonce BLOB NOT NULL, scopes TEXT NOT NULL, expires_at INTEGER, updated_at INTEGER NOT NULL)")
    connection.commit()
    return connection


def _key() -> bytes:
    raw = os.getenv("PAIOS_ENCRYPTION_KEY", "")
    try:
        key = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Connector encryption key is not configured correctly.") from exc
    if len(key) != 32:
        raise HTTPException(status_code=503, detail="Set PAIOS_ENCRYPTION_KEY to a URL-safe base64 encoded 32-byte key.")
    return key


def _encrypt(value: dict[str, Any]) -> tuple[bytes, bytes]:
    nonce = secrets.token_bytes(12)
    cipher = AESGCM(_key()).encrypt(nonce, json.dumps(value).encode(), b"paios-connector-v1")
    return cipher, nonce


def _decrypt(cipher: bytes, nonce: bytes) -> dict[str, Any]:
    try:
        return json.loads(AESGCM(_key()).decrypt(nonce, cipher, b"paios-connector-v1"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Stored connector credentials could not be decrypted.") from exc


def require_api_auth(authorization: str | None = Header(default=None)) -> None:
    expected = os.getenv("PAIOS_API_AUTH_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=503, detail="Connector API is locked. Configure PAIOS_API_AUTH_TOKEN on the API host.")
    supplied = authorization.removeprefix("Bearer ").strip() if authorization else ""
    if not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Authentication required.")


def _redirect_uri(provider: str) -> str:
    configured = os.getenv("PAIOS_OAUTH_REDIRECT_BASE", "").rstrip("/")
    if not configured.startswith("https://"):
        raise HTTPException(status_code=503, detail="Set PAIOS_OAUTH_REDIRECT_BASE to the public HTTPS API base URL.")
    return f"{configured}/api/v1/connectors/{provider}/callback"


class ConnectorStatus(BaseModel):
    id: str
    name: str
    connected: bool
    scopes: list[str] = Field(default_factory=list)
    account: str | None = None


@router.get("/catalog", dependencies=[Depends(require_api_auth)])
async def catalog() -> dict[str, Any]:
    with _db() as db:
        connected = {row["provider"] for row in db.execute("SELECT provider FROM connected_accounts").fetchall()}
    return {"connectors": [{"id": key, "name": item["label"], "auth": "oauth2_pkce", "scopes": item["scopes"], "connected": key in connected} for key, item in PROVIDERS.items()]}


@router.get("", dependencies=[Depends(require_api_auth)])
async def list_connectors() -> dict[str, Any]:
    with _db() as db:
        rows = db.execute("SELECT provider, account_label, scopes, updated_at FROM connected_accounts ORDER BY provider").fetchall()
    by_id = {row["provider"]: row for row in rows}
    return {"connectors": [{"id": key, "name": item["label"], "connected": key in by_id, "account": by_id[key]["account_label"] if key in by_id else None, "scopes": json.loads(by_id[key]["scopes"]) if key in by_id else []} for key, item in PROVIDERS.items()]}


def _create_authorization_url(provider: str) -> str:
    config = PROVIDERS.get(provider)
    if not config:
        raise HTTPException(status_code=404, detail="Connector is not supported.")
    client_id = os.getenv(config["client_id_env"], "")
    if not client_id:
        raise HTTPException(status_code=503, detail=f"Configure {config['client_id_env']} on the API host.")
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    with _db() as db:
        db.execute("DELETE FROM oauth_states WHERE expires_at < ?", (int(time.time()),))
        db.execute("INSERT INTO oauth_states(state_hash, provider, verifier, expires_at) VALUES(?,?,?,?)", (hashlib.sha256(state.encode()).hexdigest(), provider, verifier, int(time.time()) + 600))
    params = {"client_id": client_id, "redirect_uri": _redirect_uri(provider), "response_type": "code", "scope": " ".join(config["scopes"]), "state": state, "code_challenge": challenge, "code_challenge_method": "S256", **config["extra"]}
    return f"{config['authorize']}?{urlencode(params)}"


@router.post("/{provider}/authorize", dependencies=[Depends(require_api_auth)])
async def authorize(provider: str) -> dict[str, str]:
    return {"authorization_url": _create_authorization_url(provider)}


@router.get("/{provider}/connect", dependencies=[Depends(require_api_auth)])
async def connect(provider: str) -> RedirectResponse:
    return RedirectResponse(_create_authorization_url(provider), status_code=302)

@router.get("/{provider}/callback")
async def callback(provider: str, code: str = Query(min_length=1, max_length=4096), state: str = Query(min_length=20, max_length=256), error: str | None = None) -> RedirectResponse:
    if error:
        return RedirectResponse(os.getenv("PAIOS_OAUTH_FAILURE_REDIRECT", "paios://connectors?status=cancelled"), status_code=303)
    config = PROVIDERS.get(provider)
    if not config:
        raise HTTPException(status_code=404, detail="Connector is not supported.")
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    with _db() as db:
        row = db.execute("SELECT verifier FROM oauth_states WHERE state_hash=? AND provider=? AND expires_at>=?", (state_hash, provider, int(time.time()))).fetchone()
        if not row:
            raise HTTPException(status_code=400, detail="OAuth state is invalid or expired. Restart connection.")
        db.execute("DELETE FROM oauth_states WHERE state_hash=?", (state_hash,))
    client_id = os.getenv(config["client_id_env"], "")
    client_secret = os.getenv(config["client_secret_env"], "")
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail="OAuth client credentials are not configured on the API host.")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(config["token"], data={"client_id": client_id, "client_secret": client_secret, "code": code, "code_verifier": row["verifier"], "redirect_uri": _redirect_uri(provider), "grant_type": "authorization_code"}, headers={"Accept": "application/json"})
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"{config['label']} OAuth token exchange failed ({response.status_code}).")
        tokens = response.json()
        if "access_token" not in tokens:
            raise HTTPException(status_code=502, detail="OAuth provider did not return an access token.")
        account_label = "Connected account"
        if provider == "google":
            profile = await client.get("https://www.googleapis.com/oauth2/v2/userinfo", headers={"Authorization": f"Bearer {tokens['access_token']}"})
            if profile.is_success:
                account_label = str(profile.json().get("email") or account_label)[:254]
        else:
            profile = await client.get("https://api.github.com/user", headers={"Authorization": f"Bearer {tokens['access_token']}", "Accept": "application/vnd.github+json"})
            if profile.is_success:
                account_label = str(profile.json().get("login") or account_label)[:254]
    cipher, nonce = _encrypt(tokens)
    expires = int(time.time()) + int(tokens.get("expires_in", 3600))
    with _db() as db:
        db.execute("INSERT INTO connected_accounts(provider, account_label, token_cipher, nonce, scopes, expires_at, updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(provider) DO UPDATE SET account_label=excluded.account_label, token_cipher=excluded.token_cipher, nonce=excluded.nonce, scopes=excluded.scopes, expires_at=excluded.expires_at, updated_at=excluded.updated_at", (provider, account_label, cipher, nonce, json.dumps(config["scopes"]), expires, int(time.time())))
    return RedirectResponse(os.getenv("PAIOS_OAUTH_SUCCESS_REDIRECT", "paios://connectors?status=connected"), status_code=303)


@router.delete("/{provider}", dependencies=[Depends(require_api_auth)])
async def disconnect(provider: str) -> dict[str, str]:
    if provider not in PROVIDERS:
        raise HTTPException(status_code=404, detail="Connector is not supported.")
    with _db() as db:
        row = db.execute("SELECT token_cipher, nonce FROM connected_accounts WHERE provider=?", (provider,)).fetchone()
        if row:
            token = _decrypt(row["token_cipher"], row["nonce"])
            revoke_url = PROVIDERS[provider]["revoke"]
            if revoke_url and token.get("refresh_token"):
                async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                    await client.post(revoke_url, data={"token": token["refresh_token"]})
            db.execute("DELETE FROM connected_accounts WHERE provider=?", (provider,))
    return {"status": "disconnected", "provider": provider}


async def get_access_token(provider: str) -> str:
    config = PROVIDERS.get(provider)
    if not config:
        raise HTTPException(status_code=404, detail="Connector is not supported.")
    with _db() as db:
        row = db.execute("SELECT token_cipher, nonce, expires_at FROM connected_accounts WHERE provider=?", (provider,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Connector is not connected.")
    token = _decrypt(row["token_cipher"], row["nonce"])
    if row["expires_at"] and row["expires_at"] < int(time.time()) + 60 and token.get("refresh_token") and provider == "google":
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(config["token"], data={"client_id": os.getenv(config["client_id_env"], ""), "client_secret": os.getenv(config["client_secret_env"], ""), "refresh_token": token["refresh_token"], "grant_type": "refresh_token"})
            if response.is_error:
                raise HTTPException(status_code=502, detail="Google token refresh failed. Reconnect the account.")
            token.update(response.json())
        cipher, nonce = _encrypt(token)
        expires = int(time.time()) + int(token.get("expires_in", 3600))
        with _db() as db:
            db.execute("UPDATE connected_accounts SET token_cipher=?, nonce=?, expires_at=?, updated_at=? WHERE provider=?", (cipher, nonce, expires, int(time.time()), provider))
    return str(token["access_token"])


class GmailSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    max_results: int = Field(default=10, ge=1, le=50)


@router.get("/tools", dependencies=[Depends(require_api_auth)])
async def connector_tools() -> dict[str, Any]:
    return {"tools": [
        {"name": "gmail.search", "connector": "google", "description": "Search Gmail messages using Gmail query syntax", "read_only": True, "required_scope": "https://www.googleapis.com/auth/gmail.readonly"},
        {"name": "drive.search", "connector": "google", "description": "Search Google Drive files by name or fullText", "read_only": True, "required_scope": "https://www.googleapis.com/auth/drive.readonly"},
        {"name": "calendar.list_events", "connector": "google", "description": "List events from the primary Google Calendar", "read_only": True, "required_scope": "https://www.googleapis.com/auth/calendar.readonly"},
        {"name": "github.list_repositories", "connector": "github", "description": "List repositories visible to the connected GitHub account", "read_only": True, "required_scope": "repo"},
    ]}


@router.post("/tools/gmail.search", dependencies=[Depends(require_api_auth)])
async def gmail_search(payload: GmailSearchRequest) -> dict[str, Any]:
    token = await get_access_token("google")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get("https://gmail.googleapis.com/gmail/v1/users/me/messages", params={"q": payload.query, "maxResults": payload.max_results}, headers={"Authorization": f"Bearer {token}"})
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"Gmail search failed ({response.status_code}). Check granted scopes and reconnect.")
        listing = response.json()
        messages = []
        for item in listing.get("messages", []):
            detail = await client.get(f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{item['id']}", params={"format": "metadata", "metadataHeaders": ["Subject", "From", "Date"]}, headers={"Authorization": f"Bearer {token}"})
            if detail.is_success:
                data = detail.json()
                headers = {h.get("name", "").lower(): h.get("value", "") for h in data.get("payload", {}).get("headers", [])}
                messages.append({"id": data.get("id"), "threadId": data.get("threadId"), "subject": headers.get("subject"), "from": headers.get("from"), "date": headers.get("date"), "snippet": data.get("snippet", "")})
    return {"messages": messages, "resultSizeEstimate": listing.get("resultSizeEstimate", 0)}


@router.get("/tools/drive.search", dependencies=[Depends(require_api_auth)])
async def drive_search(q: str = Query(min_length=1, max_length=300), page_size: int = Query(default=10, ge=1, le=50)) -> dict[str, Any]:
    token = await get_access_token("google")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get("https://www.googleapis.com/drive/v3/files", params={"q": f"name contains '{q.replace(chr(39), chr(92)+chr(39))}' or fullText contains '{q.replace(chr(39), chr(92)+chr(39))}'", "pageSize": page_size, "fields": "files(id,name,mimeType,modifiedTime,webViewLink),nextPageToken"}, headers={"Authorization": f"Bearer {token}"})
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"Drive search failed ({response.status_code}). Check granted scopes and reconnect.")
        return response.json()


@router.get("/tools/calendar.list_events", dependencies=[Depends(require_api_auth)])
async def calendar_events(max_results: int = Query(default=20, ge=1, le=100)) -> dict[str, Any]:
    token = await get_access_token("google")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get("https://www.googleapis.com/calendar/v3/calendars/primary/events", params={"maxResults": max_results, "orderBy": "startTime", "singleEvents": "true", "timeMin": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, headers={"Authorization": f"Bearer {token}"})
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"Calendar request failed ({response.status_code}). Check granted scopes and reconnect.")
        return response.json()


@router.get("/tools/github.list_repositories", dependencies=[Depends(require_api_auth)])
async def github_repositories(per_page: int = Query(default=30, ge=1, le=100)) -> dict[str, Any]:
    token = await get_access_token("github")
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.get("https://api.github.com/user/repos", params={"per_page": per_page, "sort": "updated"}, headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
        if response.is_error:
            raise HTTPException(status_code=502, detail=f"GitHub repository request failed ({response.status_code}). Check token permissions and reconnect.")
        return {"repositories": [{"id": item.get("id"), "name": item.get("name"), "full_name": item.get("full_name"), "private": item.get("private"), "html_url": item.get("html_url"), "description": item.get("description")} for item in response.json()]}
