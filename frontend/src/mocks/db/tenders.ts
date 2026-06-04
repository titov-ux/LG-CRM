import type { Tender } from '@/api/types';
import { assignKanbanOrders } from '@/components/kanban/utils';

// Seed-данные канбана тендеров (госзакупки / коммерческие). Используются только
// в мок-режиме (VITE_USE_MOCKS=true). Боевые данные приходят с backend.
export const tendersDb: Tender[] = assignKanbanOrders([
  {
    id: 't1',
    title: 'Оказание услуг по подбору ИТ-специалистов для цифровой трансформации',
    customer: 'ПАО «Ростелеком»',
    registryNumber: '0173100012624000123',
    platform: 'Сбербанк-АСТ',
    law: 'fz223',
    nmck: 48_500_000,
    ourPrice: null,
    securityAmount: 2_425_000,
    submissionDeadline: '2026-06-18',
    auctionDate: '2026-06-25',
    status: 'lead',
    priority: 'high',
    accountManagerId: 'u2',
    daysInStatus: 2,
    kanbanOrder: 0,
    url: 'https://zakupki.gov.ru/',
    note: null,
  },
  {
    id: 't2',
    title: 'Аутстаффинг разработчиков для сопровождения ГИС',
    customer: 'ГБУ «Мосгортелеком»',
    registryNumber: '0373200034524000045',
    platform: 'ЕЭТП (Росэлторг)',
    law: 'fz44',
    nmck: 12_300_000,
    ourPrice: null,
    securityAmount: 615_000,
    submissionDeadline: '2026-06-10',
    auctionDate: '2026-06-17',
    status: 'evaluation',
    priority: 'urgent',
    accountManagerId: 'u3',
    daysInStatus: 4,
    kanbanOrder: 0,
    url: null,
    note: 'Жёсткие требования по опыту — нужно проверить, проходим ли по квалификации.',
  },
  {
    id: 't3',
    title: 'Подбор инженеров ПТО для строительного холдинга',
    customer: 'ООО «СтройИнвест Групп»',
    registryNumber: null,
    platform: 'B2B-Center',
    law: 'commercial',
    nmck: 3_200_000,
    ourPrice: null,
    securityAmount: null,
    submissionDeadline: '2026-06-09',
    auctionDate: null,
    status: 'evaluation',
    priority: 'medium',
    accountManagerId: 'u2',
    daysInStatus: 1,
    kanbanOrder: 1,
    url: null,
    note: null,
  },
  {
    id: 't4',
    title: 'Услуги по предоставлению персонала службы поддержки',
    customer: 'АО «Почта России»',
    registryNumber: '0173100008724000210',
    platform: 'РТС-тендер',
    law: 'fz223',
    nmck: 27_800_000,
    ourPrice: 25_100_000,
    securityAmount: 1_390_000,
    submissionDeadline: '2026-06-07',
    auctionDate: '2026-06-16',
    status: 'bid',
    priority: 'high',
    accountManagerId: 'u3',
    daysInStatus: 3,
    kanbanOrder: 0,
    url: null,
    note: 'Заявка собрана, ждём финального согласования цены у руководства.',
  },
  {
    id: 't5',
    title: 'Привлечение специалистов 1С для автоматизации учёта',
    customer: 'ГК «Росатом» (АО «Гринатом»)',
    registryNumber: '0373100087624000077',
    platform: 'ЭТП ГПБ',
    law: 'fz223',
    nmck: 18_900_000,
    ourPrice: 17_650_000,
    securityAmount: 945_000,
    submissionDeadline: '2026-05-28',
    auctionDate: '2026-06-06',
    status: 'review',
    priority: 'medium',
    accountManagerId: 'u2',
    daysInStatus: 6,
    kanbanOrder: 0,
    url: null,
    note: 'Заявка подана, идёт рассмотрение. Протокол ожидается на этой неделе.',
  },
  {
    id: 't6',
    title: 'Подбор аналитиков данных для банковского сектора',
    customer: 'ПАО «Совкомбанк»',
    registryNumber: null,
    platform: 'Fabrikant',
    law: 'commercial',
    nmck: 6_400_000,
    ourPrice: 6_100_000,
    securityAmount: null,
    submissionDeadline: '2026-05-20',
    auctionDate: '2026-05-29',
    status: 'won',
    priority: 'high',
    accountManagerId: 'u3',
    daysInStatus: 8,
    kanbanOrder: 0,
    url: null,
    note: '[2026-05-29] won: Победили по цене, контракт на 12 месяцев. Старт подбора с июня.',
  },
  {
    id: 't7',
    title: 'Аутстаф DevOps-инженеров для облачной платформы',
    customer: 'ООО «Яндекс.Облако»',
    registryNumber: null,
    platform: 'B2B-Center',
    law: 'commercial',
    nmck: 9_800_000,
    ourPrice: 9_800_000,
    securityAmount: null,
    submissionDeadline: '2026-05-15',
    auctionDate: '2026-05-22',
    status: 'lost',
    priority: 'medium',
    accountManagerId: 'u2',
    daysInStatus: 14,
    kanbanOrder: 0,
    url: null,
    note: '[2026-05-22] lost: Проиграли конкуренту по цене (демпинг -18%). Маржа была бы отрицательной.',
  },
]);

const TENDERS_STORAGE_KEY = 'crm-lg:v1:db:tenders';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function hydrateTendersFromStorage() {
  if (!canUseStorage()) return;
  try {
    const raw = window.localStorage.getItem(TENDERS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Tender[];
    if (!Array.isArray(parsed)) return;
    tendersDb.splice(0, tendersDb.length, ...parsed);
  } catch {
    // ignore broken local data and keep bundled seed
  }
}

export function persistTendersDb() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(TENDERS_STORAGE_KEY, JSON.stringify(tendersDb));
  } catch {
    // ignore quota/storage errors
  }
}

hydrateTendersFromStorage();
