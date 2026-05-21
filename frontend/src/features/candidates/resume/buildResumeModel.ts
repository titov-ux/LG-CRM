import type { Candidate, CandidateLanguage } from '@/api/types';

/**
 * Резюме строится по жёсткому шаблону (см. ПРОМПТ_Генератор_резюме.md).
 * Правила, которые модель обязана соблюдать ДО рендера в DOCX/PDF:
 *
 * 1. Никаких длинных тире «—». Если в исходных данных где-то остался em-dash —
 *    его нужно заменить на «-», «,» или «:» в соответствующем поле перед
 *    тем как отдать в рендер.
 * 2. Никаких «по настоящее время». Если `endMonth` пустой, подставляем
 *    текущий месяц/год — это «конкретная дата», как требует шаблон.
 * 3. Языки выводятся как «Русский: родной, Английский: B2». Разделитель
 *    язык/уровень — двоеточие, а не тире.
 */

export interface ResumeSkillCategory {
  name: string;
  items: string[];
}

export interface ResumeExperience {
  company: string;
  position: string;
  /** Уже отформатированный период: "Июль 2025 - Февраль 2026". */
  period: string;
  /** Описание проекта (2-3 предложения). Может быть пустым. */
  project: string;
  /** Буллеты «Ключевые задачи и достижения». */
  achievements: string[];
  /** Стек одной строкой через запятую (без точки в конце — добавит рендер). */
  stack: string;
}

export interface ResumeEducation {
  degree: string;
  /** "МИФИ, Москва, 2016" или "МИФИ, 2016", если города нет. */
  institutionLine: string;
  specialty: string;
}

export interface ResumeCertification {
  /** Уже собрана одной строкой: "Название, Организатор, Год". */
  line: string;
}

export interface ResumeLanguagesLine {
  /** Готовая строка с языками: "Русский: родной, Английский: B2". */
  line: string;
}

export interface ResumeModel {
  fullName: string;
  /** Желаемая должность / специализация. */
  position: string;
  location: string;
  /** Дата рождения в формате ДД.ММ.ГГГГ или пустая строка. */
  birthday: string;
  /** Сопроводительное письмо (один абзац). */
  summary: string;
  skillCategories: ResumeSkillCategory[];
  experience: ResumeExperience[];
  education: ResumeEducation[];
  certifications: ResumeCertification[];
  languages: ResumeLanguagesLine | null;
}

const MONTH_NAMES_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

function currentMonthIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
}

function formatMonth(iso: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return iso;
  return `${MONTH_NAMES_RU[month - 1]} ${m[1]}`;
}

/** "Месяц Год - Месяц Год", без «по настоящее время». */
function formatPeriodStrict(start: string, end: string | null | undefined): string {
  const endIso = end && end.trim() ? end : currentMonthIso();
  return `${formatMonth(start)} - ${formatMonth(endIso)}`;
}

/** ISO YYYY-MM-DD → "ДД.ММ.ГГГГ". */
function formatBirthday(iso: string | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** Удаляет длинные тире из строки — рендер не должен их видеть. */
function stripEmDashes(text: string): string {
  // Em-dash, en-dash, horizontal bar — все вариации заменяем на дефис.
  return text.replace(/[—–―]/g, '-');
}

function joinNonEmpty(parts: (string | undefined | null)[], sep: string): string {
  return parts.filter((p): p is string => !!p && !!p.trim()).join(sep);
}

function formatLanguages(languages: CandidateLanguage[] | undefined): ResumeLanguagesLine | null {
  if (!languages || languages.length === 0) return null;
  const parts = languages.map((l) => `${l.language}: ${l.level}`);
  return { line: parts.join(', ') };
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
  return many;
}

/**
 * Считает общий стаж от самой ранней даты начала до самой поздней даты
 * окончания (включая текущее место — для `endMonth=null` берём текущий
 * месяц). Возвращает строку вида «4 года 8 месяцев», с корректным
 * склонением и без округления.
 */
export function calcExperienceLabel(
  experience: { startMonth: string; endMonth: string | null }[],
): string {
  if (!experience || experience.length === 0) return '0 лет';

  let earliest: { y: number; m: number } | null = null;
  let latest: { y: number; m: number } | null = null;

  const now = new Date();
  const nowYM = { y: now.getFullYear(), m: now.getMonth() + 1 };

  for (const e of experience) {
    const ms = /^(\d{4})-(\d{2})$/.exec(e.startMonth);
    if (!ms) continue;
    const start = { y: Number(ms[1]), m: Number(ms[2]) };
    let end: { y: number; m: number };
    if (e.endMonth) {
      const me = /^(\d{4})-(\d{2})$/.exec(e.endMonth);
      end = me ? { y: Number(me[1]), m: Number(me[2]) } : nowYM;
    } else {
      end = nowYM;
    }
    if (!earliest || start.y < earliest.y || (start.y === earliest.y && start.m < earliest.m)) {
      earliest = start;
    }
    if (!latest || end.y > latest.y || (end.y === latest.y && end.m > latest.m)) {
      latest = end;
    }
  }

  if (!earliest || !latest) return '0 лет';

  const totalMonths =
    (latest.y - earliest.y) * 12 + (latest.m - earliest.m);
  if (totalMonths <= 0) return 'менее месяца';

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${pluralRu(years, 'год', 'года', 'лет')}`);
  if (months > 0) parts.push(`${months} ${pluralRu(months, 'месяц', 'месяца', 'месяцев')}`);
  return parts.length > 0 ? parts.join(' ') : 'менее месяца';
}

export function buildResumeModel(candidate: Candidate): ResumeModel {
  const skillCategories: ResumeSkillCategory[] = (candidate.skillCategories ?? [])
    .filter((c) => c.items.length > 0)
    .map((c) => ({
      name: stripEmDashes(c.name),
      items: c.items.map(stripEmDashes),
    }));

  const experience: ResumeExperience[] = (candidate.experience ?? []).map((e) => ({
    company: stripEmDashes(e.company),
    position: stripEmDashes(e.position),
    period: formatPeriodStrict(e.startMonth, e.endMonth),
    project: stripEmDashes(e.project ?? ''),
    achievements: e.achievements.map(stripEmDashes),
    stack: stripEmDashes(e.stack.join(', ')),
  }));

  const education: ResumeEducation[] = (candidate.education ?? []).map((e) => ({
    degree: stripEmDashes(e.degree),
    institutionLine: stripEmDashes(
      joinNonEmpty([e.institution, e.city, String(e.graduationYear)], ', '),
    ),
    specialty: stripEmDashes(e.specialty ?? ''),
  }));

  const certifications: ResumeCertification[] = (candidate.certifications ?? []).map((c) => ({
    line: stripEmDashes(joinNonEmpty([c.title, c.issuer, c.period], ', ')),
  }));

  return {
    fullName: stripEmDashes(candidate.fullName),
    position: stripEmDashes(candidate.role),
    location: stripEmDashes(candidate.location ?? ''),
    birthday: formatBirthday(candidate.birthday),
    summary: stripEmDashes(candidate.summary ?? ''),
    skillCategories,
    experience,
    education,
    certifications,
    languages: formatLanguages(candidate.languages),
  };
}
