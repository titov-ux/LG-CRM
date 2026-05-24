import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@/lib/constants';
import type {
  ActivityEntry,
  Candidate,
  CandidateStatus,
  Client,
  ClientStatus,
  Comment,
  CommentEntityType,
  ContactListItem,
  Notification,
  User,
  Vacancy,
  VacancyStatus,
} from '@/api/types';
import {
  activityDb,
  auditDb,
  candidateStatuses,
  candidatesDb,
  clientsDb,
  commentsDb,
  contactsDb,
  notificationsDb,
  permissionsMatrixDb,
  persistCandidatesDb,
  persistVacanciesDb,
  resetPermissionsMatrix,
  updatePermissionRow,
  usersDb,
  vacanciesDb,
  vacancyStatuses,
} from './db';
import type { Role } from '@/api/types';

const url = (path: string) => `${API_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;

function paginate<T>(items: T[], pageRaw?: string | null, pageSizeRaw?: string | null) {
  const page = Number(pageRaw ?? 1);
  const pageSize = Number(pageSizeRaw ?? 50);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

function sortByKanbanOrder<T extends { kanbanOrder: number }>(items: T[]) {
  return [...items].sort((a, b) => a.kanbanOrder - b.kanbanOrder);
}

function applyKanbanReorder<T extends { id: string; status: string; kanbanOrder: number; daysInStatus: number }>(
  db: T[],
  updates: { id: string; status: string; kanbanOrder: number }[],
) {
  for (const update of updates) {
    const item = db.find((x) => x.id === update.id);
    if (!item) continue;
    const statusChanged = item.status !== update.status;
    item.status = update.status as T['status'];
    item.kanbanOrder = update.kanbanOrder;
    if (statusChanged) item.daysInStatus = 0;
  }
  return updates.map((u) => db.find((x) => x.id === u.id)).filter(Boolean) as T[];
}

function nextKanbanOrder<T extends { status: string; kanbanOrder: number }>(db: T[], status: string) {
  const inColumn = db.filter((x) => x.status === status);
  if (inColumn.length === 0) return 0;
  return Math.max(...inColumn.map((x) => x.kanbanOrder)) + 1;
}

function actorIdFromRequest(request: Request): string {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const fromToken = token.startsWith('mock.access.') ? token.slice('mock.access.'.length) : null;
  if (fromToken && usersDb.some((u) => u.id === fromToken)) return fromToken;
  return usersDb[0]?.id ?? 'u1';
}

// === Автозапись истории взаимодействий ===
// Все доменные операции (создание сущности, смена статуса и т.п.) должны
// дописывать строку в activityDb через pushActivity, чтобы она появилась
// в блоке «История взаимодействий» в карточке.
//
// На боевом backend этот side-effect должен жить на сервере: фронт сам
// в activity ничего не пишет, кроме явных событий (заметка/звонок/email).
let activitySeq = 0;
function pushActivity(entry: Omit<ActivityEntry, 'id' | 'createdAt'>): ActivityEntry {
  const created: ActivityEntry = {
    ...entry,
    id: `a-${Date.now()}-${++activitySeq}`,
    createdAt: new Date().toISOString(),
  };
  // unshift, чтобы свежие записи лежали в начале массива
  // (плюс GET .../activity сортирует по дате — это страховка).
  activityDb.unshift(created);
  return created;
}

function candidateStatusLabel(id: CandidateStatus): string {
  return candidateStatuses.find((s) => s.id === id)?.label ?? id;
}
function vacancyStatusLabel(id: VacancyStatus): string {
  return vacancyStatuses.find((s) => s.id === id)?.label ?? id;
}

// candidatesCount у вакансии — производное значение от candidatesDb.
// Считаем его на каждом чтении, чтобы поле не дрейфовало от реальности.
// На боевом backend это будет либо JOIN/подзапрос, либо денормализованный счётчик,
// поддерживаемый триггерами/выделенным сервисом; во фронт-моках достаточно вот этой функции.
function computeCandidatesCount(vacancyId: string): number {
  return candidatesDb.filter(
    (c) => !c.archived && c.vacancyIds.includes(vacancyId),
  ).length;
}

// Возвращает копию вакансии с актуальным candidatesCount.
// Важно делать копию: мы не хотим переписывать поле в самом vacanciesDb —
// сохранённое значение всё равно игнорируется, а лишний persist приведёт к
// записи лишнего шума в localStorage.
function withCandidatesCount<T extends { id: string }>(
  vacancy: T,
): T & { candidatesCount: number } {
  return { ...vacancy, candidatesCount: computeCandidatesCount(vacancy.id) };
}
const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  lead: 'Лид',
  in_progress: 'В работе',
  active: 'Активный',
  paused: 'На паузе',
  archived: 'Архив',
};
function clientStatusLabel(id: ClientStatus): string {
  return CLIENT_STATUS_LABEL[id] ?? id;
}

export const handlers = [
  // === Auth ===
  http.post(url('/auth/login'), async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    const user = usersDb.find((u) => u.email === body.email);
    if (!user) return HttpResponse.json({ message: 'Неверные учётные данные' }, { status: 401 });
    return HttpResponse.json({ accessToken: 'mock.access.' + user.id, refreshToken: 'mock.refresh.' + user.id });
  }),
  http.post(url('/auth/refresh'), () => HttpResponse.json({ accessToken: 'mock.access.refreshed' })),
  http.post(url('/auth/logout'), () => HttpResponse.json({ ok: true })),
  http.get(url('/auth/me'), () => HttpResponse.json(usersDb[0])),
  http.patch(url('/auth/me'), async ({ request }) => {
    const body = (await request.json()) as { fullName?: string; email?: string; telegram?: string | null };
    const actorId = actorIdFromRequest(request);
    const user = usersDb.find((u) => u.id === actorId) ?? usersDb[0];
    if (!user) return new HttpResponse(null, { status: 404 });
    if (body.fullName !== undefined) {
      const fullName = body.fullName.trim();
      user.fullName = fullName;
      user.initials =
        fullName
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? '')
          .join('') || 'NN';
    }
    if (body.email !== undefined) user.email = body.email.trim().toLowerCase();
    if (body.telegram !== undefined) {
      const telegram = (body.telegram ?? '').trim();
      if (telegram) user.telegram = telegram;
      else delete user.telegram;
    }
    return HttpResponse.json(user);
  }),

  // === Users ===
  http.get(url('/users'), () => HttpResponse.json(usersDb)),
  http.post(url('/users'), async ({ request }) => {
    const body = (await request.json()) as Partial<User>;
    const email = (body.email ?? '').trim().toLowerCase();
    const telegram = (body.telegram ?? '').trim();
    if (!email) {
      return HttpResponse.json({ message: 'Не указан email' }, { status: 400 });
    }
    if (usersDb.some((u) => u.email.toLowerCase() === email)) {
      return HttpResponse.json({ message: 'Пользователь с таким email уже существует' }, { status: 409 });
    }
    const fullName = (body.fullName ?? 'Без имени').trim();
    const initials = fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || 'NN';
    const palette = ['#0f172a', '#7c3aed', '#0891b2', '#db2777', '#ea580c', '#16a34a', '#2563eb', '#b45309'];
    const color = palette[usersDb.length % palette.length];
    const created: User = {
      id: `u-${Date.now()}`,
      email,
      ...(telegram ? { telegram } : {}),
      fullName,
      role: (body.role as User['role']) ?? 'recruiter',
      initials,
      color,
      isActive: body.isActive ?? true,
    };
    usersDb.unshift(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(url('/users/:id'), async ({ params, request }) => {
    const patch = (await request.json()) as Partial<User>;
    const u = usersDb.find((x) => x.id === params.id);
    if (!u) return new HttpResponse(null, { status: 404 });
    Object.assign(u, patch);
    return HttpResponse.json(u);
  }),
  http.delete(url('/users/:id'), ({ params }) => {
    const idx = usersDb.findIndex((x) => x.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    usersDb.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),

  // === Clients ===
  http.get(url('/clients'), ({ request }) => {
    const u = new URL(request.url);
    const search = u.searchParams.get('search')?.toLowerCase() ?? '';
    const status = u.searchParams.get('status');
    const accountManagerId = u.searchParams.get('accountManagerId');
    const industry = u.searchParams.get('industry');
    const clientKind = u.searchParams.get('clientKind');
    const items = clientsDb.filter((c) => {
      if (
        search &&
        !c.name.toLowerCase().includes(search) &&
        !c.legalEntities.some(
          (le) => le.name.toLowerCase().includes(search) || le.inn.includes(search),
        )
      ) {
        return false;
      }
      if (status && c.status !== status) return false;
      if (accountManagerId && c.accountManagerId !== accountManagerId) return false;
      if (industry && c.industry !== industry) return false;
      if (clientKind && c.clientKind !== clientKind) return false;
      return true;
    });
    return HttpResponse.json(paginate(items, u.searchParams.get('page'), u.searchParams.get('pageSize')));
  }),
  http.post(url('/clients'), async ({ request }) => {
    const body = (await request.json()) as Partial<Client>;
    const created: Client = {
      id: `c-${Date.now()}`,
      name: body.name ?? 'Без названия',
      legalEntities: (body.legalEntities ?? []).map((le, i) => ({
        id: le.id ?? `le-${Date.now()}-${i}`,
        name: le.name,
        inn: le.inn,
      })),
      industry: body.industry ?? '',
      accountManagerId: body.accountManagerId ?? 'u2',
      status: body.status ?? 'lead',
      clientKind: body.clientKind ?? 'direct',
      vacanciesCount: 0,
      contactsCount: 0,
      ...(body.telegramChat?.trim() ? { telegramChat: body.telegramChat.trim() } : {}),
    };
    clientsDb.unshift(created);
    pushActivity({
      entityType: 'client',
      entityId: created.id,
      actorId: actorIdFromRequest(request),
      kind: 'create',
      text: 'Клиент добавлен в систему',
    });
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get(url('/clients/:id'), ({ params }) => {
    const c = clientsDb.find((x) => x.id === params.id);
    return c ? HttpResponse.json(c) : new HttpResponse(null, { status: 404 });
  }),
  http.patch(url('/clients/:id'), async ({ params, request }) => {
    const patch = (await request.json()) as Partial<Client>;
    const c = clientsDb.find((x) => x.id === params.id);
    if (!c) return new HttpResponse(null, { status: 404 });
    const prevStatus = c.status;
    if (patch.legalEntities) {
      c.legalEntities = patch.legalEntities.map((le, i) => ({
        id: le.id ?? `le-${Date.now()}-${i}`,
        name: le.name,
        inn: le.inn,
      }));
    }
    const { legalEntities: _le, telegramChat, ...rest } = patch;
    if (telegramChat !== undefined) {
      const trimmed = telegramChat.trim();
      if (trimmed) c.telegramChat = trimmed;
      else delete c.telegramChat;
    }
    Object.assign(c, rest);
    if (patch.status && patch.status !== prevStatus) {
      pushActivity({
        entityType: 'client',
        entityId: c.id,
        actorId: actorIdFromRequest(request),
        kind: 'status',
        text: `Статус изменён на «${clientStatusLabel(patch.status)}»`,
      });
    }
    return HttpResponse.json(c);
  }),
  http.delete(url('/clients/:id'), ({ params }) => {
    const idx = clientsDb.findIndex((x) => x.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    clientsDb.splice(idx, 1);
    // Удалить связанные контакты и сбросить clientId у вакансий клиента (вакансии сами не удаляем — это решение бизнеса).
    for (let i = contactsDb.length - 1; i >= 0; i--) {
      if (contactsDb[i].clientId === params.id) contactsDb.splice(i, 1);
    }
    return HttpResponse.json({ ok: true });
  }),
  http.get(url('/clients/:id/contacts'), ({ params }) => {
    return HttpResponse.json(contactsDb.filter((x) => x.clientId === params.id));
  }),
  // Старые заметки клиента теперь живут в едином блоке Комментариев (CommentsSection).
  // Эндпоинты /clients/:id/notes удалены вместе с ClientNotesSection.
  // ActivityDb с историческими записями kind='note' сохраняется — может быть показан в общей истории активности.
  http.get(url('/contacts'), ({ request }) => {
    const u = new URL(request.url);
    const search = u.searchParams.get('search')?.toLowerCase() ?? '';
    const clientId = u.searchParams.get('clientId');
    const hasEmail = u.searchParams.get('hasEmail');
    const hasPhone = u.searchParams.get('hasPhone');
    const hasTelegram = u.searchParams.get('hasTelegram');
    const hasBirthday = u.searchParams.get('hasBirthday');
    const items: ContactListItem[] = contactsDb
      .map((contact) => {
        const client = clientsDb.find((c) => c.id === contact.clientId);
        return { ...contact, clientName: client?.name ?? '—' };
      })
      .filter((c) => {
        if (clientId && c.clientId !== clientId) return false;
        if (hasEmail && !c.email) return false;
        if (hasPhone && !c.phone) return false;
        if (hasTelegram && !c.telegram) return false;
        if (hasBirthday && !c.birthday) return false;
        if (!search) return true;
        return (
          c.name.toLowerCase().includes(search) ||
          c.role.toLowerCase().includes(search) ||
          c.clientName.toLowerCase().includes(search) ||
          (c.email?.toLowerCase().includes(search) ?? false) ||
          (c.phone?.includes(search) ?? false) ||
          (c.telegram?.toLowerCase().includes(search) ?? false) ||
          (c.birthday?.includes(search) ?? false)
        );
      });
    return HttpResponse.json(paginate(items, u.searchParams.get('page'), u.searchParams.get('pageSize')));
  }),
  http.get(url('/contacts/:id'), ({ params }) => {
    const contact = contactsDb.find((x) => x.id === params.id);
    if (!contact) return new HttpResponse(null, { status: 404 });
    const client = clientsDb.find((c) => c.id === contact.clientId);
    const item: ContactListItem = { ...contact, clientName: client?.name ?? '—' };
    return HttpResponse.json(item);
  }),
  http.patch(url('/contacts/:id'), async ({ params, request }) => {
    const body = (await request.json()) as {
      name?: string;
      role?: string;
      email?: string;
      phone?: string;
      telegram?: string;
      birthday?: string;
    };
    const contact = contactsDb.find((x) => x.id === params.id);
    if (!contact) return new HttpResponse(null, { status: 404 });
    if (body.name !== undefined) contact.name = body.name;
    if (body.role !== undefined) contact.role = body.role;
    if (body.email !== undefined) {
      if (body.email) contact.email = body.email;
      else delete contact.email;
    }
    if (body.phone !== undefined) {
      if (body.phone) contact.phone = body.phone;
      else delete contact.phone;
    }
    if (body.telegram !== undefined) {
      if (body.telegram) contact.telegram = body.telegram;
      else delete contact.telegram;
    }
    if (body.birthday !== undefined) {
      if (body.birthday) contact.birthday = body.birthday;
      else delete contact.birthday;
    }
    const client = clientsDb.find((c) => c.id === contact.clientId);
    const item: ContactListItem = { ...contact, clientName: client?.name ?? '—' };
    return HttpResponse.json(item);
  }),
  http.delete(url('/contacts/:id'), ({ params }) => {
    const idx = contactsDb.findIndex((x) => x.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const [removed] = contactsDb.splice(idx, 1);
    const client = clientsDb.find((c) => c.id === removed.clientId);
    if (client && client.contactsCount > 0) client.contactsCount -= 1;
    return HttpResponse.json({ ok: true });
  }),
  http.post(url('/clients/:id/contacts'), async ({ params, request }) => {
    const body = (await request.json()) as {
      name?: string;
      role?: string;
      email?: string;
      phone?: string;
      telegram?: string;
      birthday?: string;
    };
    const clientId = params.id as string;
    const client = clientsDb.find((c) => c.id === clientId);
    if (!client) return new HttpResponse(null, { status: 404 });

    const created = {
      id: `ct-${Date.now()}`,
      clientId,
      name: body.name ?? '',
      role: body.role ?? '',
      ...(body.email ? { email: body.email } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
      ...(body.telegram ? { telegram: body.telegram } : {}),
      ...(body.birthday ? { birthday: body.birthday } : {}),
    };
    contactsDb.push(created);
    client.contactsCount += 1;
    return HttpResponse.json(created, { status: 201 });
  }),

  // === Vacancies ===
  http.get(url('/vacancies'), ({ request }) => {
    const u = new URL(request.url);
    const search = u.searchParams.get('search')?.toLowerCase() ?? '';
    const grade = u.searchParams.get('grade');
    const priority = u.searchParams.get('priority');
    const clientId = u.searchParams.get('clientId');
    const recruiterId = u.searchParams.get('recruiterId');
    const accountManagerId = u.searchParams.get('accountManagerId');
    const engagementType = u.searchParams.get('engagementType');
    const items = vacanciesDb.filter((v) => {
      if (search && !v.title.toLowerCase().includes(search)) return false;
      if (grade && v.grade !== grade) return false;
      if (priority && v.priority !== priority) return false;
      if (clientId && v.clientId !== clientId) return false;
      if (recruiterId && !v.recruiterIds.includes(recruiterId)) return false;
      if (accountManagerId && v.accountManagerId !== accountManagerId) return false;
      if (engagementType && v.engagementType !== engagementType) return false;
      return true;
    });
    return HttpResponse.json(
      paginate(
        sortByKanbanOrder(items).map(withCandidatesCount),
        u.searchParams.get('page'),
        u.searchParams.get('pageSize'),
      ),
    );
  }),
  http.put(url('/vacancies/kanban-order'), async ({ request }) => {
    const body = (await request.json()) as { updates: { id: string; status: VacancyStatus; kanbanOrder: number }[] };
    // См. комментарий в /candidates/kanban-order — логируем только реальную смену статуса.
    const before = new Map(vacanciesDb.map((v) => [v.id, v.status]));
    const updated = applyKanbanReorder(vacanciesDb, body.updates);
    const actorId = actorIdFromRequest(request);
    for (const u of body.updates) {
      const prev = before.get(u.id);
      if (prev && prev !== u.status) {
        pushActivity({
          entityType: 'vacancy',
          entityId: u.id,
          actorId,
          kind: 'status',
          text: `Статус изменён на «${vacancyStatusLabel(u.status)}»`,
        });
      }
    }
    persistVacanciesDb();
    return HttpResponse.json(updated.map(withCandidatesCount));
  }),
  http.post(url('/vacancies'), async ({ request }) => {
    const body = (await request.json()) as Partial<Vacancy>;
    const client = clientsDb.find((c) => c.id === (body.clientId ?? ''));
    const created: Vacancy = {
      id: `v-${Date.now()}`,
      title: body.title ?? 'Без названия',
      clientId: body.clientId ?? '',
      engagementType: body.engagementType ?? 'outstaff',
      project: body.project,
      grade: body.grade ?? 'Middle',
      stack: body.stack ?? [],
      format: body.format ?? 'Гибрид',
      rateClient: body.rateClient ?? 0,
      salaryMax: body.salaryMax,
      positions: body.positions ?? 1,
      status: body.status ?? 'new',
      priority: body.priority ?? 'medium',
      // Если фронт не передал АМ — наследуем от клиента (страховка для старого кода).
      accountManagerId: body.accountManagerId ?? client?.accountManagerId ?? '',
      recruiterIds: body.recruiterIds ?? [],
      daysInStatus: 0,
      // candidatesCount считается на чтении (см. withCandidatesCount). В сторе
      // держим 0 как заглушку, чтобы удовлетворить тип Vacancy.
      candidatesCount: 0,
      deadline: body.deadline ?? null,
      kanbanOrder: nextKanbanOrder(vacanciesDb, body.status ?? 'new'),
      description: body.description,
      requirements: body.requirements,
    };
    vacanciesDb.unshift(created);
    persistVacanciesDb();
    if (client) client.vacanciesCount += 1;
    pushActivity({
      entityType: 'vacancy',
      entityId: created.id,
      actorId: actorIdFromRequest(request),
      kind: 'create',
      text: 'Вакансия добавлена в систему',
    });
    return HttpResponse.json(withCandidatesCount(created), { status: 201 });
  }),
  // POST /vacancies/parse-text — AI-распознавание брифа. В MSW его НЕ мокаем:
  // при VITE_USE_MOCKS=true фронт обращается к боевому backend напрямую, либо
  // получает 503 ai_unavailable, если ключ Anthropic не сконфигурирован.
  http.get(url('/vacancies/:id'), ({ params }) => {
    const v = vacanciesDb.find((x) => x.id === params.id);
    return v ? HttpResponse.json(withCandidatesCount(v)) : new HttpResponse(null, { status: 404 });
  }),
  http.patch(url('/vacancies/:id/status'), async ({ params, request }) => {
    const body = (await request.json()) as { status: VacancyStatus };
    const v = vacanciesDb.find((x) => x.id === params.id);
    if (!v) return new HttpResponse(null, { status: 404 });
    const prev = v.status;
    v.status = body.status;
    v.daysInStatus = 0;
    if (prev !== body.status) {
      pushActivity({
        entityType: 'vacancy',
        entityId: v.id,
        actorId: actorIdFromRequest(request),
        kind: 'status',
        text: `Статус изменён на «${vacancyStatusLabel(body.status)}»`,
      });
    }
    persistVacanciesDb();
    return HttpResponse.json(withCandidatesCount(v));
  }),
  http.patch(url('/vacancies/:id'), async ({ params, request }) => {
    const patch = (await request.json()) as Partial<Vacancy>;
    const v = vacanciesDb.find((x) => x.id === params.id);
    if (!v) return new HttpResponse(null, { status: 404 });
    // Менять тип сделки разрешено только если нет «зависших» привязок другого типа.
    if (patch.engagementType && patch.engagementType !== v.engagementType) {
      const conflicting = candidatesDb.filter(
        (c) => c.vacancyIds.includes(v.id) && c.engagementType !== patch.engagementType,
      );
      if (conflicting.length > 0) {
        return HttpResponse.json(
          {
            code: 'engagement_type_conflict',
            message:
              'К вакансии прикреплены кандидаты другого типа. Сначала открепите их или смените тип.',
          },
          { status: 409 },
        );
      }
    }
    Object.assign(v, patch);
    persistVacanciesDb();
    return HttpResponse.json(withCandidatesCount(v));
  }),
  http.delete(url('/vacancies/:id'), ({ params }) => {
    const idx = vacanciesDb.findIndex((x) => x.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const [removed] = vacanciesDb.splice(idx, 1);
    persistVacanciesDb();
    const client = clientsDb.find((c) => c.id === removed.clientId);
    if (client && client.vacanciesCount > 0) client.vacanciesCount -= 1;
    return HttpResponse.json({ ok: true });
  }),
  http.get(url('/vacancies/:id/activity'), ({ params }) =>
    HttpResponse.json(
      activityDb
        .filter((a) => a.entityType === 'vacancy' && a.entityId === params.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    ),
  ),
  http.get(url('/vacancies/:id/candidates'), ({ params }) => {
    return HttpResponse.json(
      candidatesDb
        .filter((c) => c.vacancyIds.includes(params.id as string))
        .map((c) => ({
          id: `m-${params.id}-${c.id}`,
          vacancyId: params.id as string,
          candidateId: c.id,
          status: 'submitted',
          addedById: 'u4',
          addedAt: '2026-05-17T10:00:00Z',
        })),
    );
  }),
  http.post(url('/vacancies/:id/candidates'), async ({ params, request }) => {
    const vacancyId = params.id as string;
    const body = (await request.json()) as { candidateId?: string };
    const candidateId = body.candidateId ?? '';
    const vacancy = vacanciesDb.find((v) => v.id === vacancyId);
    const candidate = candidatesDb.find((c) => c.id === candidateId);
    if (!vacancy || !candidate) return new HttpResponse(null, { status: 404 });
    // Кандидата и вакансию разных типов сделки соединять нельзя.
    // Защита на бэке — UI это уже фильтрует, но прямой вызов API не должен обходить правило.
    if (vacancy.engagementType !== candidate.engagementType) {
      return HttpResponse.json(
        {
          code: 'engagement_type_mismatch',
          message:
            'Тип кандидата не совпадает с типом вакансии: их нельзя связать друг с другом.',
        },
        { status: 409 },
      );
    }
    if (!candidate.vacancyIds.includes(vacancyId)) {
      candidate.vacancyIds.push(vacancyId);
      // candidatesCount пересчитывается на чтении — ручной инкремент больше не нужен.
      persistCandidatesDb();
    }
    return HttpResponse.json({
      id: `m-${vacancyId}-${candidateId}`,
      vacancyId,
      candidateId,
      status: 'submitted',
      addedById: 'u4',
      addedAt: new Date().toISOString(),
    });
  }),
  // Открепить кандидата от вакансии. matchId синтетический: `m-{vacancyId}-{candidateId}`.
  http.delete(url('/matches/:matchId'), ({ params }) => {
    const matchId = params.matchId as string;
    const m = matchId.match(/^m-(.+?)-([^-]+)$/);
    if (!m) return new HttpResponse(null, { status: 404 });
    const [, vacancyId, candidateId] = m;
    const vacancy = vacanciesDb.find((v) => v.id === vacancyId);
    const candidate = candidatesDb.find((c) => c.id === candidateId);
    if (!vacancy || !candidate) return new HttpResponse(null, { status: 404 });
    const idx = candidate.vacancyIds.indexOf(vacancyId);
    if (idx !== -1) {
      candidate.vacancyIds.splice(idx, 1);
      // candidatesCount пересчитывается на чтении — ручной декремент больше не нужен.
      persistCandidatesDb();
    }
    return HttpResponse.json({ ok: true });
  }),

  // === Candidates ===
  http.get(url('/candidates'), ({ request }) => {
    const u = new URL(request.url);
    const search = u.searchParams.get('search')?.toLowerCase() ?? '';
    const grade = u.searchParams.get('grade');
    const recruiterId = u.searchParams.get('recruiterId');
    const stack = u.searchParams.get('stack');
    const engagementType = u.searchParams.get('engagementType');
    const employmentType = u.searchParams.get('employmentType');
    const archivedRaw = u.searchParams.get('archived');
    // archived: undefined → только активные (для канбан-доски),
    //          'true'    → только архив,
    //          'all'     → и те и другие (раздел «База кандидатов»).
    const items = candidatesDb.filter((c) => {
      const isArchived = !!c.archived;
      if (archivedRaw === null) {
        if (isArchived) return false;
      } else if (archivedRaw === 'all') {
        // не фильтруем
      } else if (archivedRaw === 'true' || archivedRaw === '1') {
        if (!isArchived) return false;
      } else if (archivedRaw === 'false' || archivedRaw === '0') {
        if (isArchived) return false;
      }
      if (search && !c.fullName.toLowerCase().includes(search) && !c.role.toLowerCase().includes(search)) return false;
      if (grade && c.grade !== grade) return false;
      if (recruiterId && c.recruiterId !== recruiterId) return false;
      if (stack && !c.stack.some((s) => s.toLowerCase().includes(stack.toLowerCase()))) return false;
      if (engagementType && c.engagementType !== engagementType) return false;
      if (employmentType && c.employmentType !== employmentType) return false;
      return true;
    });
    return HttpResponse.json(paginate(sortByKanbanOrder(items), u.searchParams.get('page'), u.searchParams.get('pageSize')));
  }),
  http.put(url('/candidates/kanban-order'), async ({ request }) => {
    const body = (await request.json()) as { updates: { id: string; status: CandidateStatus; kanbanOrder: number }[] };
    // Запоминаем предыдущие статусы, чтобы залогировать только реальную смену.
    const before = new Map(candidatesDb.map((c) => [c.id, c.status]));
    const updated = applyKanbanReorder(candidatesDb, body.updates);
    const actorId = actorIdFromRequest(request);
    for (const u of body.updates) {
      const prev = before.get(u.id);
      if (prev && prev !== u.status) {
        pushActivity({
          entityType: 'candidate',
          entityId: u.id,
          actorId,
          kind: 'status',
          text: `Статус изменён на «${candidateStatusLabel(u.status)}»`,
        });
      }
    }
    persistCandidatesDb();
    return HttpResponse.json(updated);
  }),
  http.post(url('/candidates'), async ({ request }) => {
    const body = (await request.json()) as Partial<Candidate>;
    const created: Candidate = {
      id: `cand-${Date.now()}`,
      fullName: body.fullName ?? 'Без имени',
      role: body.role ?? '',
      engagementType: body.engagementType ?? 'outstaff',
      grade: body.grade ?? 'Middle',
      experienceYears: body.experienceYears ?? 0,
      stack: body.stack ?? [],
      rateMonth: body.rateMonth ?? 0,
      employmentType: body.employmentType ?? 'ИП',
      format: body.format ?? 'Гибрид',
      location: body.location ?? '',
      recruiterId: body.recruiterId ?? 'u4',
      status: body.status ?? 'new',
      daysInStatus: 0,
      vacancyIds: body.vacancyIds ?? [],
      birthday: body.birthday,
      telegram: body.telegram,
      phone: body.phone,
      email: body.email,
      kanbanOrder: nextKanbanOrder(candidatesDb, body.status ?? 'new'),
      summary: body.summary,
      skillCategories: body.skillCategories,
      experience: body.experience,
      education: body.education,
      certifications: body.certifications,
      languages: body.languages,
    };
    candidatesDb.unshift(created);
    persistCandidatesDb();
    pushActivity({
      entityType: 'candidate',
      entityId: created.id,
      actorId: actorIdFromRequest(request),
      kind: 'create',
      text: 'Кандидат добавлен в систему',
    });
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get(url('/candidates/:id'), ({ params }) => {
    const c = candidatesDb.find((x) => x.id === params.id);
    return c ? HttpResponse.json(c) : new HttpResponse(null, { status: 404 });
  }),
  http.patch(url('/candidates/:id/status'), async ({ params, request }) => {
    const body = (await request.json()) as { status: CandidateStatus };
    const c = candidatesDb.find((x) => x.id === params.id);
    if (!c) return new HttpResponse(null, { status: 404 });
    const prev = c.status;
    c.status = body.status;
    c.daysInStatus = 0;
    if (prev !== body.status) {
      pushActivity({
        entityType: 'candidate',
        entityId: c.id,
        actorId: actorIdFromRequest(request),
        kind: 'status',
        text: `Статус изменён на «${candidateStatusLabel(body.status)}»`,
      });
    }
    persistCandidatesDb();
    return HttpResponse.json(c);
  }),
  http.patch(url('/candidates/:id'), async ({ params, request }) => {
    const patch = (await request.json()) as Partial<Candidate>;
    const c = candidatesDb.find((x) => x.id === params.id);
    if (!c) return new HttpResponse(null, { status: 404 });
    if (patch.engagementType && patch.engagementType !== c.engagementType) {
      const conflicting = c.vacancyIds
        .map((id) => vacanciesDb.find((v) => v.id === id))
        .filter((v): v is Vacancy => !!v)
        .filter((v) => v.engagementType !== patch.engagementType);
      if (conflicting.length > 0) {
        return HttpResponse.json(
          {
            code: 'engagement_type_conflict',
            message:
              'Кандидат прикреплён к вакансиям другого типа. Сначала открепите их или смените тип.',
          },
          { status: 409 },
        );
      }
    }
    Object.assign(c, patch);
    persistCandidatesDb();
    return HttpResponse.json(c);
  }),
  // DELETE без `permanent=true` теперь интерпретируется как «убрать с доски»
  // (archived=true). Полное удаление из базы — только с `?permanent=true`,
  // что на UI разрешено только админу (см. lib/permissions-data.ts).
  http.delete(url('/candidates/:id'), ({ params, request }) => {
    const u = new URL(request.url);
    const permanent = u.searchParams.get('permanent') === 'true';
    const idx = candidatesDb.findIndex((x) => x.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    if (permanent) {
      const [removed] = candidatesDb.splice(idx, 1);
      persistCandidatesDb();
      // candidatesCount у вакансий пересчитывается на чтении — отдельно
      // декрементировать счётчики не нужно. Привязки удалены вместе с кандидатом.
      pushActivity({
        entityType: 'candidate',
        entityId: removed.id,
        actorId: actorIdFromRequest(request),
        kind: 'note',
        text: 'Кандидат удалён из базы (полное удаление)',
      });
      return HttpResponse.json({ ok: true });
    }
    // Архивирование вместо удаления.
    const c = candidatesDb[idx];
    if (!c.archived) {
      c.archived = true;
      c.archivedAt = new Date().toISOString();
      c.archivedById = actorIdFromRequest(request);
      // С доски ушёл — в матчинге не участвует. Чистим только привязки
      // на стороне кандидата; счётчики вакансий пересчитываются на чтении.
      c.vacancyIds = [];
      persistCandidatesDb();
      pushActivity({
        entityType: 'candidate',
        entityId: c.id,
        actorId: actorIdFromRequest(request),
        kind: 'note',
        text: 'Убран с канбан-доски — остался в базе кандидатов',
      });
    }
    return HttpResponse.json({ ok: true });
  }),
  // Явная операция архивирования (с возможной причиной).
  http.post(url('/candidates/:id/archive'), async ({ params, request }) => {
    const c = candidatesDb.find((x) => x.id === params.id);
    if (!c) return new HttpResponse(null, { status: 404 });
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = (body.reason ?? '').trim();
    if (!c.archived) {
      c.archived = true;
      c.archivedAt = new Date().toISOString();
      c.archivedById = actorIdFromRequest(request);
      if (reason) c.archiveReason = reason;
      // Счётчики вакансий пересчитываются на чтении (см. withCandidatesCount).
      c.vacancyIds = [];
      persistCandidatesDb();
      pushActivity({
        entityType: 'candidate',
        entityId: c.id,
        actorId: actorIdFromRequest(request),
        kind: 'note',
        text: reason
          ? `Убран с канбан-доски (${reason})`
          : 'Убран с канбан-доски — остался в базе кандидатов',
      });
    }
    return HttpResponse.json(c);
  }),
  // Восстановить кандидата на доске (archived=false).
  http.post(url('/candidates/:id/restore'), ({ params, request }) => {
    const c = candidatesDb.find((x) => x.id === params.id);
    if (!c) return new HttpResponse(null, { status: 404 });
    if (c.archived) {
      c.archived = false;
      c.archivedAt = null;
      c.archivedById = null;
      delete c.archiveReason;
      // Кандидат возвращается в столбец «Новый» в самый низ — это безопасный
      // дефолт. Если в карточке нужен исходный статус, его можно поменять руками.
      c.status = 'new';
      c.daysInStatus = 0;
      c.kanbanOrder = nextKanbanOrder(candidatesDb, 'new');
      persistCandidatesDb();
      pushActivity({
        entityType: 'candidate',
        entityId: c.id,
        actorId: actorIdFromRequest(request),
        kind: 'note',
        text: 'Восстановлен на канбан-доске',
      });
    }
    return HttpResponse.json(c);
  }),
  http.get(url('/candidates/:id/activity'), ({ params }) =>
    HttpResponse.json(
      activityDb
        .filter((a) => a.entityType === 'candidate' && a.entityId === params.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    ),
  ),

  // === Comments ===
  // Список комментариев по сущности. Сортировка — по возрастанию даты создания
  // (старые сверху, ответы идут после своего родителя), как привычно в чатах.
  http.get(url('/comments'), ({ request }) => {
    const u = new URL(request.url);
    const entityType = u.searchParams.get('entityType') as CommentEntityType | null;
    const entityId = u.searchParams.get('entityId');
    if (!entityType || !entityId) {
      return HttpResponse.json({ message: 'entityType и entityId обязательны' }, { status: 400 });
    }
    const items = commentsDb
      .filter((c) => c.entityType === entityType && c.entityId === entityId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return HttpResponse.json(items);
  }),
  http.post(url('/comments'), async ({ request }) => {
    const body = (await request.json()) as {
      entityType?: CommentEntityType;
      entityId?: string;
      text?: string;
      parentId?: string | null;
      mentions?: string[];
    };
    const text = body.text?.trim();
    if (!body.entityType || !body.entityId) {
      return HttpResponse.json({ message: 'entityType и entityId обязательны' }, { status: 400 });
    }
    if (!text) {
      return HttpResponse.json({ message: 'Текст комментария обязателен' }, { status: 400 });
    }
    if (text.length > 2000) {
      return HttpResponse.json({ message: 'Комментарий не может быть длиннее 2000 символов' }, { status: 400 });
    }
    if (body.parentId && !commentsDb.some((c) => c.id === body.parentId)) {
      return HttpResponse.json({ message: 'Родительский комментарий не найден' }, { status: 400 });
    }
    const actorId = actorIdFromRequest(request);
    const mentions = (body.mentions ?? []).filter((id) => usersDb.some((u) => u.id === id));
    const created: Comment = {
      id: `cm-${Date.now()}`,
      entityType: body.entityType,
      entityId: body.entityId,
      authorId: actorId,
      parentId: body.parentId ?? null,
      text,
      mentions,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    commentsDb.push(created);

    // Триггер уведомлений упомянутым пользователям (кроме самого себя).
    const author = usersDb.find((u) => u.id === actorId);
    const entityLabel =
      body.entityType === 'contact'
        ? 'контакту'
        : body.entityType === 'candidate'
          ? 'кандидату'
          : body.entityType === 'client'
            ? 'клиенту'
            : 'вакансии';
    for (const userId of mentions) {
      if (userId === actorId) continue;
      const notif: Notification = {
        id: `n-${Date.now()}-${userId}`,
        userId,
        kind: 'mention',
        text: `${author?.fullName ?? 'Коллега'} упомянул(а) вас в комментарии к ${entityLabel}`,
        entityType: body.entityType,
        entityId: body.entityId,
        read: false,
        createdAt: created.createdAt,
      };
      notificationsDb.unshift(notif);
    }

    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(url('/comments/:id'), async ({ params, request }) => {
    const comment = commentsDb.find((c) => c.id === params.id);
    if (!comment) return new HttpResponse(null, { status: 404 });
    const actorId = actorIdFromRequest(request);
    if (comment.authorId !== actorId) {
      return HttpResponse.json({ message: 'Редактировать может только автор' }, { status: 403 });
    }
    const body = (await request.json()) as { text?: string; mentions?: string[] };
    const text = body.text?.trim();
    if (!text) {
      return HttpResponse.json({ message: 'Текст комментария обязателен' }, { status: 400 });
    }
    if (text.length > 2000) {
      return HttpResponse.json({ message: 'Комментарий не может быть длиннее 2000 символов' }, { status: 400 });
    }
    comment.text = text;
    if (body.mentions) {
      comment.mentions = body.mentions.filter((id) => usersDb.some((u) => u.id === id));
    }
    comment.updatedAt = new Date().toISOString();
    return HttpResponse.json(comment);
  }),
  http.delete(url('/comments/:id'), ({ params, request }) => {
    const idx = commentsDb.findIndex((c) => c.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const actorId = actorIdFromRequest(request);
    if (commentsDb[idx].authorId !== actorId) {
      return HttpResponse.json({ message: 'Удалить может только автор' }, { status: 403 });
    }
    // Удаляем сам комментарий и все ответы на него (чтобы не оставались висячие ветки).
    const id = commentsDb[idx].id;
    const toRemove = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of commentsDb) {
        if (c.parentId && toRemove.has(c.parentId) && !toRemove.has(c.id)) {
          toRemove.add(c.id);
          changed = true;
        }
      }
    }
    for (let i = commentsDb.length - 1; i >= 0; i--) {
      if (toRemove.has(commentsDb[i].id)) commentsDb.splice(i, 1);
    }
    return HttpResponse.json({ ok: true });
  }),

  // === Notifications ===
  http.get(url('/notifications'), () => HttpResponse.json(notificationsDb)),
  http.patch(url('/notifications/:id/read'), ({ params }) => {
    const n = notificationsDb.find((x) => x.id === params.id);
    if (!n) return new HttpResponse(null, { status: 404 });
    n.read = true;
    return HttpResponse.json(n);
  }),
  http.post(url('/notifications/read-all'), () => {
    notificationsDb.forEach((n) => (n.read = true));
    return HttpResponse.json({ ok: true });
  }),

  // === Audit ===
  http.get(url('/audit'), ({ request }) => {
    const u = new URL(request.url);
    const entityType = u.searchParams.get('entityType');
    const entityId = u.searchParams.get('entityId');
    const actorId = u.searchParams.get('actorId');
    const field = u.searchParams.get('field');
    const dateFrom = u.searchParams.get('dateFrom'); // YYYY-MM-DD
    const dateTo = u.searchParams.get('dateTo');     // YYYY-MM-DD
    const search = u.searchParams.get('search')?.trim().toLowerCase() ?? '';

    // верхняя граница периода — конец дня
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999Z`).getTime() : null;

    const filtered = auditDb.filter((row) => {
      if (entityType && row.entityType !== entityType) return false;
      if (entityId && row.entityId !== entityId) return false;
      if (actorId && row.actorId !== actorId) return false;
      if (field && row.field !== field) return false;
      const ts = new Date(row.createdAt).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      if (search) {
        const hay = [row.field, row.before ?? '', row.after ?? '', row.entityId]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Свежие — сверху
    const sorted = [...filtered].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return HttpResponse.json(sorted);
  }),

  // === Analytics ===
  http.get(url('/analytics/summary'), () => {
    const openVacancies = vacanciesDb.filter((v) => !['closed_success', 'paused'].includes(v.status)).length;
    const activeCandidates = candidatesDb.filter(
      (c) => !['hired', 'reserve', 'rejected_client', 'rejected_candidate'].includes(c.status),
    ).length;
    const closedThisMonth = vacanciesDb.filter((v) => v.status === 'closed_success').length;
    const hiredThisMonth = candidatesDb.filter((c) => c.status === 'hired').length;
    return HttpResponse.json({
      openVacancies,
      activeCandidates,
      closedThisMonth,
      hiredThisMonth,
      delta: { openVacancies: 3, activeCandidates: 12, closedThisMonth: 2, hiredThisMonth: 1 },
    });
  }),
  http.get(url('/analytics/funnel'), () => {
    const counts: Record<string, number> = {};
    vacanciesDb.forEach((v) => {
      counts[v.status] = (counts[v.status] ?? 0) + 1;
    });
    return HttpResponse.json(Object.entries(counts).map(([status, count]) => ({ status, count })));
  }),
  http.get(url('/analytics/recruiter-load'), () => {
    const out = usersDb
      .filter((u) => u.role === 'recruiter')
      .map((u) => ({
        recruiterId: u.id,
        activeCount: candidatesDb.filter(
          (c) => c.recruiterId === u.id && !['hired', 'reserve', 'rejected_client', 'rejected_candidate'].includes(c.status),
        ).length,
      }));
    return HttpResponse.json(out);
  }),

  // === Permissions matrix ===
  http.get(url('/permissions-matrix'), () => {
    return HttpResponse.json({ items: permissionsMatrixDb });
  }),
  http.put(url('/permissions-matrix/:id'), async ({ params, request }) => {
    const body = (await request.json()) as { matrix: Record<Role, boolean> };
    const updated = updatePermissionRow(String(params.id), body.matrix);
    if (!updated) {
      return new HttpResponse('Permission row not found', { status: 404 });
    }
    return HttpResponse.json(updated);
  }),
  http.post(url('/permissions-matrix/reset'), () => {
    const items = resetPermissionsMatrix();
    return HttpResponse.json({ items });
  }),
];

// ─────────────────────────────────────────────────────────────
// Постепенный переход с MSW на боевой API (см. План_перехода_на_API.docx).
// VITE_DISABLED_HANDLERS — CSV-список доменов (первый сегмент пути), MSW которых
// отключается. Пример: VITE_DISABLED_HANDLERS=users,permissions-matrix —
// фронт всё ещё мокает остальное, но /users и /permissions-matrix идут в реальный API.
// ─────────────────────────────────────────────────────────────
function domainOfHandler(handler: (typeof handlers)[number]): string {
  // MSW v2: у каждого handler есть info.path (см. https://mswjs.io)
  const path = (handler as unknown as { info?: { path: string } }).info?.path ?? '';
  // Срезаем API_BASE_URL и берём первый сегмент.
  const rest = path
    .replace(API_BASE_URL, '')
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/^\/+/, '');
  return rest.split('/')[0] ?? '';
}

export function enabledHandlers(): typeof handlers {
  const raw = (import.meta.env.VITE_DISABLED_HANDLERS as string | undefined) ?? '';
  const disabled = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (disabled.length === 0) return handlers;
  return handlers.filter((h) => !disabled.includes(domainOfHandler(h)));
}
