# Чат

Внутренний чат сотрудников: DM и группы, треды, реакции, вложения,
полнотекстовый поиск, mute/archive. Реализован по плану `План_внедрения_чата.docx`
в шесть этапов; миграции `0012`–`0017`.

## Архитектура коротко

```
chat_conversations (id, kind dm|group, title, sorted_pair_hash, last_message_at, created_by)
   └─< chat_members (PK conv+user, role, joined_at,
                     last_read_*, muted_until, hidden_at)
   └─< chat_messages (id, conversation_id, author_user_id,
                      parent_message_id, text, edited_at, deleted_at,
                      tsv (GIN), created_at)
        └─< chat_message_reactions (PK msg+user+emoji)
        └─< files (entity_type='chat_message', entity_id=msg.id)
```

Realtime поверх `app.realtime`: `publish_chat_event(audience=[user_ids])`
кладёт событие в `EventBus`; `endpoints/realtime.py::_pump_events` фильтрует
по `audience` — приватные сообщения видят только участники диалога.

## Ключевые решения (закреплены в [[crm-lg-chat-stage1]])

| Вопрос | Решение |
|---|---|
| FK `chat_members.user_id` | `CASCADE` — мембершип уходит с юзером (отличается от общего SET NULL) |
| FK `chat_messages.author_user_id` | `SET NULL` — сообщения «бывшего сотрудника» остаются |
| Лимит участников группы | soft 50 (Pydantic max_length) |
| Удалили из группы | Telegram-like — диалог пропадает у удалённого |
| Эмодзи-реакции | Переиспользуем `features/documents/EmojiPicker.tsx` |
| Глубина тредов | 1 уровень (Slack-like) |
| Полнотекстовый поиск | `to_tsvector('russian', text)` без pg_trgm |

## События realtime

Все чат-события — приватные (имеют `audience: list[user_id]`):

| `type` | Payload |
|---|---|
| `chat.message_created` | `conversationId, messageId, parentMessageId?, authorId, preview, mentions[], notifiedUserIds[], createdAt` |
| `chat.message_updated` | `conversationId, messageId, mentions[], notifiedUserIds[], editedAt` |
| `chat.message_deleted` | `conversationId, messageId, deletedAt` |
| `chat.reaction_changed` | `conversationId, messageId, emoji, userId, action: 'add'\|'remove'` |
| `chat.read` | `conversationId, userId, lastReadMessageId, lastReadAt` |
| `chat.conversation_changed` | `conversationId, kind: 'created'\|'renamed'\|'member_added'\|'member_removed', userId?/userIds?/title?` |

## Права

`permissions_matrix` пока не используется на чтение — все активные юзеры
могут писать в чат. Зарезервированные флаги: `chat:use`, `chat:create_group`,
`chat:moderate`. Удаление чужих сообщений (`chat:moderate`) на Этапе 2–6
доступно только `Role.admin`.

## Файлы-вложения

Используется существующая таблица `files` с `entity_type='chat_message'`.
Поток:

1. Фронт льёт файл через `files/uploadFile` с временным `entity_id` (random UUID).
2. POST `/chat/.../messages` с `fileIds[]` — сервис проверяет владение и
   перепривязывает `entity_id = msg.id`.
3. GET `/files/{id}/download` для вложений чата проверяет членство в
   conversation (см. `files/service.ensure_can_read_file`); не-член
   получает `404` (не палим существование).
4. ClamAV-скан — общий с остальными файлами, ничего трогать не надо.

## mute / archive (Этап 6)

* `muted_until` — глушит только Notification (для @-mentions). Realtime
  доставка сообщений работает: юзер видит в чате, но nav-badge не
  «зажигается».
* `hidden_at` — персональный архив. Скрывает диалог из
  `GET /chat/conversations` (вернуть — `?includeArchived=true`). Новое
  сообщение в основную ленту автоматически сбрасывает `hidden_at` у всех
  получателей (Slack-конвенция).

## Метрики

`GET /analytics/chat` → messagesToday, messages7d, activeUsers7d, dmCount,
groupCount, avgGroupSize. Считается на лету без агрегирующей таблицы.

## Тесты

`backend/tests/test_chat_e2e.py` — privacy (audience, FTS), soft-delete,
mute блокирует Notification. Для запуска нужен живой Postgres и Redis
(или fakeredis — настроено в conftest).

## Поиск (FTS)

`chat_messages.tsv` пересчитывается триггером БД `chat_messages_tsv_trigger`
на INSERT/UPDATE OF text через `to_tsvector('russian', coalesce(text, ''))`.
GIN-индекс. Сниппеты — `ts_headline('russian', ..., 'StartSel=<mark>,...')`.
Запросы — `websearch_to_tsquery('russian', q)`, поддерживает Slack-подобный
синтаксис: `"точная фраза"`, `слово1 OR слово2`, `слово -стоп`.

## Миграции

| | Что добавлено |
|---|---|
| `0012_chat` | conversations + members + messages + sorted_pair_hash unique |
| `0013_chat_read` | `last_read_message_id` / `last_read_at`; ALTER `notification_entity_type` += `chat_message` |
| `0014_chat_groups_reactions` | `chat_message_reactions` (PK msg+user+emoji) |
| `0015_chat_threads_attachments` | `parent_message_id`; ALTER `file_entity_type` += `chat_message` |
| `0016_chat_search` | `tsv` + GIN + триггер + backfill |
| `0017_chat_mute_archive` | `muted_until` + `hidden_at` |

См. также: `docs/openapi.yaml` (12+ путей под `/chat`), `frontend/src/features/chat/*`.
