import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@/lib/constants';
import type {
  Candidate,
  CandidateStatus,
  Client,
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
  candidatesDb,
  clientsDb,
  commentsDb,
  contactsDb,
  notificationsDb,
  usersDb,
  vacanciesDb,
} from './db';

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

  // === Users ===
  http.get(url('/users'), () => HttpResponse.json(usersDb)),
  http.post(url('/users'), async ({ request }) => {
    const body = (await request.json()) as Partial<User>;
    const email = (body.email ?? '').trim().toLowerCase();
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
    const items = clientsDb.filter(
      (c) =>
        (!search ||
          c.name.toLowerCase().includes(search) ||
          c.legalEntities.some(
            (le) => le.name.toLowerCase().includes(search) || le.inn.includes(search),
          )) &&
        (!status || c.status === status),
    );
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
      vacanciesCount: 0,
      contactsCount: 0,
      ...(body.telegramChat?.trim() ? { telegramChat: body.telegramChat.trim() } : {}),
    };
    clientsDb.unshift(created);
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
    const items: ContactListItem[] = contactsDb
      .map((contact) => {
        const client = clientsDb.find((c) => c.id === contact.clientId);
        return { ...contact, clientName: client?.name ?? '—' };
      })
      .filter((c) => {
        if (clientId && c.clientId !== clientId) return false;
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
    const items = vacanciesDb.filter((v) => {
      if (search && !v.title.toLowerCase().includes(search)) return false;
      if (grade && v.grade !== grade) return false;
      if (priority && v.priority !== priority) return false;
      if (clientId && v.clientId !== clientId) return false;
      if (recruiterId && !v.recruiterIds.includes(recruiterId)) return false;
      return true;
    });
    return HttpResponse.json(paginate(sortByKanbanOrder(items), u.searchParams.get('page'), u.searchParams.get('pageSize')));
  }),
  http.put(url('/vacancies/kanban-order'), async ({ request }) => {
    const body = (await request.json()) as { updates: { id: string; status: VacancyStatus; kanbanOrder: number }[] };
    const updated = applyKanbanReorder(vacanciesDb, body.updates);
    return HttpResponse.json(updated);
  }),
  http.post(url('/vacancies'), async ({ request }) => {
    const body = (await request.json()) as Partial<Vacancy>;
    const created: Vacancy = {
      id: `v-${Date.now()}`,
      title: body.title ?? 'Без названия',
      clientId: body.clientId ?? '',
      project: body.project,
      grade: body.grade ?? 'Middle',
      stack: body.stack ?? [],
      format: body.format ?? 'Гибрид',
      rateClient: body.rateClient ?? 0,
      positions: body.positions ?? 1,
      status: body.status ?? 'new',
      priority: body.priority ?? 'medium',
      recruiterIds: body.recruiterIds ?? [],
      daysInStatus: 0,
      candidatesCount: 0,
      deadline: body.deadline ?? null,
      kanbanOrder: nextKanbanOrder(vacanciesDb, body.status ?? 'new'),
      description: body.description,
      requirements: body.requirements,
    };
    vacanciesDb.unshift(created);
    const client = clientsDb.find((c) => c.id === created.clientId);
    if (client) client.vacanciesCount += 1;
    return HttpResponse.json(created, { status: 201 });
  }),
  // ==========================================================================
  // [AI-MOCK] МОК-ОБРАБОТЧИК AI-РАСПОЗНАВАНИЯ БРИФА.
  // --------------------------------------------------------------------------
  // Когда AI-эндпоинт переедет на боевой backend:
  //   • УДАЛИТЬ этот handler целиком (msw больше не должен перехватывать запрос),
  //   • УДАЛИТЬ файл src/features/vacancies/parseVacancyText.ts,
  //   • в src/features/vacancies/VacancyImportDialog.tsx убрать fallback-блок [AI-MOCK].
  // Контракт ответа { parsed: ParsedVacancy } должен сохраниться на боевом API.
  // ==========================================================================
  http.post(url('/vacancies/parse-text'), async ({ request }) => {
    const { text } = (await request.json()) as { text?: string };
    if (!text || !text.trim()) {
      return HttpResponse.json({ error: 'empty_text' }, { status: 400 });
    }
    // Динамический импорт — парсер не тянется в основной бандл моков.
    const { parseVacancyText } = await import('@/features/vacancies/parseVacancyText');
    const parsed = parseVacancyText(text);
    await new Promise((r) => setTimeout(r, 700 + Math.random() * 500)); // имитация задержки LLM
    return HttpResponse.json({ parsed });
  }),
  http.get(url('/vacancies/:id'), ({ params }) => {
    const v = vacanciesDb.find((x) => x.id === params.id);
    return v ? HttpResponse.json(v) : new HttpResponse(null, { status: 404 });
  }),
  http.patch(url('/vacancies/:id/status'), async ({ params, request }) => {
    const body = (await request.json()) as { status: VacancyStatus };
    const v = vacanciesDb.find((x) => x.id === params.id);
    if (!v) return new HttpResponse(null, { status: 404 });
    v.status = body.status;
    v.daysInStatus = 0;
    return HttpResponse.json(v);
  }),
  http.patch(url('/vacancies/:id'), async ({ params, request }) => {
    const patch = (await request.json()) as Partial<Vacancy>;
    const v = vacanciesDb.find((x) => x.id === params.id);
    if (!v) return new HttpResponse(null, { status: 404 });
    Object.assign(v, patch);
    return HttpResponse.json(v);
  }),
  http.delete(url('/vacancies/:id'), ({ params }) => {
    const idx = vacanciesDb.findIndex((x) => x.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    const [removed] = vacanciesDb.splice(idx, 1);
    const client = clientsDb.find((c) => c.id === removed.clientId);
    if (client && client.vacanciesCount > 0) client.vacanciesCount -= 1;
    return HttpResponse.json({ ok: true });
  }),
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

  // === Candidates ===
  http.get(url('/candidates'), ({ request }) => {
    const u = new URL(request.url);
    const search = u.searchParams.get('search')?.toLowerCase() ?? '';
    const grade = u.searchParams.get('grade');
    const recruiterId = u.searchParams.get('recruiterId');
    const stack = u.searchParams.get('stack');
    const items = candidatesDb.filter((c) => {
      if (search && !c.fullName.toLowerCase().includes(search) && !c.role.toLowerCase().includes(search)) return false;
      if (grade && c.grade !== grade) return false;
      if (recruiterId && c.recruiterId !== recruiterId) return false;
      if (stack && !c.stack.some((s) => s.toLowerCase().includes(stack.toLowerCase()))) return false;
      return true;
    });
    return HttpResponse.json(paginate(sortByKanbanOrder(items), u.searchParams.get('page'), u.searchParams.get('pageSize')));
  }),
  http.put(url('/candidates/kanban-order'), async ({ request }) => {
    const body = (await request.json()) as { updates: { id: string; status: CandidateStatus; kanbanOrder: number }[] };
    const updated = applyKanbanReorder(candidatesDb, body.updates);
    return HttpResponse.json(updated);
  }),
  http.post(url('/candidates'), async ({ request }) => {
    const body = (await request.json()) as Partial<Candidate>;
    const created: Candidate = {
      id: `cand-${Date.now()}`,
      fullName: body.fullName ?? 'Без имени',
      role: body.role ?? '',
      grade: body.grade ?? 'Middle',
      experienceYears: body.experienceYears ?? 0,
      stack: body.stack ?? [],
      rate: body.rate ?? 0,
      format: body.format ?? 'Гибрид',
      location: body.location ?? '',
      source: body.source ?? 'Прямой поиск',
      recruiterId: body.recruiterId ?? 'u4',
      status: body.status ?? 'new',
      daysInStatus: 0,
      vacancyIds: body.vacancyIds ?? [],
      hot: body.hot ?? false,
      email: body.email,
      phone: body.phone,
      kanbanOrder: nextKanbanOrder(candidatesDb, body.status ?? 'new'),
    };
    candidatesDb.unshift(created);
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
    c.status = body.status;
    c.daysInStatus = 0;
    return HttpResponse.json(c);
  }),
  http.patch(url('/candidates/:id'), async ({ params, request }) => {
    const patch = (await request.json()) as Partial<Candidate>;
    const c = candidatesDb.find((x) => x.id === params.id);
    if (!c) return new HttpResponse(null, { status: 404 });
    Object.assign(c, patch);
    return HttpResponse.json(c);
  }),
  http.delete(url('/candidates/:id'), ({ params }) => {
    const idx = candidatesDb.findIndex((x) => x.id === params.id);
    if (idx === -1) return new HttpResponse(null, { status: 404 });
    candidatesDb.splice(idx, 1);
    return HttpResponse.json({ ok: true });
  }),
  http.get(url('/candidates/:id/activity'), ({ params }) =>
    HttpResponse.json(activityDb.filter((a) => a.entityType === 'candidate' && a.entityId === params.id)),
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
  http.get(url('/audit'), () => HttpResponse.json(auditDb)),

  // === Analytics ===
  http.get(url('/analytics/summary'), () => {
    const openVacancies = vacanciesDb.filter((v) => !['closed_success', 'paused'].includes(v.status)).length;
    const activeCandidates = candidatesDb.filter((c) => !['hired', 'reserve'].includes(c.status)).length;
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
        activeCount: candidatesDb.filter((c) => c.recruiterId === u.id && !['hired', 'reserve'].includes(c.status)).length,
      }));
    return HttpResponse.json(out);
  }),
];
