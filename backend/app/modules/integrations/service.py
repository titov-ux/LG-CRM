"""Сервис интеграции с hh.ru.

Связывает HTTP-клиент `app.integrations.hh` с БД (таблица integration_tokens,
per-user — `uq(provider, user_id)`) и сервисом кандидатов: импорт резюме =
parse_id → fetch → map → create_candidate, всё под токеном текущего пользователя.

Refresh-логика: при каждом fetch_resume проверяем, не истёк ли access_token
(с запасом 5 минут). Если истёк — обновляем через refresh_token прежде чем
звать hh API. Это проще, чем 401 → retry, и не теряет 1 запрос на каждом ротейте.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ApiError
from app.core.redis import get_redis
from app.integrations import hh as hh_client
from app.integrations.hh import (
    HhAuthError,
    HhNotFoundError,
    HhRateLimitError,
    HhUnavailableError,
)
from app.modules.candidates import service as candidates_service
from app.modules.candidates.models import Candidate, CandidateStatus
from app.modules.candidates.schemas import CreateCandidateRequest
from app.modules.integrations.hh_mapper import map_hh_resume_to_candidate
from app.modules.integrations.models import IntegrationToken
from app.modules.matching.models import VacancyCandidate
from app.modules.users.models import Role, User

logger = logging.getLogger(__name__)

_PROVIDER = "hh"
_REFRESH_SKEW = timedelta(minutes=5)
_STATE_TTL_SECONDS = 600  # 10 минут на завершение OAuth-дэнса


# ───────────────────────── OAuth state (CSRF) ─────────────────────────

def _state_key(state: str) -> str:
    return f"hh:oauth:state:{state}"


async def issue_oauth_state(user: User) -> str:
    """Сгенерить state и положить в Redis (TTL 10 минут) — для CSRF-защиты
    и для привязки callback'а к user'у, который начал OAuth."""
    state = secrets.token_urlsafe(24)
    redis = get_redis()
    await redis.setex(_state_key(state), _STATE_TTL_SECONDS, str(user.id))
    return state


async def consume_oauth_state(state: str) -> uuid.UUID:
    """Извлечь user_id, выпустивший state, и сразу удалить (одноразовый)."""
    redis = get_redis()
    key = _state_key(state)
    user_id = await redis.get(key)
    if user_id is None:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "hh_invalid_state",
            "Сессия подключения hh истекла. Начните заново.",
        )
    await redis.delete(key)
    try:
        return uuid.UUID(user_id if isinstance(user_id, str) else user_id.decode())
    except (ValueError, AttributeError) as exc:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST, "hh_invalid_state", "Битый state"
        ) from exc


# ───────────────────────── Token storage (per-user) ─────────────────────────

async def get_token(db: AsyncSession, user_id: uuid.UUID) -> IntegrationToken | None:
    return (
        await db.execute(
            select(IntegrationToken).where(
                IntegrationToken.provider == _PROVIDER,
                IntegrationToken.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def save_token(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    payload: hh_client.HhTokenPayload,
    account_label: str | None,
    connected_by_id: uuid.UUID | None,
) -> IntegrationToken:
    """Upsert строки `(provider='hh', user_id)`."""
    token = await get_token(db, user_id)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=payload.expires_in or 0)
    if token is None:
        token = IntegrationToken(
            provider=_PROVIDER,
            user_id=user_id,
            access_token=payload.access_token,
            refresh_token=payload.refresh_token,
            expires_at=expires_at,
            scope=payload.scope,
            account_label=account_label,
            connected_by_id=connected_by_id,
        )
        db.add(token)
    else:
        token.access_token = payload.access_token
        # hh присылает новый refresh_token при каждом refresh — старый отзывается.
        if payload.refresh_token:
            token.refresh_token = payload.refresh_token
        token.expires_at = expires_at
        if payload.scope:
            token.scope = payload.scope
        if account_label:
            token.account_label = account_label
        if connected_by_id is not None:
            token.connected_by_id = connected_by_id
    await db.commit()
    await db.refresh(token)
    return token


async def _ensure_fresh_access(db: AsyncSession, token: IntegrationToken) -> str:
    """Возвращает живой access_token; рефрешит, если истекает в ближайшие 5 минут."""
    now = datetime.now(timezone.utc)
    if token.expires_at and token.expires_at - now > _REFRESH_SKEW:
        return token.access_token
    try:
        new_payload = await hh_client.refresh_token(token.refresh_token)
    except HhAuthError as exc:
        logger.warning("hh refresh failed (reauth needed): %s", exc)
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "hh_reauth_required",
            "Сессия hh истекла. Подключите аккаунт заново в Настройки → Интеграции.",
        ) from exc
    except HhUnavailableError as exc:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "hh_unavailable",
            "hh.ru временно недоступен. Попробуйте позже.",
        ) from exc
    await save_token(
        db,
        user_id=token.user_id,
        payload=new_payload,
        account_label=token.account_label,
        connected_by_id=token.connected_by_id,
    )
    return new_payload.access_token


# ───────────────────────── OAuth public API ─────────────────────────

def build_authorize_url_for_state(state: str) -> str:
    try:
        return hh_client.build_authorize_url(state)
    except HhUnavailableError as exc:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "hh_not_configured",
            "Интеграция hh.ru не настроена администратором.",
        ) from exc


async def exchange_code_and_save(
    db: AsyncSession, *, code: str, user: User
) -> IntegrationToken:
    """Обмен code → токены и сохранение в БД под user.id.

    Любой авторизованный пользователь может подключить СВОЙ аккаунт hh —
    больше не требует роли admin.
    """
    try:
        payload = await hh_client.exchange_code(code)
    except HhAuthError as exc:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "hh_invalid_code",
            "Код авторизации hh невалиден или уже использован.",
        ) from exc
    except HhUnavailableError as exc:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "hh_unavailable",
            "hh.ru временно недоступен.",
        ) from exc

    # /me — чтобы показать «Подключён как ivanov@company.ru».
    label: str | None = None
    try:
        me = await hh_client.fetch_me(payload.access_token)
        label = (
            me.get("email")
            or me.get("manager_id")
            or " ".join(
                p
                for p in [me.get("first_name"), me.get("last_name")]
                if p
            )
            or None
        )
    except Exception:
        logger.exception("hh /me after oauth failed; storing token without label")

    return await save_token(
        db,
        user_id=user.id,
        payload=payload,
        account_label=label,
        connected_by_id=user.id,
    )


async def disconnect(db: AsyncSession, *, user: User) -> None:
    """Отвязать ТОЛЬКО свой hh-аккаунт. Чужие токены не трогаем."""
    token = await get_token(db, user.id)
    if token is None:
        return
    await db.delete(token)
    await db.commit()


# ───────────────────────── Resume import ─────────────────────────

async def import_resume(
    db: AsyncSession,
    *,
    user: User,
    raw_url_or_id: str,
    vacancy_id: uuid.UUID | None,
    recruiter_id: uuid.UUID | None,
) -> tuple[Candidate, list[uuid.UUID]]:
    """Импорт резюме под ТОКЕНОМ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ.

    Если пришли через Chrome-расширение (auth = `lg_…`-токен), `user` — это
    владелец `lg_…`-токена, и его же hh-аккаунт используется для просмотра.
    Так просмотры списываются с правильной квоты hh.
    """
    token = await get_token(db, user.id)
    if token is None:
        raise ApiError(
            status.HTTP_412_PRECONDITION_FAILED,
            "hh_not_connected",
            "Ваш hh-аккаунт не подключён. Откройте Настройки → Интеграции и "
            "подключите свой hh.",
        )

    try:
        resume_id = hh_client.parse_resume_id(raw_url_or_id)
    except ValueError as exc:
        raise ApiError(
            status.HTTP_400_BAD_REQUEST,
            "hh_invalid_url",
            "Не удалось распознать ссылку или ID резюме hh.",
        ) from exc

    access = await _ensure_fresh_access(db, token)

    try:
        payload = await hh_client.fetch_resume(access, resume_id)
    except HhNotFoundError as exc:
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "hh_resume_not_found",
            "Резюме не найдено или недоступно вашему аккаунту hh.",
        ) from exc
    except HhAuthError as exc:
        raise ApiError(
            status.HTTP_401_UNAUTHORIZED,
            "hh_reauth_required",
            "Сессия hh истекла. Подключите аккаунт заново.",
        ) from exc
    except HhRateLimitError as exc:
        raise ApiError(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "hh_rate_limited",
            "Достигнут дневной лимит просмотров резюме на вашем hh-аккаунте. "
            "Попробуйте завтра или увеличьте тариф.",
        ) from exc
    except HhUnavailableError as exc:
        raise ApiError(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "hh_unavailable",
            "hh.ru временно недоступен.",
        ) from exc

    create_req: CreateCandidateRequest = map_hh_resume_to_candidate(payload)
    # Если рекрутер явно не передан — назначаем ответственным владельца токена,
    # т.е. того, кто фактически сохранил резюме. Это основной кейс Chrome-
    # расширения hh.ru: оно шлёт только {url}, без recruiter_id, поэтому раньше
    # кандидат создавался без ответственного. Рекрутером может быть только
    # recruiter/admin (см. _ensure_valid_recruiter_id), иначе оставляем пустым.
    effective_recruiter_id = recruiter_id
    if effective_recruiter_id is None and user.role in (Role.recruiter, Role.admin):
        effective_recruiter_id = user.id
    if effective_recruiter_id is not None:
        create_req = create_req.model_copy(
            update={"recruiter_id": effective_recruiter_id}
        )
    create_req = create_req.model_copy(update={"status": CandidateStatus.new})

    try:
        cand, _ = await candidates_service.create_candidate(db, user, create_req)
    except ApiError as exc:
        if exc.code == "duplicate_candidate":
            raise
        raise

    if vacancy_id is not None:
        await _attach_to_vacancy(db, cand.id, vacancy_id, user)

    vids: list[uuid.UUID] = [vacancy_id] if vacancy_id is not None else []
    return cand, vids


async def _attach_to_vacancy(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    vacancy_id: uuid.UUID,
    user: User,
) -> None:
    """Минимальный аттач — создаём запись vacancy_candidates, если её нет."""
    exists = (
        await db.execute(
            select(VacancyCandidate).where(
                VacancyCandidate.vacancy_id == vacancy_id,
                VacancyCandidate.candidate_id == candidate_id,
            )
        )
    ).scalar_one_or_none()
    if exists is not None:
        return
    vc = VacancyCandidate(
        vacancy_id=vacancy_id,
        candidate_id=candidate_id,
        added_by_id=user.id,
    )
    db.add(vc)
    await db.commit()


# ───────────────────────── Status DTO (per-user) ─────────────────────────

async def status_dto(db: AsyncSession, user: User) -> dict[str, Any]:
    """Статус подключения именно ТЕКУЩЕГО пользователя."""
    settings = get_settings()
    token = await get_token(db, user.id)
    configured = bool(settings.hh_client_id and settings.hh_client_secret)
    if token is None:
        return {
            "configured": configured,
            "connected": False,
            "accountLabel": None,
            "expiresAt": None,
        }
    return {
        "configured": configured,
        "connected": True,
        "accountLabel": token.account_label,
        "expiresAt": token.expires_at.isoformat() if token.expires_at else None,
    }
