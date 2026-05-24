// Контракт распознавателя резюме — то, что возвращает эндпоинт POST /candidates/parse-resume-text.
// Backend (YandexGPT) возвращает только заполненные поля; всё опционально.
//
// ВНИМАНИЕ: типы вложенных объектов отличаются от `Candidate` тем, что у них
// НЕТ поля `id`. Идентификаторы для useFieldArray генерируются на фронте
// при подстановке в форму (см. CandidateForm.handleResumeFile).

import type { Grade, LanguageLevel, WorkFormat } from '@/api/types';

export interface ParsedSkillCategory {
  name: string;
  items: string[];
}

export interface ParsedExperienceItem {
  company: string;
  position: string;
  /** YYYY-MM */
  startMonth: string;
  /** YYYY-MM или "" = «по настоящее время» */
  endMonth?: string;
  project?: string;
  achievements?: string[];
  stack?: string[];
}

export interface ParsedEducationItem {
  degree: string;
  institution: string;
  city?: string;
  graduationYear: number;
  specialty?: string;
}

export interface ParsedCertificationItem {
  title: string;
  issuer: string;
  period?: string;
}

export interface ParsedLanguageItem {
  language: string;
  level: LanguageLevel;
}

export interface ParsedCandidate {
  fullName?: string;
  role?: string;
  grade?: Grade;
  experienceYears?: number;
  format?: WorkFormat;
  /** Ожидаемая ставка ₽/мес. */
  rateMonth?: number;
  location?: string;
  /** ISO date YYYY-MM-DD */
  birthday?: string;
  telegram?: string;
  phone?: string;
  email?: string;
  /** CSV-список технологий — сводный стек для канбана/поиска. */
  stack?: string;
  /** Текст блока «Обо мне». */
  summary?: string;
  skillCategories?: ParsedSkillCategory[];
  experience?: ParsedExperienceItem[];
  education?: ParsedEducationItem[];
  certifications?: ParsedCertificationItem[];
  languages?: ParsedLanguageItem[];
}
