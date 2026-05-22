/**
 * Парсер текста резюме hh.ru → Partial<CandidateFormValues>.
 *
 * Используется в кнопке «Распознать из файла» формы кандидата. Принимает
 * сырой текст, выгруженный из PDF через pdfjs (см. extractPdfText), и
 * возвращает максимум из того, что удалось распознать. Отсутствующие поля
 * не заполняются — рекрутер докрутит руками.
 *
 * Парсер заточен под формат HH (русскоязычные секции «Желаемая должность
 * и зарплата», «Опыт работы», «Образование», «Навыки» и т.д.), но устойчив
 * к мелким отклонениям: лишним пробелам, переносам слов, чередованию
 * двух колонок (период / содержание).
 */
import type { CandidateFormValues } from '../CandidateForm';
import type { LanguageLevel, WorkFormat } from '@/api/types';

// ────────────────────────────────────────────────────────────────────────────
// Вспомогательные константы
// ────────────────────────────────────────────────────────────────────────────

const RU_MONTHS: Record<string, number> = {
  январь: 1, января: 1,
  февраль: 2, февраля: 2,
  март: 3, марта: 3,
  апрель: 4, апреля: 4,
  май: 5, мая: 5,
  июнь: 6, июня: 6,
  июль: 7, июля: 7,
  август: 8, августа: 8,
  сентябрь: 9, сентября: 9,
  октябрь: 10, октября: 10,
  ноябрь: 11, ноября: 11,
  декабрь: 12, декабря: 12,
};

const EN_MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/** Заголовки секций, по которым режем резюме. Регистр и пробелы свободные. */
const SECTION_PATTERNS = {
  desired: /(Желаемая\s+должность\s+и\s+зарплата|Desired\s+position\s+and\s+salary)/i,
  experience: /(Опыт\s+работы(?:\s+[—–-].*)?|Work\s+experience(?:\s+[—–-].*)?)/i,
  education: /^(Образование(?:\s+.*)?|Education(?:\s+.*)?)$/i,
  skills: /^(Навыки(?:\s+.*)?|Key\s+skills(?:\s+.*)?|Skills(?:\s+.*)?)$/i,
  extra: /(Дополнительная\s+информация|Additional\s+information)/i,
  comments: /(Комментарии\s+к\s+резюме|Comments\s+to\s+resume|Resume\s+comments)/i,
  driving: /(Опыт\s+вождения|Driving\s+experience)/i,
  about: /^Обо\s+мне(?:\s+.*)?$/i,
};

