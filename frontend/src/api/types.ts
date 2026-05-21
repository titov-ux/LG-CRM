// Серверные DTO. В боевой версии этот файл генерируется из OpenAPI (см. README → «Кодогенерация»).
// Пока — ручной зеркальный набор, согласованный с архитектурой §6.

export type UUID = string;

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
  password?: string;
  isActive?: boolean;
}

// === Clients ===
export type ClientStatus = 'lead' | 'in_progress' | 'active' | 'paused' | 'archived';

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
  accountManagerId: UUID;
  status: ClientStatus;
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
   */
  accountManagerId: UUID;
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
  recruiterId: UUID;
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

export interface VacancyCandidate {
  id: UUID;
  vacancyId: UUID;
  candidateId: UUID;
  status: MatchStatus;
  addedById: UUID;
  addedAt: string;
  feedback?: string;
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
  authorId: UUID;
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
  actorId: UUID;
  kind: 'create' | 'status' | 'note' | 'call' | 'email';
  text: string;
  createdAt: string;
}

export interface AuditEntry {
  id: UUID;
  entityType: string;
  entityId: UUID;
  actorId: UUID;
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
