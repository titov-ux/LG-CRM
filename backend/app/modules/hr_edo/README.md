# Модуль `hr_edo` — кадровый электронный документооборот

Архитектура и правовые решения — `docs/plan-hr-edo.md`, порядок работ —
`docs/plan-hr-edo-roadmap.md`. Здесь — карта кода Этапа 1.

## Файлы

| файл | что внутри |
|---|---|
| `doc_types.py` | юридическая матрица типов документов (в коде, не в БД) + поля шаблонов |
| `models.py` | таблицы `hr_*`, триггер неизменяемости протокола для `create_all` |
| `evidence.py` | протокол с хеш-цепочкой: `record_event`, `verify_chain`, `verify_rows` |
| `otp.py` | SMS-коды: HMAC, TTL 5 мин, 5 попыток, cooldown 60 с, лимиты в Redis |
| `rendering.py` | Jinja2-шаблоны → HTML → PDF (Playwright), лист подписания, склейка PDF |
| `templates/` | HTML-«рыбы» документов (`ЧЕРНОВИК — ТЕКСТ НА СОГЛАСОВАНИИ У ЮРИСТА`) |
| `storage.py` | S3 (`hr-edo/…`), SHA-256 и Стрибог-256, чтение с проверкой хеша |
| `service.py` | реестр сотрудников, приглашение, согласие, документы, подпись директора |
| `keys.py` | выпуск ключа УНЭП ЛГ по SMS |
| `signing.py` | подписание сотрудником: челлендж → activation_token → crypto-service |
| `portal.py` | ссылки на портал и cookie-сессии |
| `notify.py` | письма сотруднику и уведомления в CRM |
| `dto.py` | сборка DTO без N+1 |
| `tasks.py` | Celery: напоминания, сроки, статусы SMS, сверка протокола |

Эндпоинты: `api/v1/endpoints/hr_edo.py` (`/hr-edo/*`, в openapi) и
`api/v1/endpoints/hr_sign_public.py` (`/sign/*`, публичный портал, вне openapi).
Интеграции: `integrations/sms.py`, `integrations/crypto_service.py`.

## Права

| action | по умолчанию |
|---|---|
| `hr_edo:manage` | администратор, **бухгалтер** |
| `hr_edo:sign_employer` | администратор (директор) |
| `hr_edo:export` | администратор, бухгалтер |
| `hr_edo:view_own` | все роли |

## Dev-режим

Без настроек модуль работает целиком:

* `SMS_PROVIDER=log` — SMS не уходит, код виден кадровику в
  `GET /hr-edo/dev/sms-outbox` (и во фронте — кнопка «SMS (dev)»); в лог
  пишется маска без кода;
* `CRYPTO_SERVICE_URL` пуст — `NoopCryptoService`, «тестовая подпись»: помечена
  в подписи, листе подписания и протоколе, юридической силы не имеет;
* письма без SMTP — превью в лог, ссылка на портал возвращается в ответе API.

На staging/prod модуль включается `HR_EDO_ENABLED=true`, и тогда старт
приложения требует боевых SMS, crypto-service и собственных секретов.

## Что осталось по Этапу 1

* **1.0 / 1.5 — crypto-service на КриптоПро JCP.** Нужна пробная лицензия JCP.
  Контракт сервиса зафиксирован в `integrations/crypto_service.py`, no-op
  реализация проверяет activation_token так же, как должен боевой сервис.
* Выбор SMS-провайдера: реализован SMSC (`SMS_PROVIDER=smsc`); SMS Aero / МТС
  Exolve — ещё одна реализация `SmsProvider`.
* Тексты шаблонов — у юриста.
