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
