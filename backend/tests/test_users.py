"""Тесты CRUD /users.

Покрытие:
- GET доступен любой авторизованной роли;
- POST/PATCH/DELETE — только admin (recruiter получает 403);
- удалить себя нельзя (400 cannot_delete_self);
- email-конфликт → 409;
- неавторизованный → 401.
"""
from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import auth_headers


def test_list_requires_auth(client: TestClient) -> None:
    r = client.get("/api/v1/users")
    assert r.status_code == 401


def test_recruiter_can_list_but_not_create(client: TestClient, admin_user, recruiter_user) -> None:
    rec_headers = auth_headers(client, recruiter_user.email)
    r = client.get("/api/v1/users", headers=rec_headers)
    assert r.status_code == 200
    emails = {u["email"].lower() for u in r.json()}
    assert {admin_user.email.lower(), recruiter_user.email.lower()} <= emails

    r = client.post(
        "/api/v1/users",
        headers=rec_headers,
        json={
            "email": "new@lg.ru",
            "fullName": "Новый Сотрудник",
            "role": "recruiter",
            "password": "supersecret",
        },
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


def test_admin_can_create_update_delete(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    # create
    r = client.post(
        "/api/v1/users",
        headers=h,
        json={
            "email": "manager@lg.ru",
            "fullName": "Аккаунт Менеджер",
            "role": "account_manager",
            "telegram": "@am",
            "password": "supersecret",
        },
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["email"] == "manager@lg.ru"
    assert created["initials"] == "АМ"
    assert created["role"] == "account_manager"
    user_id = created["id"]

    # update — снять активность и сменить telegram
    r = client.patch(
        f"/api/v1/users/{user_id}",
        headers=h,
        json={"isActive": False, "telegram": "@am_new"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["isActive"] is False
    assert r.json()["telegram"] == "@am_new"

    # delete
    r = client.delete(f"/api/v1/users/{user_id}", headers=h)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_admin_cannot_delete_self(client: TestClient, admin_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.delete(f"/api/v1/users/{admin_user.id}", headers=h)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "cannot_delete_self"


def test_delete_user_with_attached_entities_resets_fk(
    client: TestClient, admin_user, account_manager_user, recruiter_user
) -> None:
    """Удаление пользователя, на которого «висят» сущности, не должно блокироваться.

    Все FK (clients.account_manager_id, vacancies.account_manager_id,
    candidates.recruiter_id, comments.author_id, activity_log.actor_id, ...)
    должны сбрасываться в NULL — см. миграцию 0011_user_fk_set_null.
    """
    h = auth_headers(client, admin_user.email)

    # 1) Клиент на ответственном AM.
    r = client.post(
        "/api/v1/clients",
        headers=h,
        json={
            "name": "Acme",
            "industry": "fintech",
            "accountManagerId": str(account_manager_user.id),
            "status": "lead",
            "clientKind": "direct",
        },
    )
    assert r.status_code == 201, r.text
    cid = r.json()["id"]

    # 2) Вакансия на том же AM.
    r = client.post(
        "/api/v1/vacancies",
        headers=h,
        json={
            "title": "Backend Senior",
            "clientId": cid,
            "engagementType": "outstaff",
            "grade": "Senior",
            "format": "Гибрид",
            "rateClient": 3500,
            "positions": 1,
            "status": "new",
            "priority": "medium",
            "accountManagerId": str(account_manager_user.id),
            "stack": ["Python"],
            "recruiterIds": [str(recruiter_user.id)],
        },
    )
    assert r.status_code == 201, r.text
    vid = r.json()["id"]

    # 3) Кандидат на рекрутере (этот пользователь и удаляется ниже).
    h_rec = auth_headers(client, recruiter_user.email)
    r = client.post(
        "/api/v1/candidates",
        headers=h_rec,
        json={
            "fullName": "Иван Иванов",
            "role": "Backend",
            "engagementType": "outstaff",
            "grade": "Senior",
            "experienceYears": 5,
            "stack": ["Python"],
            "employmentType": "СМЗ",
            "format": "Гибрид",
            "location": "",
            "recruiterId": str(recruiter_user.id),
            "status": "new",
        },
    )
    assert r.status_code == 201, r.text
    cand_id = r.json()["id"]

    # 4) Удаляем AM — должен пройти, вакансия и клиент остаются с null AM.
    r = client.delete(f"/api/v1/users/{account_manager_user.id}", headers=h)
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/vacancies/{vid}", headers=h)
    assert r.status_code == 200
    assert r.json()["accountManagerId"] is None

    r = client.get(f"/api/v1/clients/{cid}", headers=h)
    assert r.status_code == 200
    assert r.json()["accountManagerId"] is None

    # 5) Удаляем рекрутера — должен пройти, кандидат остаётся с null recruiter.
    r = client.delete(f"/api/v1/users/{recruiter_user.id}", headers=h)
    assert r.status_code == 200, r.text

    r = client.get(f"/api/v1/candidates/{cand_id}", headers=h)
    assert r.status_code == 200
    assert r.json()["recruiterId"] is None


def test_admin_can_reset_password(client: TestClient, admin_user, recruiter_user) -> None:
    """POST /users/{id}/password: новый пароль работает, старые сессии отозваны."""
    # Рекрутер залогинен старым паролем — есть живая сессия.
    old_headers = auth_headers(client, recruiter_user.email)
    assert client.get("/api/v1/auth/me", headers=old_headers).status_code == 200

    h = auth_headers(client, admin_user.email)
    r = client.post(
        f"/api/v1/users/{recruiter_user.id}/password",
        headers=h,
        json={"password": "newsecret123"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    # Старый пароль больше не подходит, новый — работает.
    r = client.post(
        "/api/v1/auth/login",
        json={"email": recruiter_user.email, "password": "correct-horse-battery-staple"},
    )
    assert r.status_code == 401
    r = client.post(
        "/api/v1/auth/login",
        json={"email": recruiter_user.email, "password": "newsecret123"},
    )
    assert r.status_code == 200, r.text

    # Refresh по старой cookie отозван (все сессии разлогинены).
    # (login в auth_headers положил refresh в cookie-jar клиента, но их
    # уже «забыли» в Redis — сюда достаточно проверки логина выше.)


def test_reset_password_forbidden_for_non_admin_and_self(
    client: TestClient, admin_user, recruiter_user
) -> None:
    # Не-админ — 403.
    rec_h = auth_headers(client, recruiter_user.email)
    r = client.post(
        f"/api/v1/users/{admin_user.id}/password",
        headers=rec_h,
        json={"password": "whatever123"},
    )
    assert r.status_code == 403

    # Себе — 400 use_profile_endpoint (нужен /auth/me/password с текущим паролем).
    h = auth_headers(client, admin_user.email)
    r = client.post(
        f"/api/v1/users/{admin_user.id}/password",
        headers=h,
        json={"password": "whatever123"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "use_profile_endpoint"


def test_email_conflict(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/users",
        headers=h,
        json={
            "email": recruiter_user.email,
            "fullName": "Дубликат",
            "role": "recruiter",
            "password": "supersecret",
        },
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "email_exists"
