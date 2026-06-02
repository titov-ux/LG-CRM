"""E2E-тесты чата — Этап 6 плана.

Покрывают критичные сценарии (см. §3 Этап 6 acceptance):
  • audience-фильтрация: посторонний третий пользователь не получает событий
    DM-диалога; в выдаче /chat/conversations его тоже нет;
  • soft-delete: text затирается, deletedAt проставлен, id остаётся;
  • поиск (FTS) уважает приватность: чужие диалоги не попадают в выдачу;
  • mute блокирует Notification, но не realtime-доставку сообщений.

Реалтайм-ивенты бэк публикует синхронно — для тестов хватает дёргать
эндпоинты и читать БД/Notifications, без поднятия WebSocket-клиента.
"""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.chat.models import ChatMessage
from app.modules.notifications.models import (
    Notification,
    NotificationEntityType,
    NotificationKind,
)
from app.modules.users.models import Role, User

from .conftest import _make_user, auth_headers


# === fixtures ==============================================================


@pytest_asyncio.fixture()
async def alice(db: AsyncSession) -> User:
    return await _make_user(db, "alice@lg.ru", "correct-horse-battery-staple", Role.recruiter, True)


@pytest_asyncio.fixture()
async def bob(db: AsyncSession) -> User:
    return await _make_user(db, "bob@lg.ru", "correct-horse-battery-staple", Role.recruiter, True)


@pytest_asyncio.fixture()
async def carol(db: AsyncSession) -> User:
    return await _make_user(db, "carol@lg.ru", "correct-horse-battery-staple", Role.recruiter, True)


def _create_dm(client: TestClient, headers: dict, peer_id: uuid.UUID) -> dict:
    r = client.post(
        "/api/v1/chat/conversations/dm",
        json={"peerUserId": str(peer_id)},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


def _post_message(
    client: TestClient,
    headers: dict,
    conv_id: str,
    text: str,
) -> dict:
    r = client.post(
        f"/api/v1/chat/conversations/{conv_id}/messages",
        json={"text": text},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


# === tests =================================================================


def test_dm_is_visible_only_to_participants(
    client: TestClient, alice: User, bob: User, carol: User
) -> None:
    """audience-фильтр: посторонний user не видит DM ни в списке, ни в карточке."""
    h_alice = auth_headers(client, alice.email)
    h_carol = auth_headers(client, carol.email)

    conv = _create_dm(client, h_alice, bob.id)
    _post_message(client, h_alice, conv["id"], "secret")

    # У Кэрол этого DM нет в списке.
    r = client.get("/api/v1/chat/conversations", headers=h_carol)
    assert r.status_code == 200
    assert all(c["id"] != conv["id"] for c in r.json())

    # И карточка — 403.
    r = client.get(f"/api/v1/chat/conversations/{conv['id']}", headers=h_carol)
    assert r.status_code == 403


def test_soft_delete_blanks_text_but_keeps_id(
    client: TestClient, alice: User, bob: User, db: AsyncSession
) -> None:
    h_alice = auth_headers(client, alice.email)
    conv = _create_dm(client, h_alice, bob.id)
    msg = _post_message(client, h_alice, conv["id"], "to be deleted")

    r = client.delete(
        f"/api/v1/chat/conversations/{conv['id']}/messages/{msg['id']}",
        headers=h_alice,
    )
    assert r.status_code == 200

    # Проверяем через эндпоинт списка — text пустой, deletedAt не null,
    # id сообщения сохранился.
    r = client.get(
        f"/api/v1/chat/conversations/{conv['id']}/messages",
        headers=h_alice,
    )
    items = r.json()["items"]
    found = [m for m in items if m["id"] == msg["id"]]
    assert len(found) == 1
    assert found[0]["text"] == ""
    assert found[0]["deletedAt"] is not None


def test_delete_dm_removes_conversation_for_all_participants(
    client: TestClient, alice: User, bob: User
) -> None:
    h_alice = auth_headers(client, alice.email)
    h_bob = auth_headers(client, bob.email)
    conv = _create_dm(client, h_alice, bob.id)

    r = client.delete(
        f"/api/v1/chat/conversations/{conv['id']}",
        headers=h_alice,
    )
    assert r.status_code == 200, r.text

    # Диалог физически удалён: у обоих участников его больше нет в списке.
    r = client.get("/api/v1/chat/conversations", headers=h_alice)
    assert r.status_code == 200
    assert all(c["id"] != conv["id"] for c in r.json())

    r = client.get("/api/v1/chat/conversations", headers=h_bob)
    assert r.status_code == 200
    assert all(c["id"] != conv["id"] for c in r.json())

    # Карточка удалённого диалога не доступна.
    r = client.get(
        f"/api/v1/chat/conversations/{conv['id']}",
        headers=h_alice,
    )
    assert r.status_code == 404


def test_search_respects_privacy(
    client: TestClient, alice: User, bob: User, carol: User
) -> None:
    """Кэрол не видит результатов поиска по чужой DM-переписке."""
    h_alice = auth_headers(client, alice.email)
    h_carol = auth_headers(client, carol.email)

    conv = _create_dm(client, h_alice, bob.id)
    _post_message(client, h_alice, conv["id"], "уникальное_слово_xyzzy")

    r = client.get(
        "/api/v1/chat/search",
        params={"q": "уникальное_слово_xyzzy"},
        headers=h_carol,
    )
    assert r.status_code == 200
    assert r.json()["items"] == []

    # Алиса то же слово находит.
    r = client.get(
        "/api/v1/chat/search",
        params={"q": "уникальное_слово_xyzzy"},
        headers=h_alice,
    )
    assert r.status_code == 200
    assert len(r.json()["items"]) >= 1


def _create_group(
    client: TestClient, headers: dict, title: str, member_ids: list[uuid.UUID]
) -> dict:
    r = client.post(
        "/api/v1/chat/conversations/group",
        json={"title": title, "memberIds": [str(m) for m in member_ids]},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()


@pytest_asyncio.fixture()
async def dave(db: AsyncSession) -> User:
    return await _make_user(db, "dave@lg.ru", "correct-horse-battery-staple", Role.recruiter, True)


@pytest.mark.asyncio
async def test_mention_all_notifies_everyone_except_author(
    client: TestClient,
    alice: User,
    bob: User,
    carol: User,
    dave: User,
    db: AsyncSession,
) -> None:
    """Сообщение `<@all>` в групповом чате создаёт Notification всем
    участникам диалога кроме автора. Постороннему (`dave`, не член группы)
    ничего не приходит.
    """
    h_alice = auth_headers(client, alice.email)
    conv = _create_group(client, h_alice, "Команда", [bob.id, carol.id])

    _post_message(client, h_alice, conv["id"], "доброе утро <@all>")

    rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.mention,
            )
        )
    ).scalars().all()
    recipient_ids = {n.user_id for n in rows}
    assert recipient_ids == {bob.id, carol.id}
    # Автор сам себе не нотифится.
    assert alice.id not in recipient_ids
    # Посторонний — не член группы — не получает уведомления.
    assert dave.id not in recipient_ids
    # payload помечен mentionAll=True — пригодится UI для бейджа.
    for n in rows:
        assert n.payload.get("mentionAll") is True


