import type { Task } from '@/api/types';
import { assignKanbanOrders } from '@/components/kanban/utils';

// Seed-данные доски задач. Используются только в мок-режиме
// (VITE_USE_MOCKS=true). Боевые данные приходят с backend.

/** ISO-дата (YYYY-MM-DD) со сдвигом от сегодня — чтобы сроки в демо были «живыми». */
function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export const tasksDb: Task[] = assignKanbanOrders([
  {
    id: 'task1',
    title: 'Подготовить КП на аутстафф Java-команды для X5',
    description: '3 senior Java + 1 QA, старт с 1 декабря. Ставки согласовать с Марией.',
    status: 'todo',
    priority: 'urgent',
    assigneeId: 'u2',
    authorId: 'u1',
    dueDate: dayOffset(1),
    daysInStatus: 1,
    completedAt: null,
    createdAt: daysAgoIso(1),
    kanbanOrder: 0,
  },
  {
    id: 'task2',
    title: 'Обновить шаблон договора аутстаффинга',
    description: 'Учесть правки юристов ВТБ по ответственности за персональные данные.',
    status: 'todo',
    priority: 'medium',
    assigneeId: 'u1',
    authorId: 'u1',
    dueDate: dayOffset(6),
    daysInStatus: 3,
    completedAt: null,
    createdAt: daysAgoIso(3),
    kanbanOrder: 0,
  },
  {
    id: 'task3',
    title: 'Собрать шорт-лист DevOps для Газпром нефти',
    description: null,
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'u4',
    authorId: 'u2',
    dueDate: dayOffset(-1),
    daysInStatus: 4,
    completedAt: null,
    createdAt: daysAgoIso(6),
    kanbanOrder: 0,
  },
  {
    id: 'task4',
    title: 'Созвон с Мосбиржей по продлению команды',
    description: 'Обсудить продление на 2027 год и индексацию ставок.',
    status: 'in_progress',
    priority: 'medium',
    assigneeId: 'u3',
    authorId: 'u1',
    dueDate: dayOffset(0),
    daysInStatus: 2,
    completedAt: null,
    createdAt: daysAgoIso(5),
    kanbanOrder: 0,
  },
  {
    id: 'task5',
    title: 'Проверить акты за октябрь перед отправкой в Сбер',
    description: null,
    status: 'review',
    priority: 'high',
    assigneeId: 'u7',
    authorId: 'u1',
    dueDate: dayOffset(3),
    daysInStatus: 1,
    completedAt: null,
    createdAt: daysAgoIso(4),
    kanbanOrder: 0,
  },
  {
    id: 'task6',
    title: 'Продлить резидентство Сколково — подать отчёт',
    description: 'Отчёт по выручке и R&D-расходам за 9 месяцев.',
    status: 'done',
    priority: 'medium',
    assigneeId: 'u1',
    authorId: 'u1',
    dueDate: dayOffset(-4),
    daysInStatus: 5,
    completedAt: daysAgoIso(5),
    createdAt: daysAgoIso(14),
    kanbanOrder: 0,
  },
]);

const TASKS_STORAGE_KEY = 'crm-lg:v1:db:tasks';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function hydrateTasksFromStorage() {
  if (!canUseStorage()) return;
  try {
    const raw = window.localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Task[];
    if (!Array.isArray(parsed)) return;
    tasksDb.splice(0, tasksDb.length, ...parsed);
  } catch {
    // ignore broken local data and keep bundled seed
  }
}

export function persistTasksDb() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasksDb));
  } catch {
    // ignore quota/storage errors
  }
}

hydrateTasksFromStorage();
