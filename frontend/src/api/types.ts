// Серверные DTO. В боевой версии этот файл генерируется из OpenAPI (см. README → «Кодогенерация»).
// Пока — ручной зеркальный набор, согласованный с архитектурой §6.

export type UUID = string;

// === Users ===
export type Role = 'admin' | 'account_manager' | 'recruiter' | 'viewer';

export interface User {
  id: UUID;
  email: string;
  fullName: string;
  role: Role;
  initials: string;
  color: string;
  isActive: boolean;
}

export interface CreateUserRequest {
  email: string;
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
}

export interface CreateContactRequest {
  name: string;
  role: string;
  email?: string;
  phone?: string;
}

export interface ContactListItem extends Contact {
  clientName: string;
}

// === Vacancies ===
export type Grade = 'Junior' | 'Middle' | 'Senior' | 'Lead';
export type WorkFormat = 'Удалённо' | 'Гибрид' | 'Офис';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export type VacancyStatus =
  | 'new'
  | 'briefing'
  | 'in_work'
  | 'proposed'
  | 'interview'
  | 'offer'
  | 'closed_success'
  | 'paused';

export interface Vacancy {
  id: UUID;
  title: string;
  clientId: UUID;
  grade: Grade;
  stack: string[];
  format: WorkFormat;
  rateClient: number;
  rateMax: number;
  positions: number;
  status: VacancyStatus;
  priority: Priority;
  recruiterIds: UUID[];
  daysInStatus: number;
  candidatesCount: number;
  deadline: string | null;
}

// === Candidates ===
export type CandidateStatus =
  | 'new'
  | 'screening'
  | 'recruiter_iv'
  | 'ready'
  | 'presented'
  | 'client_iv'
  | 'offer'
  | 'hired'
  | 'reserve';

export interface Candidate {
  id: UUID;
  fullName: string;
  role: string;
  grade: Grade;
  experienceYears: number;
  stack: string[];
  rate: number;
  format: WorkFormat;
  location: string;
  source: string;
  recruiterId: UUID;
  status: CandidateStatus;
  daysInStatus: number;
  vacancyIds: UUID[];
  hot: boolean;
  email?: string;
  phone?: string;
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
  entityType?: 'vacancy' | 'candidate' | 'client';
  entityId?: UUID;
  read: boolean;
  createdAt: string;
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
