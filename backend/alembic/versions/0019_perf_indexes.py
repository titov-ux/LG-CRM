"""perf indexes for kanban / list / search

Revision ID: 0019_perf_indexes
Revises: 0018_documents
Create Date: 2026-05-30

Зачем: канбан и список кандидатов/вакансий стали узкими местами при 500+
карточек. Добавляем индексы под фактические запросы:

* (status, kanban_order) — основной order_by канбана и список с дефолтным
  сортированием по статусу.
* GIN(stack) — фильтр «кандидаты со стеком X», использует ARRAY-contains.
* GIN(full_name gin_trgm_ops) — case-insensitive LIKE по ФИО, основной
  поиск в /candidates и /database.
* GIN(title gin_trgm_ops) — поиск по названию вакансии.
* (archived, status, kanban_order) частичный — самый частый запрос «активные
  по колонкам».
* (vacancy_id, candidate_id) уже UNIQUE, но добавляем (candidate_id) явно —
  он нужен для VacancyCandidate.candidate_id IN (...) (_vacancy_ids_map).

`CREATE INDEX IF NOT EXISTS` + `CONCURRENTLY` не используем: миграция всё
равно делает schema lock на DDL; на dev/staging это секунды.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0019_perf_indexes"
down_revision: str | Sequence[str] | None = "0018_documents"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pg_trgm — для триграммного поиска по подстроке. CITEXT уже стоит.
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # ── Kanban / list ordering ──────────────────────────────
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_candidates_status_kanban_order "
        "ON candidates (status, kanban_order) WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_candidates_active_status_order "
        "ON candidates (status, kanban_order) "
        "WHERE deleted_at IS NULL AND archived = false"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_vacancies_status_kanban_order "
        "ON vacancies (status, kanban_order) WHERE deleted_at IS NULL"
    )

    # ── Substring search ────────────────────────────────────
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_candidates_full_name_trgm "
        "ON candidates USING gin (lower(full_name) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_vacancies_title_trgm "
        "ON vacancies USING gin (lower(title) gin_trgm_ops)"
    )

    # ── Stack array filter ──────────────────────────────────
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_candidates_stack_gin "
        "ON candidates USING gin (stack)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_vacancies_stack_gin "
        "ON vacancies USING gin (stack)"
    )

    # ── Matching reverse lookup ─────────────────────────────
    # vacancy_candidates.candidate_id уже index=True в модели, но проверим имя:
    # если индекса нет — добавим. В _vacancy_ids_map для списка кандидатов
    # делается WHERE candidate_id IN (...), и индекс по candidate_id критичен.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_vacancy_candidates_candidate_id "
        "ON vacancy_candidates (candidate_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_vacancy_candidates_candidate_id")
    op.execute("DROP INDEX IF EXISTS ix_vacancies_stack_gin")
    op.execute("DROP INDEX IF EXISTS ix_candidates_stack_gin")
    op.execute("DROP INDEX IF EXISTS ix_vacancies_title_trgm")
    op.execute("DROP INDEX IF EXISTS ix_candidates_full_name_trgm")
    op.execute("DROP INDEX IF EXISTS ix_vacancies_status_kanban_order")
    op.execute("DROP INDEX IF EXISTS ix_candidates_active_status_order")
    op.execute("DROP INDEX IF EXISTS ix_candidates_status_kanban_order")
    # pg_trgm намеренно не убираем — расширение может использоваться другими.
