"""Тонкий клиент YandexGPT (Yandex Cloud AI Studio).

Yandex AI Studio предоставляет OpenAI-совместимый эндпоинт, поэтому формат
запроса — стандартный Chat Completions:

    POST https://ai.api.cloud.yandex.net/v1/chat/completions
    Authorization: Api-Key <YANDEX_API_KEY>
    OpenAI-Project: <YANDEX_FOLDER_ID>
    Content-Type: application/json

    {
      "model": "gpt://<folder_id>/yandexgpt/rc",
      "messages": [...],
      "response_format": {
        "type": "json_schema",
        "json_schema": { "name": "...", "schema": {...JSON schema...} }
      }
    }

Для structured output используем `response_format=json_schema` — модель ОБЯЗАНА
вернуть JSON по нашей схеме. Контент приходит строкой в `choices[0].message.content`,
её нужно `json.loads`.

Ошибки нормализованы:
* `AiUnavailableError` — нет ключа / сеть / 5xx / битый ответ.
* `AiBadRequestError` — 4xx от Yandex AI Studio.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import get_settings


class AiError(Exception):
    """Базовое исключение AI-интеграции."""


class AiUnavailableError(AiError):
    """LLM недоступен — нет ключа / сеть / 5xx / битый ответ."""


class AiBadRequestError(AiError):
    """4xx от Yandex AI Studio — обычно проблема с промптом/настройками."""


class AiTruncatedJsonError(AiError):
    """Модель оборвала JSON-ответ по достижении max_tokens.

    Содержательно это «вход/выход слишком большой для текущего лимита».
    Endpoint'у имеет смысл показать пользователю отдельный понятный текст
    («резюме слишком большое, сократите и попробуйте ещё раз»), а не общий
    `ai_unavailable`.
    """


class YandexGptClient:
    """Минимальный клиент Yandex AI Studio Chat Completions.

    Не использует openai SDK — нам нужен ровно один POST, а тащить толстую
    зависимость ради этого нет смысла.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        folder_id: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        settings = get_settings()
        self.api_key = api_key if api_key is not None else settings.yandex_api_key
        self.folder_id = folder_id if folder_id is not None else settings.yandex_folder_id
        self.base_url = (base_url or settings.yandex_ai_base_url).rstrip("/")
        self.model = model or settings.yandex_ai_model
        self.timeout = timeout_seconds or settings.yandex_ai_timeout_seconds

    @property
    def is_configured(self) -> bool:
        # folder_id обязателен — без него modelUri не построится.
        return bool(self.api_key) and bool(self.folder_id)

    async def json_completion(
        self,
        *,
        system: str,
        user: str,
        schema_name: str,
        schema: dict[str, Any],
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> dict[str, Any]:
        """Вызвать модель с structured output; вернуть распарсенный JSON.

        Yandex AI Studio гарантирует, что content будет валидным JSON по схеме.
        Мы всё равно оборачиваем парсинг в try/except — на случай нештатной
        деградации сервиса (вернул mid-stream или partial).
        """
        if not self.is_configured:
            raise AiUnavailableError(
                "Yandex AI Studio is not configured (YANDEX_API_KEY / YANDEX_FOLDER_ID)"
            )

        model_uri = f"gpt://{self.folder_id}/{self.model}"
        payload = {
            "model": model_uri,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": False,
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema},
            },
        }
        headers = {
            "Authorization": f"Api-Key {self.api_key}",
            "OpenAI-Project": self.folder_id,
            "Content-Type": "application/json",
        }
        url = f"{self.base_url}/chat/completions"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as http:
                response = await http.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise AiUnavailableError(f"network error: {exc}") from exc

        if 400 <= response.status_code < 500:
            raise AiBadRequestError(
                f"yandex {response.status_code}: {response.text[:500]}"
            )
        if response.status_code >= 500:
            raise AiUnavailableError(
                f"yandex upstream {response.status_code}: {response.text[:500]}"
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise AiUnavailableError(f"bad json from yandex: {exc}") from exc

        try:
            choice = body["choices"][0]
            content = choice["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AiUnavailableError(f"unexpected yandex response shape: {exc}") from exc

        # OpenAI-совместимый ответ кладёт сюда 'stop' / 'length' / 'tool_calls'.
        # 'length' = модель дошла до max_tokens — JSON почти наверняка оборван.
        finish_reason = choice.get("finish_reason") if isinstance(choice, dict) else None

        if not isinstance(content, str) or not content.strip():
            raise AiUnavailableError("empty content from yandex")

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            if finish_reason == "length":
                raise AiTruncatedJsonError(
                    f"yandex truncated response at max_tokens={max_tokens}: {exc}"
                ) from exc
            raise AiUnavailableError(f"bad json in yandex content: {exc}") from exc

        if not isinstance(parsed, dict):
            raise AiUnavailableError("yandex content is not a JSON object")

        return parsed
