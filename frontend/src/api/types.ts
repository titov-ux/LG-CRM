// Серверные DTO. В боевой версии этот файл генерируется из OpenAPI (см. README → «Кодогенерация»).
// Пока — ручной зеркальный набор, согласованный с архитектурой §6.

import type { FileResponse } from './files';

export type UUID = string;

// Реэкспорт для удобства использования в фичах, которые тянут типы из @/api/types.
export type { FileResponse };

// === Users ===
export type Role = 'admin' | 'account_manager' | 'recruiter' | 'viewer';

export interface User {
  id: UUID;
  email: string;
  telegram?: string;
  fullName: string;
  role: Role;
  initials: string;
  color: string;
  isActive: boolean;
}

export interface CreateUserRequest {
  email: string;
  telegram?: string;
  fullName: string;
  role: Role;
  /** Если не указан — пользователь создаётся через invite-flow (письмо со ссылкой). */
  password?: string;
  isActive?: boolean;
}

/**
 * Ответ POST /users. `inviteUrl` появляется только в invite-flow и только
 * если SMTP не настроен / отправка письма не удалась. На проде с рабочим
 * SMTP — всегда null, админ ссылку не видит.
 */
export interface CreateUserResponse {
  user: User;
  inviteUrl?: string | null;
}

export interface InviteResendResponse {
  user: User;
  inviteUrl?: string | null;
  /** true — письмо реально ушло; false — fallback на inviteUrl. */
  emailSent: boolean;
}

export interface InviteInfo {
  email: string;
  fullName: string;
}

export interface ActivateInviteRequest {
  password: string;
}

// === Clients ===
export type ClientStatus = 'lead' | 'in_progress' | 'active' | 'paused' | 'archived';

/**
 * Тип клиента в воронке продаж:
 *  - 'direct'        — прямой клиент: договор и работа напрямую с компанией-конечным заказчиком.
 *  - 'intermediary'  — посредник: агентство/интегратор, через которого идёт работа с конечным заказчиком.
 *
 * Влияет на маржинальность, цепочку коммуникаций и юридическое оформление,
 * поэтому хранится отдельно от статуса воронки.
 */
export type ClientKind = 'direct' | 'intermediary';

export interface LegalEntity {
  id: UUID;
  name: string;
  inn: string;
}

export interface Client {
  id: UUID;
  name: string;
  legalEntities: LegalEntity[];
  industry: string;
  /** null = ответственного «отвязали» (например, удалили пользователя). */
  accountManagerId: UUID | null;
  status: ClientStatus;
  /** Прямой клиент или посредник. */
  clientKind: ClientKind;
  /** Ссылка или @username общего Telegram-чата с клиентом */
  telegramChat?: string;
  vacanciesCount: number;
  contactsCount: number;
}

export interface Contact {
  id: UUID;
  clientId: UUID;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  telegram?: string;
  /** ISO date YYYY-MM-DD */
  birthday?: string;
}

export interface CreateContactRequest {
  name: string;
  role: string;
  email?: string;
  phone?: string;
  telegram?: string;
  /** ISO date YYYY-MM-DD */
  birthday?: string;
}

export interface ContactListItem extends Contact {
  clientName: string;
}

// === Engagement type ===
/**
 * Модель работы с кандидатом / форма сделки с клиентом.
 * - 'outstaff'  — аутстафф: «свой» инженер, работающий у клиента на нашем юр.лице.
 * - 'agency'    — кадровое агентство: подбор кандидата, которого нанимает клиент к себе.
 *
 * Это первичная характеристика и вакансии, и кандидата. Кандидата одного типа
 * нельзя привязать к вакансии другого типа (валидация на бэке + UI-фильтр).
 */
export type EngagementType = 'outstaff' | 'agency';

// === Vacancies ===
export type Grade = 'Junior' | 'Middle' | 'Senior' | 'Lead';
export type WorkFormat = 'Удалённо' | 'Гибрид' | 'Офис';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type VacancyStatus =
  | 'new'
  | 'in_work'
  | 'proposed'
  | 'interview'
  | 'waiting_os'
  | 'closed_success'
  | 'closed'
  | 'paused';

