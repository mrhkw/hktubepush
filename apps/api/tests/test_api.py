from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint_returns_service_status() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "personal-ai-api"}


def test_provider_status_never_returns_credentials(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    response = client.get("/api/v1/providers")
    assert response.status_code == 200
    assert response.json()["configured"]["openai"] is True
    assert "test-secret" not in response.text


def test_chat_rejects_unconfigured_provider(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    response = client.post(
        "/api/v1/chat",
        json={"provider": "openai", "message": "Hello"},
    )
    assert response.status_code == 503
    assert "not configured" in response.json()["detail"]
