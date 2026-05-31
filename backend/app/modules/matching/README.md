# Модуль matching

Модель: `models.py` (SQLAlchemy)
Схемы: `schemas.py` (Pydantic — Request/Response DTO)
Сервис: `service.py` (бизнес-логика)
Репозиторий: `repository.py` (CRUD)

См. `docs/openapi.yaml` — контракт эндпоинтов этого модуля.

## AI-скоринг соответствия (ai.py)

Гибрид «детерминированная арифметика + LLM». Веса критериев (stack/grade/
experience/format/rate) фиксированы в `ai.WEIGHTS`; LLM выставляет score+note по
критериям и текстовый вердикт, итог считается на бэкенде. Без AI работает
`cheap_score` (фоллбэк). Кэш живёт в колонках `ai_*` связки, инвалидация по
`ai_input_hash`. План и решения — `docs/plan-ai-scoring.md`.

Эндпоинты (см. `api/v1/endpoints/matching.py`):

- `POST /matches/{matchId}/score?force=` — посчитать/пересчитать (matchId
  принимает синтетический `m-{vacancyId}-{candidateId}`).
- `GET  /matches/{matchId}/score` — сохранённая разбивка (404 `not_scored`).
- `POST /vacancies/{id}/candidates/score?force=` — батч (частичный успех).
- `POST /vacancies/{id}/candidates/score-preview` — превью без прикрепления.

Ошибки: 413 `input_too_long`, 502 `ai_bad_request`. При недоступности LLM —
graceful-фоллбэк на cheap (200, `aiEnriched=false`), а не 503.

TODO: дописать эти эндпоинты в `docs/openapi.yaml` и перегенерировать
`frontend/src/api/types.gen.ts` (сейчас фронт-типы заданы вручную в `api/types.ts`).
