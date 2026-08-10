// Тонкий клиент к /screenings/* — раздел «AI-скрининг» (видеоинтервью).
// MSW для этого домена нет (как и для files): фронт всегда ходит в боевой API.

import { api } from './client';
import type { UUID } from './types';

export type ScreeningStatus = 'draft' | 'live' | 'processing' | 'done' | 'error';
export type ScreeningSpeaker = 'recruiter' | 'candidate';
export type ScreeningQuestionSource = 'pregenerated' | 'followup' | 'manual';
export type ScreeningQuestionStatus = 'pending' | 'asked' | 'answered' | 'skipped';
export type ScreeningVerdict = 'fit' | 'partial_fit' | 'no_fit';

export interface ScreeningQuestion {
  id: UUID;
  position: number;
  text: string;
  goal?: string | null;
  source: ScreeningQuestionSource;
  status: ScreeningQuestionStatus;
  answerSummary?: string | null;
}

export interface ScreeningReport {
  id: UUID;
  summary: string;
  verdict: ScreeningVerdict;
  scores?: Record<string, { score: number; note?: string }> | null;
  redFlags?: string[] | null;
  recommendation?: string | null;
  model?: string | null;
  createdAt: string;
}

export interface ScreeningSession {
  id: UUID;
  candidateId: UUID;
  vacancyId?: UUID | null;
  matchId?: UUID | null;
  recruiterId?: UUID | null;
  status: ScreeningStatus;
  telemostUrl?: string | null;
  consentConfirmed: boolean;
  startedAt?: string | null;
  endedAt?: string | null;
  durationSec?: number | null;
  audioFileId?: UUID | null;
  createdAt: string;
  updatedAt: string;
  questions: ScreeningQuestion[];
  candidateName?: string | null;
  vacancyTitle?: string | null;
  recruiterName?: string | null;
  report?: ScreeningReport | null;
}

export interface ScreeningsListParams {
  candidateId?: UUID;
  vacancyId?: UUID;
  recruiterId?: UUID;
  status?: ScreeningStatus;
  page?: number;
  pageSize?: number;
}

export interface ScreeningsListResponse {
  items: ScreeningSession[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateScreeningPayload {
  candidateId: UUID;
  vacancyId?: UUID;
  matchId?: UUID;
  telemostUrl?: string;
  questions?: string[];
}

export const screeningsApi = {
  list: (params: ScreeningsListParams = {}) => {
    const searchParams: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      searchParams[k] = String(v);
    });
    return api.get('screenings', { searchParams }).json<ScreeningsListResponse>();
  },
  byId: (id: UUID) => api.get(`screenings/${id}`).json<ScreeningSession>(),
  create: (payload: CreateScreeningPayload) =>
    api.post('screenings', { json: payload }).json<ScreeningSession>(),
  update: (id: UUID, payload: { telemostUrl?: string; consentConfirmed?: boolean }) =>
    api.patch(`screenings/${id}`, { json: payload }).json<ScreeningSession>(),
  remove: (id: UUID) => api.delete(`screenings/${id}`).json<{ ok: true }>(),
  start: (id: UUID) => api.post(`screenings/${id}/start`).json<ScreeningSession>(),
  finish: (id: UUID, durationSec?: number) =>
    api.post(`screenings/${id}/finish`, { json: { durationSec } }).json<ScreeningSession>(),
  attachAudio: (id: UUID, fileId: UUID) =>
    api.post(`screenings/${id}/audio`, { json: { fileId } }).json<ScreeningSession>(),
  addQuestion: (id: UUID, payload: { text: string; goal?: string; position?: number }) =>
    api.post(`screenings/${id}/questions`, { json: payload }).json<ScreeningSession>(),
  updateQuestion: (
    id: UUID,
    questionId: UUID,
    payload: { text?: string; goal?: string; status?: ScreeningQuestionStatus; position?: number },
  ) =>
    api
      .patch(`screenings/${id}/questions/${questionId}`, { json: payload })
      .json<ScreeningSession>(),
  removeQuestion: (id: UUID, questionId: UUID) =>
    api.delete(`screenings/${id}/questions/${questionId}`).json<ScreeningSession>(),
};
