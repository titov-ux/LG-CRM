"""Адаптер S3 (Yandex Object Storage через boto3).

Контракт фронт↔бэк (план §4 Этап 6):
* `POST /files/presign` → `{ url, fields, fileKey }`
  Браузер льёт файл напрямую в S3 через multipart/form-data на этот URL.
* `POST /files/confirm` → создаём запись в БД, ставим scan_status=pending.

`integrations/s3.py` не делает сетевых вызовов на этапе тестов: клиент создаётся
лениво и инициализация падает только если кто-то реально вызвал `presign_post`/
`presign_get` без сконфигурированного S3. Для unit-тестов в FastAPI используем
`app.dependency_overrides[get_s3_adapter] = ...`.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

import boto3
from botocore.client import Config

from app.core.config import get_settings

# Белый список MIME — ТЗ §5.9.
# Помимо базовых типов резюме/вложений сюда добавлены форматы базы знаний
# (документы): презентации, текст/markdown/csv, rtf и доп. изображения.
ALLOWED_MIME_TYPES: frozenset[str] = frozenset(
    {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/rtf",
        "text/plain",
        "text/markdown",
        "text/csv",
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        # Аудиозаписи AI-скрининга (MediaRecorder в браузере отдаёт
        # audio/webm или audio/mp4 в Safari; ogg/wav — на будущее).
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav",
    }
)


@dataclass
class PresignedPost:
    url: str
    fields: dict[str, str]
    file_key: str


class S3Adapter(Protocol):
    def presign_post(self, *, file_key: str, mime: str, max_bytes: int) -> PresignedPost: ...
    def presign_get(self, *, file_key: str, expires_in: int = 300) -> str: ...
    def delete(self, *, file_key: str) -> None: ...


class BotoS3Adapter:
    """Боевая реализация через boto3.

    Yandex Object Storage совместим с S3 API; задаётся через `endpoint_url`.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._bucket = settings.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key or None,
            aws_secret_access_key=settings.s3_secret_key or None,
            config=Config(signature_version="s3v4"),
        )

    def presign_post(self, *, file_key: str, mime: str, max_bytes: int) -> PresignedPost:
        # Условия policy: content-type фиксирован, размер ≤ max_bytes.
        post = self._client.generate_presigned_post(
            Bucket=self._bucket,
            Key=file_key,
            Fields={"Content-Type": mime},
            Conditions=[
                {"Content-Type": mime},
                ["content-length-range", 1, max_bytes],
            ],
            ExpiresIn=600,
        )
        return PresignedPost(url=post["url"], fields=dict(post["fields"]), file_key=file_key)

    def presign_get(self, *, file_key: str, expires_in: int = 300) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": file_key},
            ExpiresIn=expires_in,
        )

    def delete(self, *, file_key: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=file_key)


def make_file_key(*, entity_type: str, entity_id: uuid.UUID, original_name: str) -> str:
    """Стабильный путь в бакете: `{entity}/{id}/{rand-hex}-{original_name}`.

    `rand-hex` гарантирует уникальность даже при одинаковом имени файла.
    """
    rand = uuid.uuid4().hex[:12]
    safe = "".join(ch for ch in original_name if ch.isalnum() or ch in "._-") or "file"
    return f"{entity_type}/{entity_id}/{rand}-{safe}"


@lru_cache(maxsize=1)
def get_s3_adapter() -> S3Adapter:
    """DI-провайдер: один экземпляр на процесс. Переопределяется в тестах через
    `app.dependency_overrides`."""
    return BotoS3Adapter()
