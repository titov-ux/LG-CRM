import { api } from './client';
import type {
  Candidate,
  CandidateStatus,
  EmploymentType,
  EngagementType,
  Page,
  UUID,
} from './types';
import type { ParsedCandidate } from '@/features/candidates/resumeImport/types';

export interface CandidatesListParams {
  search?: string;
  status?: CandidateStatus;
  grade?: string;
  recruiterId?: UUID;
  stack?: string;
  engagementType?: EngagementType;
  employmentType?: EmploymentType;
  /**
   * Фильтр по «архивности» кандидата.
   *  - false / undefined — только активные (на канбан-доске);
   *  - true             — только архивные (убраны с доски, но в базе);
   *  - 'all'            — и те и другие (для раздела «База кандидатов»).
   */
  archived?: boolean | 'all';
  page?: number;
  pageSize?: number;
}

export const candidatesApi = {
  list: (params: CandidatesListParams = {}) => {
    // ky плохо сериализует undefined/boolean — приведём к строкам и выкинем пустые.
    const searchParams: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      searchParams[k] = String(v);
    });
    return api.get('candidates', { searchParams }).json<Page<Candidate>>();
  },
  byId: (id: UUID) => api.get(`candidates/${id}`).json<Candidate>(),
  create: (payload: Partial<Candidate>) => api.post('candidates', { json: payload }).json<Candidate>(),
  update: (id: UUID, payload: Partial<Candidate>) =>
    api.patch(`candidates/${id}`, { json: payload }).json<Candidate>(),
  /** Убрать кандидата с канбан-доски (archived=true). В базе остаётся. */
  archive: (id: UUID, reason?: string) =>
    api.post(`candidates/${id}/archive`, { json: { reason } }).json<Candidate>(),
  /** Вернуть архивного кандидата обратно на доску. */
  restore: (id: UUID) => api.post(`candidates/${id}/restore`).json<Candidate>(),
  /** Полное удаление кандидата из базы. Доступно только админу. */
  removePermanent: (id: UUID) =>
    api.delete(`candidates/${id}`, { searchParams: { permanent: 'true' } }).json<{ ok: true }>(),
  /**
   * Старая операция «удалить кандидата». Теперь по умолчанию это «убрать с доски»
   * (мок интерпретирует DELETE без `permanent=true` как архивирование).
   * Оставлено для обратной совместимости со старым кодом.
   */
  remove: (id: UUID) => api.delete(`candidates/${id}`).json<{ ok: true }>(),
  changeStatus: (id: UUID, status: CandidateStatus, comment?: string) =>
    api.patch(`candidates/${id}/status`, { json: { status, comment } }).json<Candidate>(),
  reorderKanban: (updates: { id: UUID; status: CandidateStatus; kanbanOrder: number }[]) =>
    api.put('candidates/kanban-order', { json: { updates } }).json<Candidate[]>(),
  /** AI-распознавание сплошного текста резюме → структурированные поля формы. */
  parseResumeText: (text: string) =>
    api
      .post('candidates/parse-resume-text', { json: { text } })
      .json<{ parsed: ParsedCandidate }>(),
  /**
   * AI-адаптация резюме кандидата под конкретную вакансию.
   * Возвращает только поля, которые AI решил изменить (summary / experienceYears /
   * stack / skillCategories / experience). Поле `experience` приходит ТОЙ ЖЕ длины,
   * что у кандидата — мерджим по индексу, никаких новых компаний быть не должно.
   */
  improveResumeForVacancy: (candidateId: UUID, vacancyId: UUID) =>
    api
      .post(`candidates/${candidateId}/resume/improve`, { json: { vacancyId } })
      .json<{ improvement: ImprovedResume }>(),
};

/**
 * AI-адаптация резюме под вакансию. Все поля опциональны — фронт мерджит
 * непустые значения поверх Candidate перед сборкой ResumeModel → DOCX.
 *
 * `experience[i].project` / `achievements` — патчи к местам работы по индексу.
 * `company`, `position`, `startMonth`, `endMonth`, `stack` AI не трогает —
 * они остаются как у кандидата.
 */
export interface ImprovedExperienceItem {
  project?: string;
  achievements?: string[];
}

export interface ImprovedResume {
  summary?: string;
  experienceYears?: number;
  stack?: string[];
  skillCategories?: { name: string; items: string[] }[];
  experience?: ImprovedExperienceItem[];
}
