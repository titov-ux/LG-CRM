"""Тесты доски задач: CRUD, kanban, права, уведомления, комментарии."""
from __future__ import annotations

import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.users.models import Role, User
from tests.conftest import _make_user, auth_headers

PASSWORD = "correct-horse-battery-staple"


@pytest_asyncio.fixture()
async def viewer_user(db: AsyncSession) -> User:
    return await _make_user(db, "viewer-tasks@example.com", PASSWORD, Role.viewer, True)


def _create(client: TestClient, headers: dict, **overrides) -> dict:
    payload = {"title": "Подготовить КП для X5", "priority": "high"}
    payload.update(overrides)
    r = client.post("/api/v1/tasks", headers=headers, json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _notifications(client: TestClient, headers: dict) -> list[dict]:
    r = client.get("/api/v1/notifications", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_create_sets_author_and_notifies_assignee(
    client: TestClient, admin_user, recruiter_user
) -> None:
    admin_h = auth_headers(client, admin_user.email)
    task = _create(
        client,
        admin_h,
        description="  Детали в чате  ",
        assigneeId=str(recruiter_user.id),
        dueDate="2026-11-01",
    )
    assert task["authorId"] == str(admin_user.id)
    assert task["assigneeId"] == str(recruiter_user.id)
    assert task["status"] == "todo"
    assert task["description"] == "Детали в чате"
    assert task["dueDate"] == "2026-11-01"
    assert task["completedAt"] is None

    rec_h = auth_headers(client, recruiter_user.email)
    notes = _notifications(client, rec_h)
    assert any(
        n["entityType"] == "task" and n["entityId"] == task["id"] and n["kind"] == "assignment"
        for n in notes
    )
    # Самому себе уведомление не шлём.
    assert not any(n.get("entityId") == task["id"] for n in _notifications(client, admin_h))


def test_list_filters_and_search(client: TestClient, admin_user, recruiter_user) -> None:
    h = auth_headers(client, admin_user.email)
    mine = _create(client, h, title="Позвонить в Сбер", assigneeId=str(recruiter_user.id))
    _create(client, h, title="Обновить договор", priority="low")

    r = client.get(
        "/api/v1/tasks", headers=h, params={"assigneeId": str(recruiter_user.id)}
    )
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert mine["id"] in [t["id"] for t in items]
    assert {t["assigneeId"] for t in items} == {str(recruiter_user.id)}

    r = client.get("/api/v1/tasks", headers=h, params={"search": "ДОГОВОР"})
    titles = [t["title"] for t in r.json()["items"]]
    assert "Обновить договор" in titles
    assert "Позвонить в Сбер" not in titles

    r = client.get("/api/v1/tasks", headers=h, params={"priority": "low"})
    assert {t["priority"] for t in r.json()["items"]} == {"low"}


def test_kanban_reorder_to_done_marks_completed_and_notifies_author(
    client: TestClient, admin_user, recruiter_user
) -> None:
    admin_h = auth_headers(client, admin_user.email)
    task = _create(client, admin_h, assigneeId=str(recruiter_user.id))

    rec_h = auth_headers(client, recruiter_user.email)
    r = client.put(
        "/api/v1/tasks/kanban-order",
        headers=rec_h,
        json={"updates": [{"id": task["id"], "status": "done", "kanbanOrder": 0}]},
    )
    assert r.status_code == 200, r.text
    moved = r.json()[0]
    assert moved["status"] == "done"
    assert moved["completedAt"] is not None

    notes = _notifications(client, admin_h)
    assert any(
        n["entityId"] == task["id"] and n["kind"] == "status_change" for n in notes
    )

    # Возврат из «Готово» сбрасывает completedAt.
    r = client.patch(
        f"/api/v1/tasks/{task['id']}/status", headers=rec_h, json={"status": "in_progress"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["completedAt"] is None

    r = client.get(f"/api/v1/tasks/{task['id']}/activity", headers=admin_h)
    assert r.status_code == 200, r.text
    texts = [a["text"] for a in r.json()]
    assert any("В работе" in t for t in texts)
    assert any("Готово" in t for t in texts)


def test_update_reassign_notifies_new_assignee(
    client: TestClient, admin_user, recruiter_user, account_manager_user
) -> None:
    admin_h = auth_headers(client, admin_user.email)
    task = _create(client, admin_h, assigneeId=str(recruiter_user.id))
    r = client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=admin_h,
        json={"assigneeId": str(account_manager_user.id), "title": "Новое название"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["assigneeId"] == str(account_manager_user.id)
    assert r.json()["title"] == "Новое название"

    am_h = auth_headers(client, account_manager_user.email)
    assert any(n["entityId"] == task["id"] for n in _notifications(client, am_h))


def test_inactive_assignee_rejected(client: TestClient, admin_user, inactive_user) -> None:
    h = auth_headers(client, admin_user.email)
    r = client.post(
        "/api/v1/tasks",
        headers=h,
        json={"title": "Задача", "assigneeId": str(inactive_user.id)},
    )
    assert r.status_code == 422, r.text


def test_viewer_cannot_create(client: TestClient, viewer_user) -> None:
    h = auth_headers(client, viewer_user.email)
    r = client.post("/api/v1/tasks", headers=h, json={"title": "Нельзя"})
    assert r.status_code == 403, r.text


def test_delete_only_author_or_admin(
    client: TestClient, admin_user, recruiter_user, account_manager_user
) -> None:
    rec_h = auth_headers(client, recruiter_user.email)
    task = _create(client, rec_h)

    am_h = auth_headers(client, account_manager_user.email)
    r = client.delete(f"/api/v1/tasks/{task['id']}", headers=am_h)
    assert r.status_code == 403, r.text

    r = client.delete(f"/api/v1/tasks/{task['id']}", headers=rec_h)
    assert r.status_code == 200, r.text
    r = client.get(f"/api/v1/tasks/{task['id']}", headers=rec_h)
    assert r.status_code == 404

    other = _create(client, rec_h, title="Ещё одна")
    admin_h = auth_headers(client, admin_user.email)
    r = client.delete(f"/api/v1/tasks/{other['id']}", headers=admin_h)
    assert r.status_code == 200, r.text


def test_comment_on_task_notifies_assignee(
    client: TestClient, admin_user, recruiter_user
) -> None:
    admin_h = auth_headers(client, admin_user.email)
    task = _create(client, admin_h, assigneeId=str(recruiter_user.id))
    r = client.post(
        "/api/v1/comments",
        headers=admin_h,
        json={"entityType": "task", "entityId": task["id"], "text": "Есть вопросы по КП"},
    )
    assert r.status_code in (200, 201), r.text

    rec_h = auth_headers(client, recruiter_user.email)
    assert any(
        n["entityId"] == task["id"] and n["kind"] == "comment"
        for n in _notifications(client, rec_h)
    )
