"""Засеять БД синтетическими данными для perf-замеров.

Создаёт:
  * 5 пользователей-рекрутеров и 2 AM (рядом с уже существующим admin);
  * 10 клиентов;
  * N_VACANCIES вакансий (по-умолчанию 50), распределённых по статусам;
  * N_CANDIDATES кандидатов (по-умолчанию 1000), большинство активные;
  * N_MATCHES связок кандидат↔вакансия (по-умолчанию 500).

Идемпотентно: если в БД уже есть >= N_CANDIDATES кандидатов с email
`perf_*@bench.local` — ничего не делает.

Запуск:
  PYTHONPATH=. python -m scripts.perf_seed
Переменные окружения для подкрутки масштаба:
  PERF_CANDIDATES=2000 PERF_VACANCIES=80 PERF_MATCHES=1000 \\
      PYTHONPATH=. python -m scripts.perf_seed
"""
from __future__ import annotations

import asyncio
import os
import random
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.modules.candidates.models import Candidate, CandidateStatus, EmploymentType
from app.modules.clients.models import Client, ClientKind, ClientStatus
from app.modules.matching.models import MatchStatus, VacancyCandidate
from app.modules.users.models import Role, User, compute_initials
from app.modules.vacancies.models import (
    EngagementType,
    Grade,
    Priority,
    Vacancy,
    VacancyRecruiter,
    VacancyStatus,
    WorkFormat,
)

N_CANDIDATES = int(os.environ.get("PERF_CANDIDATES", "1000"))
N_VACANCIES = int(os.environ.get("PERF_VACANCIES", "50"))
N_MATCHES = int(os.environ.get("PERF_MATCHES", "500"))

PERF_EMAIL_PREFIX = "perf_"
PERF_PASSWORD = hash_password("perf-bench-123!")

STACKS = [
    ["Python", "FastAPI", "PostgreSQL"],
    ["Go", "gRPC", "Kafka"],
    ["TypeScript", "React", "Node"],
    ["Java", "Spring", "Kotlin"],
    ["C#", ".NET", "Azure"],
    ["Python", "Django", "Celery"],
    ["Ruby", "Rails", "Sidekiq"],
    ["Scala", "Akka", "Spark"],
]
ROLES = [
    "Backend Engineer",
    "Frontend Engineer",
    "Fullstack",
    "DevOps",
    "Data Engineer",
    "QA Auto",
]
LOCATIONS = ["Москва", "СПб", "Минск", "Тбилиси", "Ереван", "Удалённо"]
GRADES = list(Grade)
ENGAGEMENT = [EngagementType.outstaff, EngagementType.agency]
EMPLOY = list(EmploymentType)
STATUSES = list(CandidateStatus)
VAC_STATUSES = [s for s in VacancyStatus if s not in {VacancyStatus.closed_success, VacancyStatus.closed}]
PRIORITY = list(Priority)