@pytest.mark.asyncio
async def test_mention_all_respects_mute(
    client: TestClient,
    alice: User,
    bob: User,
    carol: User,
    db: AsyncSession,
) -> None:
    """Если кто-то заmute-ил диалог, `<@all>` его не разбудит — это та же
    политика, что и для персонального упоминания.
    """
    h_alice = auth_headers(client, alice.email)
    h_bob = auth_headers(client, bob.email)
    conv = _create_group(client, h_alice, "Команда", [bob.id, carol.id])

    r = client.post(
        f"/api/v1/chat/conversations/{conv['id']}/mute",
        json={"until": "2099-12-31T23:59:59+00:00"},
        headers=h_bob,
    )
    assert r.status_code == 200

    _post_message(client, h_alice, conv["id"], "<@all> срочно")

    rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.mention,
            )
        )
    ).scalars().all()
    recipient_ids = {n.user_id for n in rows}
    assert recipient_ids == {carol.id}
    assert bob.id not in recipient_ids


@pytest.mark.asyncio
async def test_mention_all_on_edit_notifies_new(
    client: TestClient,
    alice: User,
    bob: User,
    carol: User,
    db: AsyncSession,
) -> None:
    """Если в исходном сообщении `<@all>` не было, а на edit-е появился —
    нотифим всех участников (кроме автора), как при первичном post.
    Повторный edit не должен слать дубль.
    """
    h_alice = auth_headers(client, alice.email)
    conv = _create_group(client, h_alice, "Команда", [bob.id, carol.id])
    msg = _post_message(client, h_alice, conv["id"], "пока без all")

    # До edit-а никаких mention-нотификаций нет.
    pre = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.mention,
            )
        )
    ).scalars().all()
    assert pre == []

    r = client.patch(
        f"/api/v1/chat/conversations/{conv['id']}/messages/{msg['id']}",
        json={"text": "теперь <@all> точно"},
        headers=h_alice,
    )
    assert r.status_code == 200, r.text

    rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.mention,
            )
        )
    ).scalars().all()
    assert {n.user_id for n in rows} == {bob.id, carol.id}

    # Второй edit с тем же <@all> не должен порождать дубль.
    r2 = client.patch(
        f"/api/v1/chat/conversations/{conv['id']}/messages/{msg['id']}",
        json={"text": "ещё раз <@all> точно"},
        headers=h_alice,
    )
    assert r2.status_code == 200
    rows2 = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.mention,
            )
        )
    ).scalars().all()
    assert len(rows2) == 2  # столько же, никаких дублей


