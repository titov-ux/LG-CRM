import type { Lead } from '@/api/types';
import { assignKanbanOrders } from '@/components/kanban/utils';

// Seed-данные канбана лидов (будущие клиенты). Используются только в мок-режиме
// (VITE_USE_MOCKS=true). Боевые данные приходят с backend.
export const leadsDb: Lead[] = assignKanbanOrders([
  {
    id: 'l1',
    title: 'Подбор 5 Java-разработчиков в команду процессинга',
    company: 'ООО «ФинТех Решения»',
    industry: 'Финтех',
    website: 'fintech-solutions.ru',
    contactName: 'Ирина Васнецова',
    contactPosition: 'HR-директор',
    phone: '+7 916 123-45-67',
    email: 'i.vasnetsova@fintech-solutions.ru',
    telegram: '@irina_vas',
    source: 'Рекомендация',
    expectedValue: 1_250_000,
    nextContactDate: '2026-10-08',
    status: 'new',
    priority: 'high',
    accountManagerId: 'u2',
    clientId: null,
    daysInStatus: 1,
    kanbanOrder: 0,
    note: 'Пришли по рекомендации от «Ромашки». Сроки сжатые — нужны люди к ноябрю.',
  },
  {
    id: 'l2',
    title: 'Массовый подбор операторов склада',
    company: 'ООО «ЛогистПро»',
    industry: 'Логистика',
    website: null,
    contactName: 'Сергей Ким',
    contactPosition: 'Директор по персоналу',
    phone: '+7 903 555-12-34',
    email: null,
    telegram: null,
    source: 'Холодный звонок',
    expectedValue: 600_000,
    nextContactDate: '2026-10-05',
    status: 'contacted',
    priority: 'medium',
    accountManagerId: 'u3',
    clientId: null,
    daysInStatus: 3,
    kanbanOrder: 0,
    note: null,
  },
  {
    id: 'l3',
    title: 'Аутстафф QA-инженеров на 6 месяцев',
    company: 'АО «Цифровые сервисы»',
    industry: 'IT',
    website: 'digital-services.ru',
    contactName: 'Ольга Миронова',
    contactPosition: 'Руководитель QA',
    phone: '+7 925 777-88-99',
    email: 'o.mironova@digital-services.ru',
    telegram: '@olga_qa',
    source: 'Сайт',
    expectedValue: 2_400_000,
    nextContactDate: '2026-10-10',
    status: 'qualified',
    priority: 'urgent',
    accountManagerId: 'u2',
    clientId: null,
    daysInStatus: 5,
    kanbanOrder: 0,
    note: 'Бюджет согласован, ЛПР — CTO. Ждут КП до конца недели.',
  },
  {
    id: 'l4',
    title: 'Подбор главного инженера проекта',
    company: 'ГК «СтройМонтаж»',
    industry: 'Строительство',
    website: 'stroymontazh.ru',
    contactName: 'Андрей Белов',
    contactPosition: 'Генеральный директор',
    phone: '+7 495 100-20-30',
    email: 'belov@stroymontazh.ru',
    telegram: null,
    source: 'Мероприятие',
    expectedValue: 450_000,
    nextContactDate: '2026-10-14',
    status: 'proposal',
    priority: 'medium',
    accountManagerId: 'u3',
    clientId: null,
    daysInStatus: 2,
    kanbanOrder: 0,
    note: null,
  },
  {
    id: 'l5',
    title: 'Комплексный найм отдела продаж (12 позиций)',
    company: 'ООО «РитейлМаркет»',
    industry: 'Ритейл',
    website: 'retailmarket.ru',
    contactName: 'Наталья Громова',
    contactPosition: 'HRBP',
    phone: '+7 911 222-33-44',
    email: 'gromova@retailmarket.ru',
    telegram: '@n_gromova',
    source: 'LinkedIn',
    expectedValue: 3_100_000,
    nextContactDate: '2026-10-09',
    status: 'negotiation',
    priority: 'high',
    accountManagerId: 'u2',
    clientId: null,
    daysInStatus: 6,
    kanbanOrder: 0,
    note: 'Торгуются по ставке — просят 15% вместо 18%.',
  },
  {
    id: 'l6',
    title: 'Подбор финансового директора',
    company: 'ООО «АгроХолдинг Юг»',
    industry: 'Агро',
    website: null,
    contactName: 'Виктор Лебедев',
    contactPosition: 'Собственник',
    phone: '+7 918 444-55-66',
    email: 'lebedev@agro-yug.ru',
    telegram: null,
    source: 'Партнёр',
    expectedValue: 900_000,
    nextContactDate: null,
    status: 'lost',
    priority: 'low',
    accountManagerId: 'u3',
    clientId: null,
    daysInStatus: 12,
    kanbanOrder: 0,
    note: '[2026-09-25] lost: Решили закрыть позицию внутренним кандидатом.',
  },
]);

const LEADS_STORAGE_KEY = 'crm-lg:v1:db:leads';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function hydrateLeadsFromStorage() {
  if (!canUseStorage()) return;
  try {
    const raw = window.localStorage.getItem(LEADS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Lead[];
    if (!Array.isArray(parsed)) return;
    leadsDb.splice(0, leadsDb.length, ...parsed);
  } catch {
    // ignore broken local data and keep bundled seed
  }
}

export function persistLeadsDb() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(LEADS_STORAGE_KEY, JSON.stringify(leadsDb));
  } catch {
    // ignore quota/storage errors
  }
}

hydrateLeadsFromStorage();
