"""Извлечение текста из бинарного .doc (Word 97-2003).

В отличие от PDF/DOCX/RTF/TXT, бинарный .doc — это OLE Compound Document с
проприетарной структурой WordDocument stream. Чистый Python-парсер нерабочий
без сторонних бинарных хелперов, поэтому полагаемся на системный `antiword`,
который добавлен в образ через Dockerfile.

API простой:
    extract_doc_text(data: bytes, *, filename: str | None = None) -> str

Падает с `DocExtractError`, если antiword не установлен, файл не .doc или
парсер вернул пустой результат (скан/повреждённый файл).
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class DocExtractError(RuntimeError):
    """Базовая ошибка извлечения. Содержит human-readable причину для фронта."""

    def __init__(self, message: str, *, code: str = "doc_extract_failed") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _antiword_path() -> str | None:
    """Полный путь к antiword или None, если бинарь не установлен."""
    return shutil.which("antiword")


def extract_doc_text(data: bytes, *, filename: str | None = None) -> str:
    """Превращает байты .doc в plain-текст.

    Запускаем antiword в режиме «без формирования» (`-t`), кодировка вывода —
    UTF-8 (`-m UTF-8.txt`). Антиворд читает stdin плохо (на некоторых
    реализациях), поэтому пишем во временный файл.
    """
    binary = _antiword_path()
    if binary is None:
        raise DocExtractError(
            "Парсер .doc не установлен на сервере. Сохраните резюме в .docx и попробуйте снова.",
            code="doc_extract_unavailable",
        )

    suffix = ".doc"
    if filename and filename.lower().endswith(".doc"):
        suffix = ".doc"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = Path(tmp.name)

    try:
        # `-t` — plain text без форматирования; `-w 0` — отключаем перенос
        # по ширине, чтобы абзацы шли цельными строками; `-m UTF-8.txt` —
        # выходной mapping в UTF-8.
        proc = subprocess.run(
            [binary, "-t", "-w", "0", "-m", "UTF-8.txt", str(tmp_path)],
            capture_output=True,
            timeout=30,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise DocExtractError(
            "Сервер не успел обработать .doc за 30 секунд. Попробуйте файл поменьше.",
            code="doc_extract_timeout",
        ) from exc
    except OSError as exc:
        logger.exception("antiword spawn failed: %s", exc)
        raise DocExtractError(
            "Не удалось запустить парсер .doc. Сообщите администратору.",
        ) from exc
    finally:
        tmp_path.unlink(missing_ok=True)

    if proc.returncode != 0:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        logger.warning(
            "antiword non-zero exit (%s): %s",
            proc.returncode,
            stderr[:500],
        )
        # Самые частые антивордовые ошибки — «not a Word document» и
        # «password protected». Не пытаемся их распарсить, отдаём общим
        # текстом, фронт покажет тост.
        raise DocExtractError(
            "Не удалось распознать файл .doc. Возможно, документ повреждён или защищён паролем.",
        )

    text = proc.stdout.decode("utf-8", errors="replace").strip()
    if not text:
        raise DocExtractError(
            "Файл .doc не содержит текстового слоя.",
            code="doc_extract_empty",
        )
    return text