export interface Vacancy {
  id: UUID;
  title: string;
  clientId: UUID;
  /** Тип сделки: аутстафф или кадровое агентство. */
  engagementType: EngagementType;
  /** Название проекта у клиента — у одного клиента их может быть несколько. */
  project?: string;
  grade: Grade;
  stack: string[];
  format: WorkFormat;
  /** Ставка клиента в ₽/час. Используется для аутстаффа; для агентских вакансий не применяется. */
  rateClient: number;
  /** Верхняя граница оклада в ₽/мес. Используется только для агентских вакансий, опционально.
   *  null/undefined трактуем одинаково — «не указан». */
  salaryMax?: number | null;
  positions: number;
  status: VacancyStatus;
  priority: Priority;
  /**
   * Аккаунт-менеджер, отвечающий за вакансию.
   * По умолчанию наследуется от клиента, но может быть переопределён вручную.
   * null = ответственного «отвязали» (например, удалили пользователя).
   */
  accountManagerId: UUID | null;
  recruiterIds: UUID[];
  daysInStatus: number;
  candidatesCount: number;
  deadline: string | null;
  kanbanOrder: number;
  /** Свободное описание вакансии: задачи, проект, особенности */
  description?: string;
  /** Требования к кандидату: обязательные и желательные */
  requirements?: string;
}

// === Candidates ===
export type CandidateStatus =
  | 'new'
  | 'recruiter_iv'
  | 'ready'
  | 'presented'
  | 'waiting_os'
  | 'offer'
  | 'rejected_client'
  | 'rejected_candidate'
  | 'hired'
  | 'reserve';

/** Тип оформления кандидата:
 *  - ИП — индивидуальный предприниматель
 *  - СМЗ — самозанятый (НПД)
 *  - ТК РФ — трудовой договор по Трудовому кодексу РФ
 */
export type EmploymentType = 'ИП' | 'СМЗ' | 'ТК РФ';

/**
 * Категория навыков из резюме. Каждый блок («Языки программирования»,
 * «Технологии», «Администрирование» и т.п.) — отдельная категория со
 * своим списком элементов. Это гибче плоского `stack`, который остаётся
 * как сводный список для канбана/поиска.
 */
export interface SkillCategory {
  /** Идентификатор для useFieldArray и стабильных ключей в React. */
  id: string;
  /** Например: «Языки программирования», «Технологии», «DevOps и автоматизация». */
  name: string;
  /** Конкретные навыки/технологии этой категории. */
  items: string[];
}

/**
 * Опыт работы. Даты — в формате YYYY-MM (без числа), так как в резюме
 * указываются месяц и год. endMonth=null означает «по настоящее время».
 */
export interface CandidateExperience {
  id: string;
  company: string;
  position: string;
  /** YYYY-MM */
  startMonth: string;
  /** YYYY-MM или null = «по настоящее время» */
  endMonth: string | null;
  /** Краткое описание проекта/контекста, в котором кандидат работал. */
  project?: string;
  /** Ключевые задачи и достижения — отдельные пункты для буллетов. */
  achievements: string[];
  /** Стек, использовавшийся в этом проекте/месте работы. */
  stack: string[];
}

/** Образование (вуз, ссуз и т.п.). */
export interface CandidateEducation {
  id: string;
  /** Например: «Магистр», «Бакалавр», «Специалист». */
  degree: string;
  /** Учебное заведение. */
  institution: string;
  /** Город учебного заведения, опционально. */
  city?: string;
  /** Год окончания. */
  graduationYear: number;
  /** Факультет / специальность. */
  specialty?: string;
}

/** Курсы, сертификаты, повышения квалификации. */
export interface CandidateCertification {
  id: string;
  /** Название программы или сертификата. */
  title: string;
  /** Кто проводил/выдал (организация). */
  issuer: string;
  /** Свободный период: «2017-2025», «2023», «Январь 2024» — как в резюме. */
  period?: string;
}

/** Уровень владения языком по CEFR + «родной». */
export type LanguageLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'родной';

export interface CandidateLanguage {
  /** Название языка («Русский», «Английский», ...). */
  language: string;
  level: LanguageLevel;
}

