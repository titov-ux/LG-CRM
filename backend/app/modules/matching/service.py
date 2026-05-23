"""Сервис matching."""
from __future__ import annotations

import uuid

from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.modules.candidates.models import Candidate
from app.modules.matching.models import MatchStatus, VacancyCandidate
from app.modules.matching.schemas import UpdateMatchRequest
from app.modules.notifications import service as notify_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind
from app.modules.users.models import User
from app.modules.vacancies.models import Vacancy, VacancyRecruiter


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
