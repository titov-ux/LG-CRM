"""users + расширения citext/pg_trgm/uuid-ossp

Revision ID: 0001_users
Revises:
Create Date: 2026-05-22

Этап 1 плана перехода на API: walking skeleton (auth).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_users"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


USER_ROLES = ("admin", "account_manager", "recruiter", "viewer")


def upgrade() -> None:
    # Расширения. Дублируем INIT-скрипт (infra/postgres-init/01-extensions.sql)
    # на случай восстановления БД из дампа без init-скриптов.
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    user_role = postgresql.ENUM(*USER_ROLES, name="user_role", create_type=True)
    user_role.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("email", postgresql.CITEXT(), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            postgresql.ENUM(*USER_ROLES, name="user_role", create_type=False),
            nullable=False,
            server_default="recruiter",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("telegram", sa.String(length=255), nullable=True),
        sa.Column("initials", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("color", sa.String(length=16), nullable=False, server_default="#94a3b8"),
        sa.Column("totp_secret", sa.String(length=64), nullable=True),
        sa.Column("last_failed_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_users_email", "users", ["email"])


def downgrade() -> None:
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS user_role")
