"""files: entity_type 'document' для файлов базы знаний

Revision ID: 0033_file_entity_document
Revises: 0032_tender_activity_comments
Create Date: 2026-06-05

Документы базы знаний (модуль documents) до сих пор не использовали
files-pipeline: при загрузке создавался только контейнер-документ, а сам
файл нигде не сохранялся (жил blob'ом в памяти браузера). Чтобы файл
реально уходил в S3 через тот же presign+confirm, что и резюме/вложения
чата, добавляем значение `document` в enum `file_entity_type`.
`entity_id` будет ссылаться на documents.id.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0033_file_entity_document"
down_revision: str | Sequence[str] | None = "0032_tender_activity_comments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ALTER TYPE ... ADD VALUE нельзя выполнять внутри транзакции — нужен
    # autocommit-блок (как в 0015 для chat_message).
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE file_entity_type ADD VALUE IF NOT EXISTS 'document'"
        )


def downgrade() -> None:
    # Удаление значения из ENUM в Postgres официально не поддерживается —
    # 'document' остаётся в file_entity_type. Не критично.
    pass
