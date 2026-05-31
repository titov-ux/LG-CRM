"""Тесты Telegram-интеграции (привязка через вебхук, статус, настройки).

Сеть не нужна: без TELEGRAM_BOT_TOKEN клиент `send_message` тихо превращается
в no-op, а вся доменная логика (токены привязки в Redis/fakeredis, сохранение
chat_id, тумблер) проверяется через публичные эндпоинты.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def test_status_initially_disconnected(client: TestClient, recruiter_user) -> None:
    h = auth_headers(client, recruiter_user.email)
    s = client.get("/api/v1/integrations/telegram/status", headers=h)
    assert s.status_code == 200
    body = s.json()
    assert body["connected"] is False
    # По умолчанию бот не сконфигурирован (нет токена в .env тестов).
    assert body["configured"] is False


def test_link_then_webhook_connects_user(client: TestClient, recruiter_user) -> None:
    h = auth_headers(client, recruiter_user.email)

    link = client.post("/api/v1/integrations/telegram/link/start", headers=h)
    assert link.status_code == 200
    token = link.json()["token"]
    assert token

    # Эмулируем апдейт от Telegram: пользователь нажал Start с deep-link токеном.
    update = {"message": {"chat": {"id": 4242}, "text": f"/start {token}"}}
    wh = client.post("/api/v1/integrations/telegram/webhook", json=update)
    assert wh.status_code == 200
    assert wh.json()["ok"] is True

    s = client.get("/api/v1/integrations/telegram/status", headers=h).json()
    assert s["connected"] is True
    assert s["enabled"] is True


def test_toggle_and_disconnect(client: TestClient, recruiter_user) -> None:
    h = auth_headers(client, recruiter_user.email)
    token = client.post(
        "/api/v1/integrations/telegram/link/start", headers=h
    ).json()["token"]
    client.post(
        "/api/v1/integrations/telegram/webhook",
        json={"message": {"chat": {"id": 9001}, "text": f"/start {token}"}},
    )

    # Выключить доставку.
    s = client.patch(
        "/api/v1/integrations/telegram/settings", headers=h, json={"enabled": False}
    ).json()
    assert s["enabled"] is False
    assert s["connected"] is True

    # Отвязать.
    r = client.post("/api/v1/integrations/telegram/disconnect", headers=h)
    assert r.status_code == 200
    s = client.get("/api/v1/integrations/telegram/status", headers=h).json()
    assert s["connected"] is False


def test_webhook_stale_token_does_not_connect(
    client: TestClient, recruiter_user
) -> None:
    h = auth_headers(client, recruiter_user.email)
    client.post(
        "/api/v1/integrations/telegram/webhook",
        json={"message": {"chat": {"id": 7}, "text": "/start nonexistent-token"}},
    )
    s = client.get("/api/v1/integrations/telegram/status", headers=h).json()
    assert s["connected"] is False


def test_webhook_bad_secret_ignored(client: TestClient, monkeypatch) -> None:
    """Если на сервере задан секрет, апдейт с неверным заголовком игнорируется."""
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "telegram_webhook_secret", "expected-secret")
    r = client.post(
        "/api/v1/integrations/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": "wrong"},
        json={"message": {"chat": {"id": 1}, "text": "/start x"}},
    )
    assert r.status_code == 200
    assert r.json()["ok"] is False
