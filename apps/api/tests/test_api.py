from fastapi.testclient import TestClient

from app.main import app, model_for

client = TestClient(app)


def test_health_endpoint_returns_service_status() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "personal-ai-api"}


def test_provider_status_never_returns_credentials(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    monkeypatch.setenv("GROQ_API_KEY", "groq-secret")
    response = client.get("/api/v1/providers")
    assert response.status_code == 200
    assert response.json()["configured"]["openai"] is True
    assert response.json()["configured"]["groq"] is True
    assert "test-secret" not in response.text
    assert "groq-secret" not in response.text


def test_chat_rejects_unconfigured_provider(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = client.post("/api/v1/chat", json={"provider": "openai", "message": "Hello"})
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]


def test_gemini_model_prefix_is_normalized() -> None:
    assert model_for("gemini", "models/gemini-2.5-flash") == "gemini-2.5-flash"


def test_invalid_model_identifier_is_rejected() -> None:
    response = client.post("/api/v1/chat", json={"provider": "gemini", "model": "../bad", "message": "Hello"})
    assert response.status_code == 422


def test_groq_provider_is_supported(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "groq-test")
    response = client.get("/api/v1/providers")
    assert response.json()["configured"]["groq"] is True


def test_connector_routes_require_api_auth(monkeypatch) -> None:
    monkeypatch.setenv("PAIOS_API_AUTH_TOKEN", "private-test-token")
    response = client.get("/api/v1/connectors")
    assert response.status_code == 401


def test_connector_catalog_is_available_after_auth(monkeypatch) -> None:
    monkeypatch.setenv("PAIOS_API_AUTH_TOKEN", "private-test-token")
    response = client.get("/api/v1/connectors/catalog", headers={"Authorization": "Bearer private-test-token"})
    assert response.status_code == 200
    ids = {item["id"] for item in response.json()["connectors"]}
    assert {"google", "github"} <= ids


def test_connector_token_encryption_round_trip(monkeypatch) -> None:
    import base64
    from app.connectors import _decrypt, _encrypt

    monkeypatch.setenv("PAIOS_ENCRYPTION_KEY", base64.urlsafe_b64encode(b"x" * 32).decode())
    cipher, nonce = _encrypt({"access_token": "secret-token"})
    assert b"secret-token" not in cipher
    assert _decrypt(cipher, nonce) == {"access_token": "secret-token"}