export interface Candidate {
  id: UUID;
  fullName: string;
  role: string;
  /** Тип кандидата: аутстафф или агентский. Должен совпадать с типом вакансии при привязке. */
  engagementType: EngagementType;
  grade: Grade;
  experienceYears: number;
  stack: string[];
  /** Ожидаемая ставка кандидата, ₽/мес */
  rateMonth: number;
  employmentType: EmploymentType;
  format: WorkFormat;
  location: string;
  /** null = рекрутера «отвязали» (например, удалили пользователя). */
  recruiterId: UUID | null;
  status: CandidateStatus;
  daysInStatus: number;
  vacancyIds: UUID[];
  telegram?: string;
  phone?: string;
  email?: string;
  /** ISO date YYYY-MM-DD */
  birthday?: string;
  kanbanOrder: number;
  /** Сопроводительное письмо / краткая самопрезентация кандидата. */
  summary?: string;
  /** Категоризованные навыки (как блоки в резюме). */
  skillCategories?: SkillCategory[];
  /** Опыт работы (от свежего к старому). */
  experience?: CandidateExperience[];
  /** Образование. */
  education?: CandidateEducation[];
  /** Курсы / повышение квалификации. */
  certifications?: CandidateCertification[];
  /** Знание языков. */
  languages?: CandidateLanguage[];
  /**
   * Кандидат убран с канбан-доски, но остаётся в общей «Базе кандидатов».
   * Из базы такие кандидаты не пропадают — это служит «архивом» вне доски.
   * Полное удаление из базы — отдельное действие, доступное только админу.
   */
  archived?: boolean;
  /** ISO datetime — момент перевода в архив (убран с доски). */
  archivedAt?: string | null;
  /** Кто убрал кандидата с доски. */
  archivedById?: UUID | null;
  /** Причина архивирования (опционально, заполняется при удалении с доски). */
  archiveReason?: string;
}

// === Matching (vacancy_candidates) ===
export type MatchStatus =
  | 'submitted'
  | 'reviewed'
  | 'interview'
  | 'offered'
  | 'accepted'
  | 'rejected_client'
  | 'rejected_internal';

/** Категория AI-скоринга: strong ≥75 · good 50–74 · weak 25–49 · mismatch <25. */
export type MatchRecommendation = 'strong' | 'good' | 'weak' | 'mismatch';

export interface VacancyCandidate {
  id: UUID;
  vacancyId: UUID;
  candidateId: UUID;
  status: MatchStatus;
  addedById: UUID;
  addedAt: string;
  feedback?: string;
  /** AI-скор 0–100; null/undefined = ещё не считали. */
  aiScore?: number | null;
  aiRecommendation?: MatchRecommendation | null;
  aiScoredAt?: string | null;
  aiModel?: string | null;
}

/** Один критерий разбивки AI-скоринга. */
export interface CriterionScore {
  score: number;
  weight: number;
  note: string;
}

/** Полный результат AI-скоринга связки (разбивка + вердикт). */
export interface MatchScore {
  matchId?: UUID | null;
  vacancyId: UUID;
  candidateId: UUID;
  score: number;
  recommendation: MatchRecommendation;
  /** Ключи: stack, grade, experience, format, rate. */
  breakdown: Record<string, CriterionScore>;
  summary?: string | null;
  strengths: string[];
  gaps: string[];
  model: string;
  scoredAt: string;
  /** Данные кандидата/вакансии изменились с момента расчёта. */
  stale: boolean;
  /** false = LLM был недоступен, показан детерминированный фоллбэк. */
  aiEnriched: boolean;
}

// === Calendar / Interviews ===
export type EventType = 'interview' | 'meeting' | 'reminder';
export type EventLocationKind = 'online' | 'onsite' | 'phone';
export type EventStatus = 'scheduled' | 'held' | 'no_show' | 'canceled';
export type AttendeeResponse = 'invited' | 'accepted' | 'declined';

export interface EventAttendee {
  userId: UUID;
  response: AttendeeResponse;
  name?: string | null;
}

export interface CalendarEvent {
  id: UUID;
  type: EventType;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  allDay: boolean;
  locationKind: EventLocationKind;
  location?: string | null;
  status: EventStatus;
  outcome?: string | null;
  candidateId?: UUID | null;
  vacancyId?: UUID | null;
  matchId?: UUID | null;
  createdById?: UUID | null;
  createdAt: string;
  updatedAt: string;
  attendees: EventAttendee[];
  candidateName?: string | null;
  vacancyTitle?: string | null;
}

export interface CreateEventRequest {
  type?: EventType;
  title?: string;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  locationKind?: EventLocationKind;
  location?: string | null;
  candidateId?: UUID | null;
  vacancyId?: UUID | null;
  matchId?: UUID | null;
  attendeeIds?: UUID[];
}

export interface UpdateEventRequest {
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  allDay?: boolean;
  locationKind?: EventLocationKind;
  location?: string | null;
  attendeeIds?: UUID[];
}

export interface OutcomeRequest {
  status: Extract<EventStatus, 'held' | 'no_show'>;
  outcome?: string;
  nextMatchStatus?: MatchStatus;
}

// === Notifications ===
export interface Notification {
  id: UUID;
  userId: UUID;
  kind: 'mention' | 'status_change' | 'system';
  text: string;
  entityType?: 'vacancy' | 'candidate' | 'client' | 'contact';
  entityId?: UUID;
  read: boolean;
  createdAt: string;
}

