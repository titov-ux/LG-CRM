"""Бизнес-логика login_snapshots: запись снимка входа и чтение журнала.

Загрузка кадра идёт server-side (через `S3Adapter.upload_bytes`), а не через
presigned-POST: объект маленький (десятки КБ JPEG), делается ровно один раз при
входе, и нам всё равно нужно синхронно создать строку журнала — лишний round-trip
браузер→S3 тут не оправдан.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.s3 import S3Adapter, make_login_snapshot_key
from app.modules.login_snapshots.models import LoginSnapshot, SnapshotStatus
from app.modules.login_snapshots.schemas import LoginSnapshotItem
from app.modules.users.models import User

UTC = timezone.utc

# Разрешённые форматы кадра и лимит размера. Фронт отдаёт JPEG ~30–120 КБ;
# держим запас, но отсекаем явные злоупотребления.
ALLOWED_IMAGE_MIME: frozenset[str] = frozenset({"image/jpeg", "image/png", "image/webp"})
MAX_SNAPSHOT_BYTES: int = 3 * 1024 * 1024  # 3 МБ

# TTL presigned-GET для просмотра кадра в админке.
VIEW_URL_TTL_SECONDS: int = 300


async def record_snapshot(
    db: AsyncSession,
    s3: S3Adapter,
    *,
    user: User,
    status: SnapshotStatus,
    image_bytes: bytes | None,
    content_type: str | None,
    ip: str | None,
    user_agent: str | None,
) -> LoginSnapshot:
    """Создать запись журнала входа и, если есть кадр, загрузить его в S3.

    Если `status == ok`, но кадр отсутствует/пустой — понижаем до `error`, чтобы
    в журнале не было «ok без картинки». Ошибку загрузки в S3 тоже фиксируем как
    `error` со строкой без `s3_key`: сам факт входа не теряем.
    """
    s3_key: str | None = None
    size: int | None = None
    effective_status = status
    effective_ct = content_type if content_type in ALLOWED_IMAGE_MIME else None

    if status == SnapshotStatus.ok:
        if not image_bytes:
            effective_status = SnapshotStatus.error
        elif len(image_bytes) > MAX_SNAPSHOT_BYTES:
            effective_status = SnapshotStatus.error
        else:
            key = make_login_snapshot_key(user_id=user.id, taken_at=datetime.now(UTC))
            try:
                s3.upload_bytes(
                    file_key=key,
                    data=image_bytes,
                    mime=effective_ct or "image/jpeg",
                )
                s3_key = key
                size = len(image_bytes)
            except Exception:  # noqa: BLE001 — вход важнее, чем загрузка кадра
                effective_status = SnapshotStatus.error

    entry = LoginSnapshot(
        user_id=user.id,
        status=effective_status,
        s3_key=s3_key,
        content_type=effective_ct if s3_key else None,
        size_bytes=size,
        ip=ip,
        user_agent=(user_agent or "")[:512] or None,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def list_snapshots(
    db: AsyncSession,
    s3: S3Adapter,
    *,
    user_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 200,
) -> list[LoginSnapshotItem]:
    """Журнал снимков для админки: JOIN на users + presigned-GET на кадр."""
    q = (
        select(LoginSnapshot, User.full_name, User.email)
        .join(User, User.id == LoginSnapshot.user_id, isouter=True)
        .order_by(LoginSnapshot.created_at.desc())
    )
    if user_id:
        q = q.where(LoginSnapshot.user_id == user_id)
    if date_from:
        q = q.where(
            LoginSnapshot.created_at >= datetime.combine(date_from, datetime.min.time())
        )
    if date_to:
        q = q.where(
            LoginSnapshot.created_at <= datetime.combine(date_to, datetime.max.time())
        )
    q = q.limit(min(max(limit, 1), 500))

    rows: Sequence = (await db.execute(q)).all()
    items: list[LoginSnapshotItem] = []
    for snap, full_name, email in rows:
        image_url = None
        if snap.s3_key:
            try:
                image_url = s3.presign_get(file_key=snap.s3_key, expires_in=VIEW_URL_TTL_SECONDS)
            except Exception:  # noqa: BLE001 — битый/недоступный объект не должен ронять список
                image_url = None
        items.append(
            LoginSnapshotItem(
                id=snap.id,
                user_id=snap.user_id,
                user_full_name=full_name,
                user_email=email,
                status=snap.status,
                image_url=image_url,
                ip=snap.ip,
                user_agent=snap.user_agent,
                created_at=snap.created_at,
            )
        )
    return items
