/**
 * Адаптер AI-ответа `ParsedCandidate` → `Partial<CandidateFormValues>`.
 *
 * Бэкенд возвращает данные в формате, близком к `Candidate` (массивы строк
 * для achievements/stack/items, без `id` у вложенных объектов). Форма же
 * использует:
 *   • `id` в каждой строке массива (для useFieldArray)
 *   • плоский текст для буллетов / списков тегов (`achievementsText`,
 *     `stackText`, `itemsText`) — они потом парсятся обратно в массивы на сабмите
 *
 * Этот модуль выполняет это преобразование, плюс возвращает `filledFields` —
 * список человекочитаемых меток для тоста «Распознано: ФИО, телефон, ...».
 */
import type { ParsedCandidate } from './types';
import type { CandidateFormValues } from '../CandidateForm';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export interface ParsedToFormResult {
  values: Partial<CandidateFormValues>;
  /** Краткий список того, что распозналось — для тоста. */
  filledFields: string[];
}

/** Преобразовать ответ AI-эндпоинта в значения формы кандидата. */
export function parsedToFormValues(parsed: ParsedCandidate): ParsedToFormResult {
  const out: Partial<CandidateFormValues> = {};
  const filled: string[] = [];

  const add = (label: string) => filled.push(label);

  // ─── Скаляры ───
  if (parsed.fullName) {
    out.fullName = parsed.fullName;
    add('ФИО');
  }
  if (parsed.role) {
    out.role = parsed.role;
    add('желаемая должность');
  }
  if (parsed.grade) {
    out.grade = parsed.grade;
    add('грейд');
  }
  if (typeof parsed.experienceYears === 'number' && parsed.experienceYears > 0) {
    out.experienceYears = parsed.experienceYears;
    add('опыт, лет');
  }
  if (parsed.format) {
    out.format = parsed.format;
    add('формат работы');
  }
  if (typeof parsed.rateMonth === 'number' && parsed.rateMonth > 0) {
    out.rateMonth = parsed.rateMonth;
    add('желаемая ставка');
  }
  if (parsed.location) {
    out.location = parsed.location;
    add('локация');
  }
  if (parsed.birthday) {
    out.birthday = parsed.birthday;
    add('дата рождения');
  }
  if (parsed.telegram) {
    out.telegram = parsed.telegram;
    add('Telegram');
  }
  if (parsed.phone) {
    out.phone = parsed.phone;
    add('телефон');
  }
  if (parsed.email) {
    out.email = parsed.email;
    add('email');
  }
  if (parsed.stack) {
    out.stack = parsed.stack;
    add('сводный стек');
  }
  if (parsed.summary) {
    out.summary = parsed.summary;
    add('сопроводительное');
  }

  // ─── skillCategories: items[] → itemsText ───
  if (parsed.skillCategories?.length) {
    out.skillCategories = parsed.skillCategories.map((c) => ({
      id: uid('sc'),
      name: c.name,
      itemsText: (c.items ?? []).join(', '),
    }));
    add(`категории навыков (${parsed.skillCategories.length})`);
  }

  // ─── experience: achievements[]/stack[] → achievementsText/stackText ───
  if (parsed.experience?.length) {
    out.experience = parsed.experience.map((e) => ({
      id: uid('exp'),
      company: e.company ?? '',
      position: e.position ?? '',
      startMonth: e.startMonth ?? '',
      endMonth: e.endMonth ?? '',
      project: e.project ?? '',
      achievementsText: (e.achievements ?? []).join('\n'),
      stackText: (e.stack ?? []).join(', '),
    }));
    add(`опыт работы (${parsed.experience.length})`);
  }

  // ─── education ───
  if (parsed.education?.length) {
    out.education = parsed.education.map((e) => ({
      id: uid('edu'),
      degree: e.degree ?? 'Высшее',
      institution: e.institution ?? '',
      city: e.city ?? '',
      graduationYear: e.graduationYear,
      specialty: e.specialty ?? '',
    }));
    add(`образование (${parsed.education.length})`);
  }

  // ─── certifications ───
  if (parsed.certifications?.length) {
    out.certifications = parsed.certifications.map((c) => ({
      id: uid('cert'),
      title: c.title ?? '',
      issuer: c.issuer ?? '',
      period: c.period ?? '',
    }));
    add(`сертификаты (${parsed.certifications.length})`);
  }

  // ─── languages (нет id) ───
  if (parsed.languages?.length) {
    out.languages = parsed.languages.map((l) => ({
      language: l.language,
      level: l.level,
    }));
    add(`языки (${parsed.languages.length})`);
  }

  return { values: out, filledFields: filled };
}
