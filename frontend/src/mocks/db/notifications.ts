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
];

export const auditDb: AuditEntry[] = [
  { id: 'au1', entityType: 'candidate', entityId: 'k1', actorId: 'u4', field: 'status', before: 'recruiter_iv', after: 'presented', createdAt: '2026-05-19T10:15:00Z' },
  { id: 'au2', entityType: 'vacancy', entityId: 'v2', actorId: 'u2', field: 'priority', before: 'high', after: 'urgent', createdAt: '2026-05-18T13:21:00Z' },
];
