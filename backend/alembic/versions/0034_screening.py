"""AI-screening: sessions, questions, segments, reports

Revision ID: 0034_screening
Revises: 0033_file_entity_document
Create Date: 2026-08-10
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0034_screening"
down_revision: str | Sequence[str] | None = "0033_file_entity_document"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCREENING_STATUSES = ("draft", "live", "processing", "done", "error")
SPEAKERS = ("recruiter", "candidate")
QUESTION_SOURCES = ("pregenerated", "followup", "manual")
QUESTION_STATUSES = ("pending", "asked", "answered", "skipped")
VERDICTS = ("fit", "partial_fit", "no_fit")


def upgrade() -> None:
    # Файлы записей разговора: новое значение полиморфной entity-ссылки files.
    op.execute("ALTER TYPE file_entity_type ADD VALUE IF NOT EXISTS 'screening'")

    postgresql.ENUM(*SCREENING_STATUSES, name="screening_status", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(*SPEAKERS, name="screening_speaker", create_type=True).create(
        op.get_bind(), checkfirst=True
    )
    postgresql.ENUM(
        *QUESTION_SOURCES, name="screening_question_source", create_type=True
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(
        *QUESTION_STATUSES, name="screening_question_status", create_type=True
    ).create(op.get_bind(), checkfirst=True)
    postgresql.ENUM(*VERDICTS, name="screening_verdict", create_type=True).create(
        op.get_bind(), checkfirst=True
    )

    op.create_table(
        "screening_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "candidate_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("candidates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vacancy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vacancies.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "match_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("vacancy_candidates.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "recruiter_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "status",
            postgresql.ENUM(*SCREENING_STATUSES, name="screening_status", create_type=False),
            nullable=False,
            server_default="draft",
        ),
        sa.Column("telemost_url", sa.Text(), nullable=True),
        sa.Column(
            "consent_confirmed", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_sec", sa.Integer(), nullable=True),
        sa.Column(
            "audio_file_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("files.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_screening_sessions_candidate_id", "screening_sessions", ["candidate_id"])
    op.create_index("ix_screening_sessions_vacancy_id", "screening_sessions", ["vacancy_id"])
    op.create_index("ix_screening_sessions_recruiter_id", "screening_sessions", ["recruiter_id"])
    op.create_index("ix_screening_sessions_status", "screening_sessions", ["status"])

    op.create_table(
        "screening_questions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("screening_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("goal", sa.Text(), nullable=True),
        sa.Column(
            "source",
            postgresql.ENUM(
                *QUESTION_SOURCES, name="screening_question_source", create_type=False
            ),
            nullable=False,
            server_default="manual",
        ),
        sa.Column(
            "status",
            postgresql.ENUM(
                *QUESTION_STATUSES, name="screening_question_status", create_type=False
            ),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("answer_summary", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_screening_questions_session_id", "screening_questions", ["session_id"])

    op.create_table(
        "screening_segments",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("screening_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column(
            "speaker",
            postgresql.ENUM(*SPEAKERS, name="screening_speaker", create_type=False),
            nullable=False,
        ),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("started_ms", sa.Integer(), nullable=False),
        sa.Column("ended_ms", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("session_id", "seq", name="uq_screening_segment_seq"),
    )
    op.create_index("ix_screening_segments_session_id", "screening_segments", ["session_id"])

    op.create_table(
        "screening_reports",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("screening_sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column(
            "verdict",
            postgresql.ENUM(*VERDICTS, name="screening_verdict", create_type=False),
            nullable=False,
        ),
        sa.Column("scores", postgresql.JSONB(), nullable=True),
        sa.Column("red_flags", postgresql.JSONB(), nullable=True),
        sa.Column("recommendation", sa.Text(), nullable=True),
        sa.Column("model", sa.String(length=64), nullable=True),
        sa.Column("prompt_version", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("session_id", name="uq_screening_report_session"),
    )
    op.create_index("ix_screening_reports_session_id", "screening_reports", ["session_id"])


def downgrade() -> None:
    op.drop_index("ix_screening_reports_session_id", table_name="screening_reports")
    op.drop_table("screening_reports")
    op.drop_index("ix_screening_segments_session_id", table_name="screening_segments")
    op.drop_table("screening_segments")
    op.drop_index("ix_screening_questions_session_id", table_name="screening_questions")
    op.drop_table("screening_questions")
    op.drop_index("ix_screening_sessions_status", table_name="screening_sessions")
    op.drop_index("ix_screening_sessions_recruiter_id", table_name="screening_sessions")
    op.drop_index("ix_screening_sessions_vacancy_id", table_name="screening_sessions")
    op.drop_index("ix_screening_sessions_candidate_id", table_name="screening_sessions")
    op.drop_table("screening_sessions")

    op.execute("DROP TYPE IF EXISTS screening_verdict")
    op.execute("DROP TYPE IF EXISTS screening_question_status")
    op.execute("DROP TYPE IF EXISTS screening_question_source")
    op.execute("DROP TYPE IF EXISTS screening_speaker")
    op.execute("DROP TYPE IF EXISTS screening_status")
    # Значение 'screening' из file_entity_type не удаляем — PG не умеет
    # DROP VALUE; безвредно остаётся.
