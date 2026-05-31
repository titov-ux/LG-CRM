"""Сервис matching."""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.candidates.models import Candidate
from app.modules.matching import ai as matching_ai
from app.modules.matching import metrics as scoring_metrics
from app.modules.matching.models import (
    MatchRecommendation,
    MatchStatus,
    VacancyCandidate,
)
from app.modules.matching.schemas import UpdateMatchRequest
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind
from app.modules.users.models import User
from app.modules.vacancies.models import Vacancy, VacancyRecruiter
from app.realtime import publish_match_scored


async def list_for_vacancy(
    db: AsyncSession, vacancy_id: uuid.UUID
) -> list[VacancyCandidate]:
    res = await db.execute(
        select(VacancyCandidate)
        .where(VacancyCandidate.vacancy_id == vacancy_id)
        .order_by(VacancyCandidate.added_at.desc())
    )
    return list(res.scalars().all())


async def attach(
    db: AsyncSession, user: User, vacancy_id: uuid.UUID, candidate_id: uuid.UUID
) -> VacancyCandidate:
    vac = await db.get(Vacancy, vacancy_id)
    cand = await db.get(Candidate, candidate_id)
    if vac is None or cand is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Вакансия или кандидат не найдены")
    if vac.engagement_type != cand.engagement_type:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "engagement_type_mismatch",
            "Тип кандидата не совпадает с типом вакансии: их нельзя связать друг с другом.",
            details={
                "vacancyEngagement": vac.engagement_type.value,
                "candidateEngagement": cand.engagement_type.value,
            },
        )

    # Идемпотентность — если уже есть, возвращаем существующую связь.
    existing = (
        await db.execute(
            select(VacancyCandidate).where(
                VacancyCandidate.vacancy_id == vacancy_id,
                VacancyCandidate.candidate_id == candidate_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    match = VacancyCandidate(
        vacancy_id=vacancy_id,
        candidate_id=candidate_id,
        status=MatchStatus.submitted,
        added_by_id=user.id,
    )
    db.add(match)
    try:
        await db.flush()
    except IntegrityError:
        # Гонка: создалось другим запросом — перечитаем и вернём.
        await db.rollback()
        return (
            await db.execute(
                select(VacancyCandidate).where(
                    VacancyCandidate.vacancy_id == vacancy_id,
                    VacancyCandidate.candidate_id == candidate_id,
                )
            )
        ).scalar_one()

    # Уведомление: рекрутеры вакансии и её AM (кроме самого actor'а).
    recipients_q = await db.execute(
        select(VacancyRecruiter.user_id).where(VacancyRecruiter.vacancy_id == vacancy_id)
    )
    recipients = {r for r in recipients_q.scalars().all()}
    recipients.add(vac.account_manager_id)
    recipients.discard(user.id)
    if recipients:
        await notify_service.notify_many(
            db,
            recipient_ids=recipients,
            kind=NotificationKind.status_change,
            text=f"Кандидат прикреплён к вакансии «{vac.title}»",
            entity_type=NotificationEntityType.vacancy,
            entity_id=vacancy_id,
            payload={"candidateId": str(candidate_id)},
        )

    await db.commit()
    await db.refresh(match)
    return match


async def update_match(
    db: AsyncSession, match_id: uuid.UUID, payload: UpdateMatchRequest
) -> VacancyCandidate:
    match = await db.get(VacancyCandidate, match_id)
    if match is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Связка не найдена")
    if payload.status is not None:
        match.status = payload.status
    if payload.feedback is not None:
        match.feedback = payload.feedback
    await db.commit()
    await db.refresh(match)
    return match


async def detach(db: AsyncSession, match_id: uuid.UUID) -> None:
    match = await db.get(VacancyCandidate, match_id)
    if match is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "not_found", "Связка не найдена")
    await db.delete(match)
    await db.commit()


# === AI-скоринг ==============================================================
def _result_from_match(match: VacancyCandidate) -> dict[str, Any]:
    """Собрать результат скоринга из сохранённых в связке полей (кэш-хит)."""
    return {
        "score": match.ai_score or 0,
        "recommendation": (
            match.ai_recommendation.value
            if match.ai_recommendation
            else matching_ai.recommendation_from_score(match.ai_score or 0)
        ),
        "breakdown": match.ai_breakdown or {},
        "summary": match.ai_summary,
        "strengths": match.ai_strengths or [],
        "gaps": match.ai_gaps or [],
        "model": match.ai_model or "cheap",
        "scored_at": match.ai_scored_at,
        "input_hash": match.ai_input_hash,
    }


def _write_score(
    match: VacancyCandidate, result: dict[str, Any], *, ai_enriched: bool
) -> None:
    """Записать результат скоринга в колонки связки.

    `ai_input_hash` сохраняем ТОЛЬКО для полноценной LLM-оценки. Для cheap-
    фоллбэка оставляем NULL — тогда следующий POST не попадёт в кэш и повторит
    попытку LLM (как только AI снова доступен).
    """
    match.ai_score = result["score"]
    match.ai_recommendation = MatchRecommendation(result["recommendation"])
    match.ai_breakdown = result["breakdown"]
    match.ai_summary = result["summary"]
    match.ai_strengths = result["strengths"]
    match.ai_gaps = result["gaps"]
    match.ai_model = result["model"]
    match.ai_scored_at = datetime.now(timezone.utc)
    match.ai_input_hash = result["input_hash"] if ai_enriched else None


async def score_and_store(
    db: AsyncSession,
    match: VacancyCandidate,
    cand_payload: dict[str, Any],
    vac_payload: dict[str, Any],
    *,
    actor: User,
    force: bool = False,
) -> tuple[dict[str, Any], bool, bool]:
    """Посчитать (или взять из кэша) скоринг связки и сохранить.

    Возвращает `(result, from_cache, ai_enriched)`.
      • кэш-хит — если не force, есть прошлый скор и хэш входа совпал;
      • при недоступности LLM — graceful-фоллбэк на детерминированный cheap
        (ai_enriched=False), без 503;
      • `AiBadRequestError` / `AiTruncatedJsonError` пробрасываются в эндпоинт.
    """
    input_hash = matching_ai.compute_input_hash(cand_payload, vac_payload)

    if (
        not force
        and match.ai_score is not None
        and match.ai_input_hash == input_hash
    ):
        scoring_metrics.record_cache_hit()
        return _result_from_match(match), True, (match.ai_model or "cheap") != "cheap"

    started = time.perf_counter()
    try:
        result = await matching_ai.score_match(cand_payload, vac_payload)
        ai_enriched = True
        scoring_metrics.record_llm((time.perf_counter() - started) * 1000)
    except matching_ai.AiUnavailableError:
        result = matching_ai.cheap_result(cand_payload, vac_payload)
        ai_enriched = False
        scoring_metrics.record_cheap_fallback((time.perf_counter() - started) * 1000)
    except (matching_ai.AiBadRequestError, matching_ai.AiTruncatedJsonError):
        # 4xx/обрыв — считаем ошибкой наблюдаемости и пробрасываем в эндпоинт.
        scoring_metrics.record_error()
        raise

    _write_score(match, result, ai_enriched=ai_enriched)
    await db.commit()
    await db.refresh(match)

    publish_match_scored(
        vacancy_id=match.vacancy_id,
        candidate_id=match.candidate_id,
        match_id=match.id,
        score=result["score"],
        recommendation=result["recommendation"],
        actor_id=actor.id,
    )
    result = _result_from_match(match)
    return result, False, ai_enriched