async def main() -> None:
    rng = random.Random(42)  # детерминированный сид — повторяемые замеры
    async with SessionLocal() as db:
        existing = (
            await db.execute(
                select(Candidate).where(Candidate.email.like(f"{PERF_EMAIL_PREFIX}%"))
            )
        ).scalars().all()
        if len(existing) >= N_CANDIDATES:
            print(f"[perf-seed] already seeded: {len(existing)} candidates. nothing to do.")
            return

        # ── Users ─────────────────────────────────────────────
        recruiters: list[User] = []
        for i in range(5):
            u = User(
                email=f"{PERF_EMAIL_PREFIX}rec{i}@bench.local",
                password_hash=PERF_PASSWORD,
                full_name=f"Рекрутер {i + 1}",
                initials=compute_initials(f"Рекрутер {i + 1}"),
                role=Role.recruiter,
                is_active=True,
                color="#475569",
            )
            db.add(u)
            recruiters.append(u)
        ams: list[User] = []
        for i in range(2):
            u = User(
                email=f"{PERF_EMAIL_PREFIX}am{i}@bench.local",
                password_hash=PERF_PASSWORD,
                full_name=f"AM {i + 1}",
                initials=compute_initials(f"AM {i + 1}"),
                role=Role.account_manager,
                is_active=True,
                color="#0f766e",
            )
            db.add(u)
            ams.append(u)
        await db.flush()

        # ── Clients ───────────────────────────────────────────
        clients: list[Client] = []
        for i in range(10):
            c = Client(
                name=f"Perf Client {i + 1}",
                client_kind=ClientKind.direct if i % 2 == 0 else ClientKind.intermediary,
                status=ClientStatus.active,
                account_manager_id=rng.choice(ams).id,
            )
            db.add(c)
            clients.append(c)
        await db.flush()

        # ── Vacancies ─────────────────────────────────────────
        vacancies: list[Vacancy] = []
        for i in range(N_VACANCIES):
            status = rng.choice(VAC_STATUSES)
            engagement = rng.choice(ENGAGEMENT)
            v = Vacancy(
                title=f"{rng.choice(ROLES)} #{i + 1}",
                client_id=rng.choice(clients).id,
                engagement_type=engagement,
                grade=rng.choice(GRADES),
                stack=list(rng.choice(STACKS)),
                rate_client=rng.choice([2500, 3000, 3500, 4000, 4500]),
                positions=rng.choice([1, 1, 2, 3]),
                status=status,
                priority=rng.choice(PRIORITY),
                account_manager_id=rng.choice(ams).id,
                deadline=(datetime.now(timezone.utc) + timedelta(days=rng.randint(7, 90))).date(),
                kanban_order=i,
                description="Описание perf-вакансии для нагрузочных замеров.",
                requirements="Стек, опыт, грейд — см. поля.",
            )
            # рандомно 1-3 рекрутера на вакансию
            for r in rng.sample(recruiters, rng.randint(1, 3)):
                v.recruiters.append(VacancyRecruiter(user_id=r.id))
            db.add(v)
            vacancies.append(v)
        await db.flush()

        # ── Candidates ────────────────────────────────────────
        for i in range(N_CANDIDATES):
            status = rng.choice(STATUSES)
            cand = Candidate(
                full_name=f"Кандидат Тестовый {i + 1:05d}",
                role=rng.choice(ROLES),
                engagement_type=rng.choice(ENGAGEMENT),
                grade=rng.choice(GRADES),
                experience_years=rng.uniform(0.5, 15),
                stack=list(rng.choice(STACKS)),
                rate_month=rng.choice([180_000, 220_000, 260_000, 320_000, 400_000]),
                employment_type=rng.choice(EMPLOY),
                format_=rng.choice(list(WorkFormat)),
                location=rng.choice(LOCATIONS),
                recruiter_id=rng.choice(recruiters).id,
                status=status,
                status_changed_at=datetime.now(timezone.utc)
                - timedelta(days=rng.randint(0, 90)),
                phone=f"+7900{rng.randint(1000000, 9999999)}",
                email=f"{PERF_EMAIL_PREFIX}{i:05d}@bench.local",
                kanban_order=i,
                summary=f"Опытный {rng.choice(ROLES)}, стек: {','.join(rng.choice(STACKS))}",
                resume={},
                archived=rng.random() < 0.1,  # 10% в архиве
            )
            db.add(cand)
            # flush партиями, чтобы не разрастать identity map
            if i % 200 == 199:
                await db.flush()
        await db.flush()

        # ── Matches ───────────────────────────────────────────
        candidate_rows = (
            await db.execute(
                select(Candidate).where(Candidate.email.like(f"{PERF_EMAIL_PREFIX}%"))
            )
        ).scalars().all()
        actor = rng.choice(recruiters)
        added = 0
        seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
        while added < N_MATCHES and len(seen) < N_MATCHES:
            v = rng.choice(vacancies)
            c = rng.choice(candidate_rows)
            if c.engagement_type != v.engagement_type:
                continue  # бизнес-правило matching сервиса
            key = (v.id, c.id)
            if key in seen:
                continue
            seen.add(key)
            db.add(
                VacancyCandidate(
                    vacancy_id=v.id,
                    candidate_id=c.id,
                    status=MatchStatus.submitted,
                    added_by_id=actor.id,
                )
            )
            added += 1
            if added % 100 == 0:
                await db.flush()

        await db.commit()
        print(
            f"[perf-seed] done: +{len(recruiters)} recruiters, +{len(ams)} AMs, "
            f"+{len(clients)} clients, +{len(vacancies)} vacancies, "
            f"+{N_CANDIDATES} candidates, +{added} matches"
        )


if __name__ == "__main__":
    asyncio.run(main())
