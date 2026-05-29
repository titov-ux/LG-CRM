"""integration_tokens: переход на per-user OAuth

Revision ID: 0022_integration_tokens_per_user
Revises: 0021_user_api_tokens
Create Date: 2026-05-30

Раньше: одна строка `provider='hh'` на весь CRM — все рекрутеры пользовались
одним корпоративным аккаунтом hh, просмотры резюме списывались с общей квоты.

Теперь: каждый рекрутер подключает СВОЙ hh-аккаунт. UNIQUE на (provider, user_id),
user_id NOT NULL. Импорт резюме берёт токен текущего пользователя.

Миграция данных: если в БД уже есть строка с conncted_by_id — переносим её под
этого user_id; иначе удаляем (повторно подключатся через UI).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0022_integration_tokens_per_user"
down_revision: str | Sequence[str] | None = "0021_user_api_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    # 1) Снимаем старый UNIQUE(provider).
    op.drop_constraint("integration_tokens_provider_key", "integration_tokens", type_="unique")

    # 2) Чистим осиротевшие строки без connected_by_id — их некуда переносить.
    bind.execute(sa.text("DELETE FROM integration_tokens WHERE connected_by_id IS NULL"))

    # 3) Добавляем nullable, наполняем из connected_by_id, потом NOT NULL.
    op.add_column(
        "integration_tokens",
        sa.Column("user_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True),
    )
    bind.execute(sa.text("UPDATE integration_tokens SET user_id = connected_by_id"))
    op.alter_column("integration_tokens", "user_id", nullable=False)
    op.create_foreign_key(
        "integration_tokens_user_id_fkey",
        "integration_tokens",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_integration_tokens_user_id", "integration_tokens", ["user_id"], unique=False
    )

    # 4) UNIQUE(provider, user_id) — один токен на (юзер × провайдер).
    op.create_unique_constraint(
        "uq_integration_tokens_provider_user",
        "integration_tokens",
        ["provider", "user_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_integration_tokens_provider_user", "integration_tokens", type_="unique")
    op.drop_index("ix_integration_tokens_user_id", table_name="integration_tokens")
    op.drop_constraint("integration_tokens_user_id_fkey", "integration_tokens", type_="foreignkey")
    op.drop_column("integration_tokens", "user_id")
    op.create_unique_constraint(
        "integration_tokens_provider_key", "integration_tokens", ["provider"]
    )
