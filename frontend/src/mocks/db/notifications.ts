import type { ActivityEntry, AuditEntry, Notification } from '@/api/types';

export const notificationsDb: Notification[] = [
  { id: 'n1', userId: 'u1', kind: 'mention', text: 'Анна Кузнецова упомянула вас в комментарии к вакансии Senior Frontend (React)', entityType: 'vacancy', entityId: 'v2', read: false, createdAt: '2026-05-19T08:42:00Z' },
  { id: 'n2', userId: 'u1', kind: 'status_change', text: 'Кандидат Алина Смирнова переведён в статус «На интервью у клиента»', entityType: 'candidate', entityId: 'k2', read: false, createdAt: '2026-05-19T07:21:00Z' },
  { id: 'n3', userId: 'u1', kind: 'system', text: 'Сегодня заканчивается deadline по вакансии Senior Frontend (React)', entityType: 'vacancy', entityId: 'v2', read: false, createdAt: '2026-05-19T06:00:00Z' },
];

export const activityDb: ActivityEntry[] = [
  { id: 'a1', entityType: 'candidate', entityId: 'k1', actorId: 'u4', kind: 'status', text: 'Статус изменён на «Презентован клиенту»', createdAt: '2026-05-19T10:15:00Z' },
  { id: 'a2', entityType: 'candidate', entityId: 'k1', actorId: 'u4', kind: 'note', text: 'Прошёл техническое интервью на 4/5. Сильные стороны: архитектура, кэширование. Рекомендую к презентации клиенту.', createdAt: '2026-05-18T16:42:00Z' },
  { id: 'a3', entityType: 'candidate', entityId: 'k1', actorId: 'u4', kind: 'call', text: 'Скрининг-звонок 30 минут. Подтвердил готовность к гибриду в Москве.', createdAt: '2026-05-17T11:00:00Z' },
  { id: 'a4', entityType: 'candidate', entityId: 'k1', actorId: 'u4', kind: 'create', text: 'Кандидат добавлен в систему', createdAt: '2026-05-16T09:30:00Z' },
  { id: 'a5', entityType: 'client', entityId: 'c1', actorId: 'u2', kind: 'note', text: 'Клиент готов расширять команду в Q3. Приоритет — backend и DevOps.', createdAt: '2026-05-18T14:20:00Z' },
  { id: 'a6', entityType: 'client', entityId: 'c1', actorId: 'u2', kind: 'note', text: 'Встреча с HRD 15 мая: обсудили формат аутстаффа и SLA по закрытию позиций.', createdAt: '2026-05-15T11:05:00Z' },
  { id: 'a7', entityType: 'client', entityId: 'c4', actorId: 'u3', kind: 'note', text: 'На паузе до утверждения бюджета на второе полугодие.', createdAt: '2026-05-12T09:00:00Z' },
  { id: 'a8', entityType: 'vacancy', entityId: 'v2', actorId: 'u2', kind: 'note', text: 'Клиент поднял приоритет до urgent — нужно закрыть до конца месяца.', createdAt: '2026-05-18T13:25:00Z' },
  { id: 'a9', entityType: 'vacancy', entityId: 'v2', actorId: 'u4', kind: 'call', text: 'Синхронизация с заказчиком: уточнили требования по опыту с Next.js и SSR.', createdAt: '2026-05-17T15:10:00Z' },
  { id: 'a10', entityType: 'vacancy', entityId: 'v2', actorId: 'u2', kind: 'create', text: 'Вакансия создана', createdAt: '2026-05-10T09:00:00Z' },
  { id: 'a11', entityType: 'vacancy', entityId: 'v1', actorId: 'u2', kind: 'status', text: 'Статус изменён на «На паузе»', createdAt: '2026-05-16T15:42:00Z' },
  { id: 'a12', entityType: 'vacancy', entityId: 'v1', actorId: 'u2', kind: 'email', text: 'Отправили клиенту шорт-лист из трёх кандидатов, ждём фидбэк по ТЗ.', createdAt: '2026-05-14T12:30:00Z' },
];

export const auditDb: AuditEntry[] = [
  { id: 'au1', entityType: 'candidate', entityId: 'k1', actorId: 'u4', field: 'status', before: 'recruiter_iv', after: 'presented', createdAt: '2026-05-19T10:15:00Z' },
  { id: 'au2', entityType: 'vacancy', entityId: 'v2', actorId: 'u2', field: 'priority', before: 'high', after: 'urgent', createdAt: '2026-05-18T13:21:00Z' },
  { id: 'au3', entityType: 'candidate', entityId: 'k2', actorId: 'u3', field: 'status', before: 'new', after: 'recruiter_iv', createdAt: '2026-05-17T09:05:00Z' },
  { id: 'au4', entityType: 'vacancy', entityId: 'v1', actorId: 'u2', field: 'status', before: 'open', after: 'on_hold', createdAt: '2026-05-16T15:42:00Z' },
  { id: 'au5', entityType: 'client', entityId: 'c1', actorId: 'u2', field: 'status', before: 'lead', after: 'active', createdAt: '2026-05-15T11:30:00Z' },
  { id: 'au6', entityType: 'candidate', entityId: 'k1', actorId: 'u4', field: 'grade', before: 'middle', after: 'senior', createdAt: '2026-05-14T08:20:00Z' },
  { id: 'au7', entityType: 'vacancy', entityId: 'v2', actorId: 'u2', field: 'salary', before: '250000', after: '300000', createdAt: '2026-05-12T14:00:00Z' },
];