// === Comments ===
export type CommentEntityType = 'contact' | 'candidate' | 'vacancy' | 'client';

export interface Comment {
  id: UUID;
  entityType: CommentEntityType;
  entityId: UUID;
  /** null = автор удалён. */
  authorId: UUID | null;
  /** id родительского комментария — для ответов в нити */
  parentId: UUID | null;
  text: string;
  /** id упомянутых через @ пользователей */
  mentions: UUID[];
  createdAt: string;
  /** Заполняется при редактировании комментария */
  updatedAt: string | null;
}

export interface CreateCommentRequest {
  entityType: CommentEntityType;
  entityId: UUID;
  text: string;
  parentId?: UUID | null;
  mentions?: UUID[];
}

export interface UpdateCommentRequest {
  text: string;
  mentions?: UUID[];
}

// === Audit / Activity ===
export interface ActivityEntry {
  id: UUID;
  entityType: 'vacancy' | 'candidate' | 'client';
  entityId: UUID;
  /** null = актёр удалён. */
  actorId: UUID | null;
  kind: 'create' | 'status' | 'note' | 'call' | 'email';
  text: string;
  createdAt: string;
}

export interface AuditEntry {
  id: UUID;
  entityType: string;
  entityId: UUID;
  /** null = актёр удалён. */
  actorId: UUID | null;
  field: string;
  before: string | null;
  after: string | null;
  createdAt: string;
}

// === Pagination ===
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// === Auth ===
export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
}

// === Chat ===
export type ChatConversationKind = 'dm' | 'group';

export interface ChatConversation {
  id: UUID;
  kind: ChatConversationKind;
  title: string | null;
  createdBy: UUID | null;
  createdAt: string;
  lastMessageAt: string | null;
  memberIds: UUID[];
  /** Read-state именно текущего пользователя — у других в DTO не отдаётся. */
  myLastReadMessageId: UUID | null;
  myLastReadAt: string | null;
  /** Этап 6: персональные mute/archive. */
  myMutedUntil: string | null;
  myHiddenAt: string | null;
}

export interface ChatMuteRequest {
  until: string | null;
}

export interface CreateDmRequest {
  peerUserId: UUID;
}

export interface ChatReactionGroup {
  emoji: string;
  count: number;
  userIds: UUID[];
  mineReacted: boolean;
}

export interface ChatMessage {
  id: UUID;
  conversationId: UUID;
  /** null = автор удалён. */
  authorUserId: UUID | null;
  /** NULL — корневое сообщение; задано — ответ в треде (треды глубиной 1). */
  parentMessageId: UUID | null;
  /** Для удалённого сообщения text='', mentions=[], reactions=[], attachments=[]; смотрите deletedAt. */
  text: string;
  /** UUID юзеров, упомянутых через токен `<@uuid>` в тексте. */
  mentions: UUID[];
  /** Эмодзи-реакции, сгруппированные по emoji. */
  reactions: ChatReactionGroup[];
  /** Файлы-вложения, прикреплённые к сообщению. */
  attachments: FileResponse[];
  /** Число ответов в треде (только для корневых сообщений, иначе 0). */
  replyCount: number;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface CreateChatMessageRequest {
  text: string;
  /** Если задано — это ответ в тред. Корневое сообщение того же диалога. */
  parentMessageId?: UUID | null;
  /** ID файлов, уже подтверждённых через /files/confirm с entity_type=chat_message. */
  fileIds?: UUID[];
}

export interface UpdateChatMessageRequest {
  text: string;
}

export interface MarkChatReadRequest {
  lastReadMessageId: UUID;
}

export interface CreateChatGroupRequest {
  title: string;
  memberIds: UUID[];
}

export interface RenameChatGroupRequest {
  title: string;
}

export interface AddChatMembersRequest {
  userIds: UUID[];
}

export interface ToggleChatReactionRequest {
  emoji: string;
}

export interface ChatMessagesPage {
  items: ChatMessage[];
  /** ISO created_at самого старого сообщения в странице — передавайте его
   *  как `before` для следующей. null = больше нет. */
  nextCursor: string | null;
}

export interface ChatSearchHit {
  conversationId: UUID;
  message: ChatMessage;
  /** HTML-фрагмент с <mark>...</mark> — безопасно рендерить через
   *  dangerouslySetInnerHTML (ts_headline экранирует всё, кроме своих тегов). */
  snippet: string;
  rank: number;
}

export interface ChatSearchResponse {
  query: string;
  items: ChatSearchHit[];
}