@pytest.mark.asyncio
async def test_mention_all_in_dm_notifies_peer(
    client: TestClient, alice: User, bob: User, db: AsyncSession
) -> None:
    """В DM `<@all>` адресует ровно одного «всех» — собеседника. Простая
    sanity-проверка, чтобы поведение DM совпадало с групповым.
    """
    h_alice = auth_headers(client, alice.email)
    conv = _create_dm(client, h_alice, bob.id)
    _post_message(client, h_alice, conv["id"], "<@all> привет")

    rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.mention,
            )
        )
    ).scalars().all()
    assert {n.user_id for n in rows} == {bob.id}


@pytest.mark.asyncio
async def test_mute_blocks_notification_but_not_message(
    client: TestClient, alice: User, bob: User, db: AsyncSession
) -> None:
    """Если у Боба mute диалога — упоминание <@bob> от Алисы не создаёт
    Notification, но само сообщение в чате доставляется (соответствующая
    запись chat_messages есть).
    """
    h_alice = auth_headers(client, alice.email)
    h_bob = auth_headers(client, bob.email)

    conv = _create_dm(client, h_alice, bob.id)

    # Боб mute-ит диалог далеко в будущее.
    r = client.post(
        f"/api/v1/chat/conversations/{conv['id']}/mute",
        json={"until": "2099-12-31T23:59:59+00:00"},
        headers=h_bob,
    )
    assert r.status_code == 200

    _post_message(
        client, h_alice, conv["id"], f"hi <@{bob.id}> привет!"
    )

    # Notification для Боба НЕ создан.
    rows = await db.execute(
        select(Notification).where(
            Notification.user_id == bob.id,
            Notification.kind == NotificationKind.mention,
        )
    )
    assert rows.scalar_one_or_none() is None

    # Но само сообщение в БД есть.
    msgs = (
        await db.execute(
            select(ChatMessage).where(ChatMessage.conversation_id == uuid.UUID(conv["id"]))
        )
    ).scalars().all()
    assert any("привет" in m.text_ for m in msgs)


@pytest.mark.asyncio
async def test_dm_message_notifies_peer(
    client: TestClient, alice: User, bob: User, db: AsyncSession
) -> None:
    """Обычное сообщение в личке (DM) создаёт Notification kind=chat_message
    собеседнику, но не автору."""
    h_alice = auth_headers(client, alice.email)
    conv = _create_dm(client, h_alice, bob.id)

    _post_message(client, h_alice, conv["id"], "привет")

    rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.chat_message,
            )
        )
    ).scalars().all()
    recipient_ids = {n.user_id for n in rows}
    assert recipient_ids == {bob.id}
    assert alice.id not in recipient_ids  # автор себе не нотифится
    for n in rows:
        assert n.entity_type == NotificationEntityType.chat_message


@pytest.mark.asyncio
async def test_group_plain_message_does_not_notify(
    client: TestClient,
    alice: User,
    bob: User,
    carol: User,
    db: AsyncSession,
) -> None:
    """В группе обычное сообщение (без упоминаний) НЕ создаёт chat_message —
    группы нотифят только по @-упоминанию."""
    h_alice = auth_headers(client, alice.email)
    conv = _create_group(client, h_alice, "Команда", [bob.id, carol.id])

    _post_message(client, h_alice, conv["id"], "привет всем")

    rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.chat_message,
            )
        )
    ).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_dm_mention_not_double_notified(
    client: TestClient, alice: User, bob: User, db: AsyncSession
) -> None:
    """Если в личке автор ещё и упомянул собеседника — тот получает только
    kind=mention, без дубля kind=chat_message."""
    h_alice = auth_headers(client, alice.email)
    conv = _create_dm(client, h_alice, bob.id)

    _post_message(client, h_alice, conv["id"], f"глянь <@{bob.id}>")

    chat_rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.chat_message,
            )
        )
    ).scalars().all()
    assert chat_rows == []  # есть только mention, дубля нет

    mention_rows = (
        await db.execute(
            select(Notification).where(
                Notification.kind == NotificationKind.mention,
            )
        )
    ).scalars().all()
    assert {n.user_id for n in mention_rows} == {bob.id}


@pytest.mark.asyncio
async def test_dm_message_respects_mute(
    client: TestClient, alice: User, bob: User, db: AsyncSession
) -> None:
    """Если собеседник заmute-ил личку, обычное сообщение не создаёт ему
    Notification kind=chat_message (но сообщение всё равно доставляется)."""
    h_alice = auth_headers(client, alice.email)
    h_bob = auth_headers(client, bob.email)
    conv = _create_dm(client, h_alice, bob.id)

    r = client.post(
        f"/api/v1/chat/conversations/{conv['id']}/mute",
        json={"until": "2099-12-31T23:59:59+00:00"},
        headers=h_bob,
    )
    assert r.status_code == 200

    _post_message(client, h_alice, conv["id"], "ты тут?")

    rows = await db.execute(
        select(Notification).where(
            Notification.user_id == bob.id,
            Notification.kind == NotificationKind.chat_message,
        )
    )
    assert rows.scalar_one_or_none() is None
