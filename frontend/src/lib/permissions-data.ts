// «Лист»-модуль: только типы и данные матрицы доступов, без зависимостей
// от store/React. Из него импортируют и `lib/permissions.ts` (where `can` живёт),
// и `stores/permissionsMatrix.ts` (где лежит in-memory кэш). Так разрезаем
// потенциальный циклический импорт.

import type { Role } from '@/api/types';

export type Action =
  | 'client:create'
  | 'client:edit'
  | 'vacancy:create'
  | 'vacancy:edit'
  | 'vacancy:change_status'
  | 'vacancy:assign_recruiter'
  | 'candidate:create'
  | 'candidate:edit'
  | 'candidate:change_status'
  /** Убрать кандидата с канбан-доски (в базе кандидат остаётся). */
  | 'candidate:archive'
  /** Полностью удалить кандидата из базы. По умолчанию — только админ. */
  | 'candidate:delete_permanent'
  | 'audit:view'
  | 'analytics:view'
  | 'user:manage';

/** Одна строка матрицы доступов. `id` — стабильный slug, под него завязаны мутации. */
export interface MatrixPermission {
  id: string;
  group: string;
  permission: string;
  description: string;
  /** Какие программные действия (Action) гейтит эта строка. */
  actions: Action[];
  matrix: Record<Role, boolean>;
}

/**
 * Дефолты — стартовое состояние и fallback, пока сервер не ответил.
 * Это НЕ источник правды: сервер может прислать другую матрицу.
 */
export const DEFAULT_PERMISSIONS: MatrixPermission[] = [
  {
    id: 'clients.view',
    group: 'Клиенты',
    permission: 'Просмотр карточек клиентов',
    description: 'Доступ к списку и карточкам клиентов.',
    actions: [],
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: true },
  },
  {
    id: 'clients.create_edit',
    group: 'Клиенты',
    permission: 'Создание и редактирование',
    description: 'Создавать, изменять данные клиентов и контакты.',
    actions: ['client:create', 'client:edit'],
    matrix: { admin: true, account_manager: true, recruiter: false, viewer: false },
  },
  {
    id: 'clients.delete',
    group: 'Клиенты',
    permission: 'Удаление / архив',
    description: 'Перевод клиентов в архив или удаление.',
    actions: [],
    matrix: { admin: true, account_manager: false, recruiter: false, viewer: false },
  },
  {
    id: 'vacancies.view_all',
    group: 'Вакансии',
    permission: 'Просмотр всех вакансий',
    description: 'Видеть все вакансии компании, а не только свои.',
    actions: [],
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: true },
  },
  {
    id: 'vacancies.create_edit',
    group: 'Вакансии',
    permission: 'Создание / редактирование',
    description: 'Заводить новые вакансии и менять их статусы.',
    actions: ['vacancy:create', 'vacancy:edit', 'vacancy:change_status'],
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: false },
  },
  {
    id: 'vacancies.assign_recruiter',
    group: 'Вакансии',
    permission: 'Назначение рекрутера',
    description: 'Распределять рекрутеров по вакансиям.',
    actions: ['vacancy:assign_recruiter'],
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: false },
  },
  {
    id: 'candidates.view',
    group: 'Кандидаты',
    permission: 'Просмотр базы кандидатов',
    description: 'Поиск и фильтрация кандидатов.',
    actions: [],
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: true },
  },
  {
    id: 'candidates.create_edit',
    group: 'Кандидаты',
    permission: 'Создание / редактирование',
    description: 'Добавлять и редактировать карточки кандидатов.',
    actions: ['candidate:create', 'candidate:edit', 'candidate:change_status'],
    matrix: { admin: true, account_manager: false, recruiter: true, viewer: false },
  },
  {
    id: 'candidates.present',
    group: 'Кандидаты',
    permission: 'Презентация клиенту',
    description: 'Отправлять подборку кандидатов клиенту.',
    actions: [],
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: false },
  },
  {
    id: 'candidates.archive',
    group: 'Кандидаты',
    permission: 'Убрать с канбан-доски',
    description:
      'Скрыть кандидата с канбан-доски. Кандидат остаётся в общей «Базе кандидатов».',
    actions: ['candidate:archive'],
    matrix: { admin: true, account_manager: true, recruiter: true, viewer: false },
  },
  {
    id: 'candidates.delete_permanent',
    group: 'Кандидаты',
    permission: 'Удаление из базы',
    description:
      'Полное удаление кандидата из базы без возможности восстановления. Действует поверх «убрать с доски».',
    actions: ['candidate:delete_permanent'],
    matrix: { admin: true, account_manager: false, recruiter: false, viewer: false },
  },
  {
    id: 'analytics.view',
    group: 'Аналитика',
    permission: 'Доступ к аналитике',
    description: 'Доступ к разделу «Аналитика» и выгрузкам.',
    actions: ['analytics:view'],
    matrix: { admin: true, account_manager: true, recruiter: false, viewer: true },
  },
  {
    id: 'audit.view',
    group: 'Администрирование',
    permission: 'Журнал действий',
    description: 'Просмотр аудит-логов изменений.',
    actions: ['audit:view'],
    matrix: { admin: true, account_manager: false, recruiter: false, viewer: false },
  },
  {
    id: 'users.manage',
    group: 'Администрирование',
    permission: 'Управление пользователями',
    description: 'Создание сотрудников, выдача ролей и доступов.',
    actions: ['user:manage'],
    matrix: { admin: true, account_manager: false, recruiter: false, viewer: false },
  },
];

/** Глубокая копия дефолтов — чтобы внешний код не мутировал общий объект. */
export function cloneDefaultPermissions(): MatrixPermission[] {
  return DEFAULT_PERMISSIONS.map((p) => ({
    ...p,
    actions: [...p.actions],
    matrix: { ...p.matrix },
  }));
}
