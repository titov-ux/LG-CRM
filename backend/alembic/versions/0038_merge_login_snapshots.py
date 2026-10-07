"""merge: вернуть ветку 0036_login_snapshots в общую историю

Revision ID: 0038_merge_login_snapshots
Revises: 0037_leads, 0036_login_snapshots
Create Date: 2026-10-07

Миграция `0036_login_snapshots` (снимки веб-камеры при входе) была
задеплоена на прод, а потом удалена из репозитория вместе с функцией
(коммит 550a1ad). Прод-база осталась на этой ревизии, и alembic падал с
«Can't locate revision». Файл миграции возвращён без изменений, а эта
merge-ревизия сводит две ветки, растущие из 0035
(login_snapshots и hr_edo → leads), в одну голову. Схему не меняет.
"""
from __future__ import annotations

from collections.abc import Sequence

revision: str = "0038_merge_login_snapshots"
down_revision: str | Sequence[str] | None = ("0037_leads", "0036_login_snapshots")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
