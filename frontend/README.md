# crm-lg / frontend

Фронт SaaS-системы ЛГ Интеграция. Стек:

- **React 18** + **TypeScript 5** (strict)
- **Vite 5** — сборка / HMR
- **TanStack Router** — type-safe file-based routing
- **TanStack Query v5** — серверный кэш и мутации
- **shadcn/ui** + **Tailwind CSS** — UI
- **dnd-kit** — Kanban
- **Zustand** — клиентский state (auth, ui, фильтры)
- **react-hook-form** + **Zod** — формы
- **ky** — HTTP-клиент с авто-refresh
- **MSW** — mock backend для dev-режима до появления реального API
- **sonner** — toast-уведомления
- **lucide-react** — иконки

Соответствует §5 архитектуры. Папочная структура (`src/features/*`, `src/api/*`,
`src/components/{ui,layout,kanban,common}`, `src/stores`, `src/lib`, `src/routes`) воспроизводит
дерево из «Архитектура SaaS ЛГ Интеграция» один-в-один.

## Быстрый старт

```bash
cd frontend
pnpm install            # или npm install / yarn

# Один раз — устанавливаем MSW-воркер в public/.
pnpm dlx msw init public --save

# Старт dev-сервера. Первый запуск плагин TanStack Router перезапишет src/routeTree.gen.ts.
pnpm dev
```

Откройте http://localhost:5173 — фронт стартует на mock-данных (MSW).
Логин любой из тестовых: `titov@lg-integration.ru` / `demo` (пароль не проверяется).

## Скрипты

| Команда | Что делает |
| --- | --- |
| `pnpm dev` | Vite dev-сервер |
| `pnpm build` | tsc + production-сборка |
| `pnpm preview` | Локальный просмотр production-сборки |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier write |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest |

## Подключение реального бэкенда

В архитектуре фронт ходит на `/api/v1/*`. Чтобы переключиться с моков на боевой бэк:

1. В `.env`: `VITE_USE_MOCKS=false` и `VITE_API_BASE_URL=https://crm.lg.ru/api/v1` (или прокси).
2. В `vite.config.ts` (опционально) добавить `server.proxy` для dev-окружения.
3. Сгенерировать DTO из `/openapi.json`. Рекомендованный инструмент —
   [`openapi-typescript`](https://github.com/drwpow/openapi-typescript) или
   [`orval`](https://github.com/anymaniax/orval). Результат складывать в `src/api/types.ts`
   (вместо текущей ручной версии). Подключения хуков менять не придётся — слой `api/*`
   уже изолирован.

## Структура

```
src/
├── api/                 — HTTP-клиент (ky) и DTO-схемы по доменам
│   ├── client.ts          ky-инстанс с auth-interceptor + auto-refresh
│   ├── auth.ts            login / logout / me / refresh
│   ├── clients.ts         CRUD клиентов
│   ├── vacancies.ts       CRUD вакансий + смена статуса
│   ├── candidates.ts      CRUD кандидатов + смена статуса
│   ├── matching.ts        связь vacancy ↔ candidate
│   ├── notifications.ts   уведомления
│   ├── audit.ts           аудит + activity
│   ├── analytics.ts       агрегаты для дашбордов
│   ├── users.ts           справочник пользователей
│   └── types.ts           зеркало DTO бэкенда (потом — codegen из OpenAPI)
│
├── components/
│   ├── ui/              — shadcn/ui (Button, Input, Sheet, Dialog, ...)
│   ├── layout/          — AppShell + Sidebar + Header
│   ├── kanban/          — KanbanBoard / Column / Card (dnd-kit, дженерик по статусам)
│   ├── common/          — UserAvatar, AvatarStack, DaysBadge, PriorityBadge,
│   │                      StackTags, EmptyState, ErrorBoundary
│   └── forms/           — переиспользуемые компоненты форм
│
├── features/            — доменные модули (по §5)
│   ├── auth/              LoginPage, AuthGuard, useAuth
│   ├── clients/           ClientsListPage, ClientCardPage, ClientForm, hooks
│   ├── vacancies/         VacanciesKanbanPage, VacancyCardPage, VacancyKanbanCard, hooks
│   ├── candidates/        CandidatesKanbanPage, CandidateCardPage, CandidateKanbanCard, hooks
│   ├── users/             useUsers — справочник пользователей (общий)
│   ├── matching/          AttachCandidateDialog, hooks
│   ├── notifications/     NotificationsPage, hooks
│   ├── analytics/         DashboardPage (главный экран), AnalyticsPage, hooks
│   ├── audit/             AuditPage, hooks
│   └── settings/          SettingsPage
│
├── stores/              — Zustand
│   ├── auth.ts            user + accessToken (в памяти)
│   ├── ui.ts              sidebar collapsed (persist)
│   └── filters.ts         search / grade / priority / client / recruiter
│
├── lib/                 — утилиты, константы, права
│   ├── utils.ts           cn(), formatMoneyRub, formatDateRu, initials
│   ├── permissions.ts     can(role, action) — клиентская проверка прав
│   └── constants.ts       APP_TITLE, API_BASE_URL, USE_MOCKS, QUERY_DEFAULTS
│
├── routes/              — TanStack Router (file-based)
│   ├── __root.tsx           провайдеры
│   ├── login.tsx            /login
│   ├── _authed.tsx          layout c AuthGuard + AppShell
│   ├── _authed.dashboard.tsx
│   ├── _authed.vacancies.tsx + _authed.vacancies.$id.tsx
│   ├── _authed.candidates.tsx + _authed.candidates.$id.tsx
│   ├── _authed.clients.tsx + _authed.clients.$id.tsx
│   ├── _authed.notifications.tsx
│   ├── _authed.analytics.tsx
│   ├── _authed.audit.tsx
│   └── _authed.settings.tsx
│
├── mocks/               — MSW (только dev)
│   ├── browser.ts         setupWorker
│   ├── handlers.ts        все хендлеры под /api/v1/*
│   └── db/                seed-данные (взяты из прототипа)
│
├── styles/globals.css   — Tailwind + CSS-переменные shadcn + кастом скроллбара
├── App.tsx              — RouterProvider + QueryClientProvider
├── main.tsx             — bootstrap: при USE_MOCKS=true сначала поднимает MSW
└── routeTree.gen.ts     — генерируется плагином TanStack Router (не редактируется)
```

## Что осталось вне скоупа этой заготовки

- Полноценный E2E (Playwright) — пока только настроен Vitest для unit.
- Тёмная тема — CSS-переменные `--background` / `--foreground` уже учитывают `darkMode: class`,
  переключатель добавить тривиально.
- i18n — пока всё на русском без обёртки.
- Storybook — на этапе 2.
- Реальный backend (см. «Подключение реального бэкенда»).