const FORMAT_BY_TEXT: Array<{ re: RegExp; value: WorkFormat }> = [
  { re: /удал[её]нн/i, value: 'Удалённо' },
  { re: /гибрид/i, value: 'Гибрид' },
  { re: /офис/i, value: 'Офис' },
  { re: /\bremote\b/i, value: 'Удалённо' },
  { re: /\bhybrid\b/i, value: 'Гибрид' },
  { re: /(office|employer'?s location|on[- ]site|onsite)/i, value: 'Офис' },
];

const LANGUAGE_LEVEL_BY_TEXT: Array<{ re: RegExp; value: LanguageLevel }> = [
  { re: /родн/i, value: 'родной' },
  { re: /\bC2\b/i, value: 'C2' },
  { re: /\bC1\b/i, value: 'C1' },
  { re: /\bB2\b/i, value: 'B2' },
  { re: /\bB1\b/i, value: 'B1' },
  { re: /\bA2\b/i, value: 'A2' },
  { re: /\bA1\b/i, value: 'A1' },
];

// ────────────────────────────────────────────────────────────────────────────
// Утилиты
// ────────────────────────────────────────────────────────────────────────────

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** «17 июля 1991» → «1991-07-17» (или null). */
function parseRuFullDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([А-Яа-яЁё]+)\s+(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = RU_MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** "24 March 1998" -> "1998-03-24" (or null). */
function parseEnFullDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = EN_MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** «Ноябрь 2025» / "March 2025" → «2025-11/03» (или null). */
function parseMonthYear(s: string): string | null {
  const m = s.match(/([A-Za-zА-Яа-яЁё.]+)\s+(\d{4})/);
  if (!m) return null;
  const token = m[1].toLowerCase().replace(/\.$/, '');
  const month = RU_MONTHS[token] ?? EN_MONTHS[token];
  if (!month) return null;
  return `${m[2]}-${pad2(month)}`;
}

/** Чистит строку: нормализует nbsp/zwsp в обычный пробел, обрезает края. */
function clean(s: string): string {
  return s.replace(/[\u00A0\u200B]/g, ' ').replace(/[\t ]+/g, (m) => m).trim();
}

/** Полный схлоп пробелов — для значений (телефон, локация и т.п.). */
function compact(s: string): string {
  return s.replace(/[\u00A0\u200B]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isUrlLine(s: string): boolean {
  // Покрывает варианты HH: «www.foo.ru/», «Уфа, www.uralsib.ru», «syst-int.com», «foo.ru/».
  if (/(?:^|[\s,])(?:https?:\/\/|www\.)\S+/i.test(s)) return true;
  if (/(?:^|[\s,])[a-z][\w-]*\.(ru|com|net|org|io|tech)\b/i.test(s)) return true;
  return false;
}

function isBulletLine(s: string): boolean {
  return /^[•·●○●▪◦]/.test(s.trim());
}

/** Футер страницы HH-резюме повторяется на каждой странице — выбрасываем. */
function isFooterLine(s: string): boolean {
  return (
    /^Резюме\s+обновлено\s+\d{1,2}\s+[А-Яа-яЁё]+\s+\d{4}/i.test(s)
    || /^Resume\s+updated\s+\d{1,2}\s+[A-Za-z]+\s+\d{4}/i.test(s)
  );
}

/** Возвращает индекс первой строки, удовлетворяющей предикату, начиная с `from`. */
function findLineIndex(lines: string[], predicate: RegExp | ((s: string) => boolean), from = 0): number {
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (typeof predicate === 'function' ? predicate(line) : predicate.test(line)) {
      return i;
    }
  }
  return -1;
}

// ────────────────────────────────────────────────────────────────────────────
// Основной API
// ────────────────────────────────────────────────────────────────────────────

export interface ParseResult {
  values: Partial<CandidateFormValues>;
  /** Краткий список того, что распозналось — для тоста. */
  filledFields: string[];
}

export function parseResumeText(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map(clean)
    .filter((s) => s.length > 0)
    .filter((s) => !isFooterLine(s));

  const out: Partial<CandidateFormValues> = {};
  const filled: string[] = [];
  const fill = <K extends keyof CandidateFormValues>(
    key: K,
    value: CandidateFormValues[K] | undefined,
    label: string,
  ) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && !value) return;
    if (Array.isArray(value) && value.length === 0) return;
    // ФИО не перезаписываем: сначала пытаемся взять из шапки резюме, и это
    // приоритетнее однофамильцев/рекрутеров в блоке «Комментарии».
    if (key === 'fullName') {
      const existing = (out as Record<string, unknown>).fullName;
      if (typeof existing === 'string' && existing.trim().length > 0) return;
    }
    (out as Record<string, unknown>)[key as string] = value;
    filled.push(label);
  };

  // 1. Шапка резюме: телефон, email, локация, дата рождения.
  parseHeader(lines, fill);

  // 2. Желаемая должность и зарплата.
  parseDesiredPosition(lines, fill);

  // 3. Опыт работы (стаж + перечень мест).
  parseExperience(lines, fill);

  // 4. Образование.
  parseEducation(lines, fill);

  // 5. Навыки и языки.
  parseSkillsAndLanguages(lines, fill);

  // 6. «Обо мне» → summary.
  parseSummary(lines, fill);

  // 7. ФИО — иногда лежит только в комментариях рекрутера.
  parseFullNameFromComments(lines, fill);

  return { values: out, filledFields: filled };
}

// ────────────────────────────────────────────────────────────────────────────
// Шапка
// ────────────────────────────────────────────────────────────────────────────

function parseHeader(
  lines: string[],
  fill: <K extends keyof CandidateFormValues>(
    key: K,
    v: CandidateFormValues[K] | undefined,
    label: string,
  ) => void,
): void {
  for (const line of lines.slice(0, 30)) {
    // ФИО в верхней части HH-резюме обычно отдельной строкой.
    const fullName = line.match(/^([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,2})$/);
    if (fullName) {
      fill('fullName', compact(fullName[1]), 'ФИО');
    }

    // Дата рождения: «Мужчина, 34 года, родился 17 июля 1991».
    const birth = line.match(/род(?:ился|илась)\s+(\d{1,2}\s+[А-Яа-яЁё]+\s+\d{4})/i);
    if (birth) {
      const iso = parseRuFullDate(birth[1]);
      if (iso) fill('birthday', iso, 'дата рождения');
    }
    const birthEn = line.match(/born\s+on\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
    if (birthEn) {
      const iso = parseEnFullDate(birthEn[1]);
      if (iso) fill('birthday', iso, 'дата рождения');
    }

    // Email — самый надёжный якорь.
    const email = line.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
    if (email) fill('email', email[0], 'email');

    // Телефон — в формате HH «+7 (999) 1234567» либо более свободно.
    const phone = line.match(/\+?\d[\d\s()-]{8,}\d/);
    if (phone && !email) fill('phone', compact(phone[0]), 'телефон');
    // если email и phone в разных строках — отдельная ветка выше уже отработала

    // Локация. HH иногда добавляет пробел перед двоеточием: «Проживает : Уфа».
    const loc = line.match(/^Проживает\s*:\s*(.+)$/i);
    if (loc) fill('location', compact(loc[1]), 'локация');
    const locEn = line.match(/^Reside\s+in\s*:\s*(.+)$/i);
    if (locEn) fill('location', compact(locEn[1]), 'локация');
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Желаемая должность / зарплата / формат
// ────────────────────────────────────────────────────────────────────────────

function parseDesiredPosition(
  lines: string[],
  fill: <K extends keyof CandidateFormValues>(
    key: K,
    v: CandidateFormValues[K] | undefined,
    label: string,
  ) => void,
): void {
  const start = findLineIndex(lines, SECTION_PATTERNS.desired);
  if (start === -1) return;

  // Конец секции — заголовок «Опыт работы».
  const end = findLineIndex(lines, SECTION_PATTERNS.experience, start + 1);
  const slice = lines.slice(start + 1, end === -1 ? Math.min(lines.length, start + 40) : end);

  // Первая «осмысленная» строка после заголовка — желаемая должность.
  for (const line of slice) {
    if (/Специализации:|Specializations:/i.test(line)) break;
    if (/^[\d\s][\d\s ₽р]*на руки|на руки/i.test(line)) continue;
    if (/^Desired\s+travel\s+time\s+to\s+work:/i.test(line)) continue;
    if (!/[A-Za-zА-Яа-яЁё]/.test(line)) continue;
    fill('role', compact(line), 'желаемая должность');
    break;
  }

  // Зарплата: «400 000 ₽ на руки» или просто «400000».
  for (const line of slice) {
    const m = line.match(/(\d[\d\s\u00A0]*)\s*₽/);
    if (m) {
      const value = Number(m[1].replace(/[\s\u00A0]/g, ''));
      if (!Number.isNaN(value) && value > 0) fill('rateMonth', value, 'желаемая ставка');
      break;
    }
    const usd = line.match(/(\d[\d\s\u00A0]*)\s*(\$|USD)\b/i);
    if (usd) {
      const value = Number(usd[1].replace(/[\s\u00A0]/g, ''));
      if (!Number.isNaN(value) && value > 0) fill('rateMonth', value, 'желаемая ставка');
      break;
    }
  }

  // Формат работы. HH иногда: «Формат работы : удалённо» (пробел перед `:`).
  for (const line of slice) {
    const m = line.match(/(?:Формат\s+работы|Work\s+format)\s*:\s*(.+)$/i);
    if (!m) continue;
    for (const f of FORMAT_BY_TEXT) {
      if (f.re.test(m[1])) {
        fill('format', f.value, 'формат работы');
        break;
      }
    }
    break;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Опыт работы
// ────────────────────────────────────────────────────────────────────────────

/**
 * Признак, что строка — начало блока опыта.
 * Принимает «Ноябрь 2025 —», «Июль 2022 —», «Май 2022 —» и т.п.
 * (с дефисом или длинным тире, end-month опционален и может уйти на следующую строку).
 */
function isExperiencePeriodStart(line: string): boolean {
  return /^[A-Za-zА-Яа-яЁё]+\s+\d{4}\s+[—–-]/.test(line);
}

function parseExperience(
  lines: string[],
  fill: <K extends keyof CandidateFormValues>(
    key: K,
    v: CandidateFormValues[K] | undefined,
    label: string,
  ) => void,
): void {
  const start = findLineIndex(lines, SECTION_PATTERNS.experience);
  if (start === -1) return;

  // experienceYears — из заголовка «Опыт работы — 13 лет 11 месяцев».
  const headerMatch = lines[start].match(/Опыт\s+работы\s+—\s+(\d+)\s+лет/i)
    ?? lines[start].match(/Опыт\s+работы\s+—\s+(\d+)\s+год/i);
  const headerMatchEn = lines[start].match(/Work\s+experience\s+—\s+(\d+)\s+years?/i);
  if (headerMatch) {
    fill('experienceYears', Number(headerMatch[1]), 'опыт, лет');
  } else if (headerMatchEn) {
    fill('experienceYears', Number(headerMatchEn[1]), 'опыт, лет');
  }

  const endSection = (() => {
    const candidates = [
      findLineIndex(lines, SECTION_PATTERNS.education, start + 1),
      findLineIndex(lines, SECTION_PATTERNS.skills, start + 1),
      findLineIndex(lines, SECTION_PATTERNS.extra, start + 1),
      findLineIndex(lines, SECTION_PATTERNS.comments, start + 1),
    ].filter((i) => i > 0);
    return candidates.length ? Math.min(...candidates) : lines.length;
  })();

  // Находим индексы начала каждого блока опыта.
  const blockStarts: number[] = [];
  for (let i = start + 1; i < endSection; i += 1) {
    if (isExperiencePeriodStart(lines[i])) blockStarts.push(i);
  }
  if (blockStarts.length === 0) return;

  const experience: CandidateFormValues['experience'] = [];
  for (let bi = 0; bi < blockStarts.length; bi += 1) {
    const from = blockStarts[bi];
    const to = bi + 1 < blockStarts.length ? blockStarts[bi + 1] : endSection;
    const block = lines.slice(from, to);
    const parsed = parseExperienceBlock(block);
    if (parsed) experience.push(parsed);
  }

  if (experience.length) fill('experience', experience, `опыт работы (${experience.length})`);
}

/** Парсинг одного блока опыта. */
function parseExperienceBlock(block: string[]): CandidateFormValues['experience'][number] | null {
  if (block.length === 0) return null;
  let idx = 0;

  // Период: «Ноябрь 2025 —» (+ возможно «настоящее время» или «Март 2024» на следующей строке).
  const periodLine = block[idx++];
  const periodMatch = periodLine.match(
    /^([A-Za-zА-Яа-яЁё]+\s+\d{4})\s+[—–-]\s*(.+)?$/,
  );
  let startMonth = '';
  let endMonth: string | '' = '';
  if (periodMatch) {
    startMonth = parseMonthYear(periodMatch[1]) ?? '';
    const rest = (periodMatch[2] ?? '').trim();
    if (rest) {
      endMonth = parseMonthYear(rest) ?? '';
    } else if (idx < block.length) {
      // Окончание уехало на следующую строку.
      const next = block[idx];
      if (/настоящее\s+время|till\s+now|present/i.test(next)) {
        endMonth = '';
        idx += 1;
      } else if (parseMonthYear(next)) {
        endMonth = parseMonthYear(next) ?? '';
        idx += 1;
      }
    }
  }

  // Иногда «X лет Y месяцев» идёт отдельной строкой — пропускаем. HH иногда
  // переносит «месяцев» отдельно («2 года 11» + «месяцев»), это тоже фильтруем.
  if (
    idx < block.length
    && /^\d+\s+(год|года|лет|месяц|месяца|месяцев|year|years|month|months)/i.test(block[idx])
  ) {
    idx += 1;
    if (idx < block.length && /^(месяц|месяца|месяцев|month|months)$/i.test(block[idx])) idx += 1;
  }

  // Компания — первая нетривиальная строка после периода.
  let companyRaw = '';
  while (idx < block.length && !companyRaw) {
    const line = block[idx++];
    if (!line) continue;
    if (isUrlLine(line)) continue;
    if (/^\d+\s+(год|года|лет|месяц|месяца|месяцев|year|years|month|months)/i.test(line)) continue;
    if (/^(месяц|месяца|месяцев|month|months)$/i.test(line)) continue;
    companyRaw = line;
  }

  // Дальше идут: URL компании, «Финансовый сектор / Информационные технологии…»,
  // буллеты подсекторов («• Банк», «• ИТ-консалтинг»), а также строки-продолжения
  // подсекторов, начинающиеся со строчной буквы. Всё это пропускаем.
  while (idx < block.length) {
    const line = block[idx];
    if (isUrlLine(line)) { idx += 1; continue; }
    if (isBulletLine(line)) { idx += 1; continue; }
    if (/^(Финансовый\s+сектор|Информационные\s+технологии|Нефть\s+и\s+газ|Промышленное\s+оборудование|Розничная\s+торговля|Услуги\s+для\s+бизнеса|Financial\s+Sector|IT,\s*System\s+Integration,\s*Internet|Retail)/i.test(line)) {
      idx += 1;
      continue;
    }
    // Перенос буллета: HH переносит длинный пункт сектора без префикса «•».
    // Признак — строка с маленькой буквы или с цифры/скобки в начале.
    if (/^[а-яёa-z(]/.test(line)) { idx += 1; continue; }
    break;
  }

  // Должность — следующая строка.
  let positionRaw = '';
  if (idx < block.length) {
    positionRaw = block[idx++];
  }

  // Стек, ачивменты — собираем оставшиеся строки.
  const achievementLines: string[] = [];
  let stackText = '';
  while (idx < block.length) {
    const line = block[idx++];
    const stackMatch = line.match(/^Стек[:\s]+(.+)$/i);
    if (stackMatch) {
      stackText = stackMatch[1];
      continue;
    }
    achievementLines.push(line);
  }

  // Нормализация ачивментов: схлопываем пустые префиксы «-», «·», «•».
  const achievementsText = achievementLines
    .map((l) => l.replace(/^[-·•●▪]\s*/, '').trim())
    .filter((l) => l.length > 0)
    .join('\n');

  const company = compact(companyRaw);
  const position = compact(positionRaw);
  if (!company && !position) return null;

  return {
    id: uid('exp'),
    company,
    position,
    startMonth,
    endMonth,
    project: '',
    achievementsText: achievementsText.split('\n').map(compact).join('\n'),
    stackText: compact(stackText),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Образование
// ────────────────────────────────────────────────────────────────────────────

function parseEducation(
  lines: string[],
  fill: <K extends keyof CandidateFormValues>(
    key: K,
    v: CandidateFormValues[K] | undefined,
    label: string,
  ) => void,
): void {
  const start = findLineIndex(lines, SECTION_PATTERNS.education);
  if (start === -1) return;
  const endCandidates = [
    findLineIndex(lines, SECTION_PATTERNS.skills, start + 1),
    findLineIndex(lines, SECTION_PATTERNS.extra, start + 1),
    findLineIndex(lines, SECTION_PATTERNS.driving, start + 1),
    findLineIndex(lines, SECTION_PATTERNS.comments, start + 1),
  ].filter((i) => i > 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : lines.length;
  const slice = lines.slice(start + 1, end);

  // Структура HH: «Высшее» (заголовок уровня) → «2014» → «Высшее» → «<вуз>» → «<факультет>».
  // Пропускаем строку «Высшее» как маркер раздела.
  const items: CandidateFormValues['education'] = [];
  let i = 0;
  while (i < slice.length) {
    const line = slice[i];
    // Год окончания — 4 цифры.
    const yearMatch = line.match(/^(19|20)\d{2}$/);
    if (!yearMatch) { i += 1; continue; }
    const year = Number(line);

    // Следующая строка — степень/уровень («Высшее», «Магистр», «Бакалавр»…).
    const degree = slice[i + 1] && /^[А-ЯЁ][А-Яа-яЁёA-Za-z ./-]*$/.test(slice[i + 1])
      ? slice[i + 1]
      : 'Высшее';

    // Дальше — название учебного заведения. Может занимать 1-2 строки.
    let institution = '';
    let specialty = '';
    let city = '';

    let k = i + 2;
    if (k < slice.length) {
      institution = slice[k];
      k += 1;
      // HH переносит длинное название вуза на 2-3 строки. Склеиваем, пока
      // следующая строка не содержит запятой (это уже факультет/специальность),
      // не начинается с заглавной + новой темы, и пока не упёрлись в год нового блока.
      while (k < slice.length && !/^(19|20)\d{2}$/.test(slice[k])) {
        const next = slice[k];
        // Признак «факультета»: содержит «Факультет», или начинается с заглавной
        // и предыдущая строка не заканчивается на запятую и не заканчивается на «технический»/прилагательное.
        const isFaculty = /Факультет|факультет/.test(next);
        const looksLikeContinuation = institution.endsWith(',')
          || /(?:ский|ский,|ный|ная|ная,)$/i.test(institution)
          || /^[а-яё]/.test(next);
        if (isFaculty) break;
        if (!looksLikeContinuation) break;
        institution += ` ${next}`;
        k += 1;
      }
    }
    // Если в названии есть «, <Город>» — выделим город.
    const cityMatch = institution.match(/,\s*([А-ЯЁ][а-яё-]+)$/);
    if (cityMatch) {
      city = cityMatch[1];
      institution = institution.slice(0, institution.length - cityMatch[0].length);
    }

    // Следующая строка — факультет/специальность (если не год нового блока).
    if (k < slice.length && !/^(19|20)\d{2}$/.test(slice[k])) {
      specialty = slice[k];
      k += 1;
    }

    items.push({
      id: uid('edu'),
      degree: compact(degree),
      institution: compact(institution),
      city: compact(city),
      graduationYear: year,
      specialty: compact(specialty),
    });
    i = k;
  }

  if (items.length) fill('education', items, `образование (${items.length})`);
}

// ────────────────────────────────────────────────────────────────────────────
// Навыки и языки
// ────────────────────────────────────────────────────────────────────────────

function parseSkillsAndLanguages(
  lines: string[],
  fill: <K extends keyof CandidateFormValues>(
    key: K,
    v: CandidateFormValues[K] | undefined,
    label: string,
  ) => void,
): void {
  const start = findLineIndex(lines, SECTION_PATTERNS.skills);
  if (start === -1) return;
  const endCandidates = [
    findLineIndex(lines, SECTION_PATTERNS.extra, start + 1),
    findLineIndex(lines, SECTION_PATTERNS.driving, start + 1),
    findLineIndex(lines, SECTION_PATTERNS.comments, start + 1),
  ].filter((i) => i > 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : lines.length;
  const slice = lines.slice(start + 1, end);

  // Языки: блок начинается со строки «Знание языков», далее по строке на язык.
  const languages: CandidateFormValues['languages'] = [];
  const langsIdx = slice.findIndex((s) => /Знание\s+языков|Languages/i.test(s));
  if (langsIdx !== -1) {
    let j = langsIdx;
    // На той же строке может быть и первый язык: «Знание языков Русский — Родной».
    const inlineLang = slice[j].replace(/Знание\s+языков|Languages/i, '').trim();
    if (inlineLang) {
      const lang = parseLanguageLine(inlineLang);
      if (lang) languages.push(lang);
    }
    j += 1;
    while (j < slice.length) {
      const line = slice[j];
      // Прекращаем, как только нарвались на заголовок «Навыки» (внутренний) или
      // на строку, не похожую на язык.
      if (/^(Навыки|Key\s+skills|Skills)$/i.test(line)) break;
      const lang = parseLanguageLine(line);
      if (!lang) break;
      languages.push(lang);
      j += 1;
    }
  }
  if (languages.length) fill('languages', languages, `языки (${languages.length})`);

  // Технические навыки — всё, что после «Навыки» (или после языков). Это плоский
  // список тегов; в форму уходят и как summary stack, и как первая SkillCategory.
  const skillsStartLocal = slice.findIndex((s) => /^Навыки$/i.test(s));
  const normalizedSkillsStartLocal = skillsStartLocal === -1
    ? slice.findIndex((s) => /^(Key\s+skills|Skills)$/i.test(s))
    : skillsStartLocal;
  const skillsLines = normalizedSkillsStartLocal !== -1
    ? slice.slice(normalizedSkillsStartLocal + 1)
    : (() => {
      // Если внутренний подзаголовок «Навыки» отсутствует, берём всё после языков.
      const afterLangs = languages.length > 0 ? slice.slice(langsIdx + 1 + languages.length) : slice;
      return afterLangs.filter((l) => !/Знание\s+языков|Languages/i.test(l));
    })();

  // Чистим от строк «Опыт вождения», прав и т.п.
  // В HH-PDF каждая «таблеточка» навыка лежит на отдельной строке. Поэтому
  // строка — это тег. Дополнительно режем по знакам • и ;, а длинные строки
  // дробим по запятым (на случай, если HH прислал плоской строкой).
  const skillTags = dedupe(
    skillsLines
      // Срезаем «Навыки» в начале первой строки — HH склеивает лейбл с первым рядом.
      .map((l) => l.replace(/^(Навыки|Key\s+skills|Skills)\s{2,}/i, ''))
      .filter((l) => !/Опыт\s+вождения/i.test(l))
      .filter((l) => !/^(Имеется\s+собственный|Права\s+категории)/i.test(l))
      .flatMap((l) => l.split(/\s*[•;]\s*/))
      // Между тегами в HH PDF — 2+ пробелов; внутри тега (например, «SQL Server») один.
      .flatMap((l) => l.split(/\s{2,}/))
      // Если HH прислал плоской CSV-строкой — режем по запятым.
      .flatMap((l) => (l.length > 80 ? l.split(/\s*,\s*/) : [l]))
      .map(compact)
      .filter(Boolean),
  ).slice(0, 60);

  if (skillTags.length) {
    fill('stack', skillTags.join(', '), 'сводный стек');
    fill(
      'skillCategories',
      [{ id: uid('sc'), name: 'Ключевые навыки', itemsText: skillTags.join(', ') }],
      'ключевые навыки',
    );
  }
}

function parseLanguageLine(line: string): CandidateFormValues['languages'][number] | null {
  // «Русский — Родной», «Английский — B2 — Средне-продвинутый».
  const m = line.match(/^([А-ЯЁA-Z][А-Яа-яЁёA-Za-z-]+)\s*(?:[—–-]|:)\s*(.+)$/);
  if (!m) return null;
  const language = compact(m[1]);
  const rest = m[2].trim();
  for (const lv of LANGUAGE_LEVEL_BY_TEXT) {
    if (lv.re.test(rest)) return { language, level: lv.value };
  }
  return null;
}

function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  return arr.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}

// ────────────────────────────────────────────────────────────────────────────
// «Обо мне» → summary
// ────────────────────────────────────────────────────────────────────────────

function parseSummary(
  lines: string[],
  fill: <K extends keyof CandidateFormValues>(
    key: K,
    v: CandidateFormValues[K] | undefined,
    label: string,
  ) => void,
): void {
  const start = findLineIndex(lines, SECTION_PATTERNS.extra);
  if (start === -1) return;
  const aboutIdx = findLineIndex(lines, SECTION_PATTERNS.about, start + 1);
  const from = aboutIdx === -1 ? start + 1 : aboutIdx + 1;
  const end = findLineIndex(lines, SECTION_PATTERNS.comments, from);
  const slice = lines.slice(from, end === -1 ? lines.length : end);
  const text = slice.map(compact).join('\n').trim();
  if (text) fill('summary', text, 'сопроводительное');
}

// ────────────────────────────────────────────────────────────────────────────
// ФИО из комментариев рекрутера (HH в шапке имя скрывает)
// ────────────────────────────────────────────────────────────────────────────

function parseFullNameFromComments(
  lines: string[],
  fill: <K extends keyof CandidateFormValues>(
    key: K,
    v: CandidateFormValues[K] | undefined,
    label: string,
  ) => void,
): void {
  const start = findLineIndex(lines, SECTION_PATTERNS.comments);
  if (start === -1) return;
  const linesBeforeComments = lines.slice(0, start).map(compact);
  for (let i = start + 1; i < Math.min(lines.length, start + 30); i += 1) {
    const line = lines[i];
    // ФИО: «Балакирев Алексей Владимирович» — три слова с заглавной буквы.
    const m = line.match(/^([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+){1,2})$/);
    if (m) {
      const candidateName = compact(m[1]);
      // В комментариях HH часто встречаются ФИО рекрутеров. Берём имя только
      // если оно уже встречалось в тексте резюме до секции комментариев.
      const seenBeforeComments = linesBeforeComments.some(
        (s) => s === candidateName || s.includes(candidateName),
      );
      if (!seenBeforeComments) continue;
      fill('fullName', candidateName, 'ФИО');
      break;
    }
  }
}
