// ============================================================================
// [AI-MOCK] ВРЕМЕННЫЙ РЕГЭКСП-ПАРСЕР БРИФА ВАКАНСИИ
// ----------------------------------------------------------------------------
// Этот файл — заглушка для AI-распознавания, пока не подключена реальная LLM.
// Когда переключаемся на боевой AI-эндпоинт (Anthropic / OpenAI / прокси),
// УДАЛИТЬ ВЕСЬ ЭТОТ ФАЙЛ ЦЕЛИКОМ.
//
// Что ещё нужно почистить при переходе — ищите по grep `[AI-MOCK]`:
//   1) src/mocks/handlers.ts            — мок-обработчик /vacancies/parse-text
//   2) src/features/vacancies/VacancyImportDialog.tsx — fallback на parseVacancyText
//
// Контракт ParsedVacancy вынесен в ./types.ts — он СОХРАНЯЕТСЯ.
// ============================================================================

import type { Grade, Priority, WorkFormat } from '@/api/types';
import type { ParsedVacancy } from './types';

export type { ParsedVacancy };

// ---------- утилиты ----------

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Извлекает сегмент текста под заданным заголовком до следующего известного заголовка или конца. */
function extractSection(text: string, header: RegExp, nextHeaders: RegExp[]): string | undefined {
  const m = text.match(header);
  if (!m || m.index === undefined) return undefined;
  const start = m.index + m[0].length;
  const rest = text.slice(start);
  let end = rest.length;
  for (const h of nextHeaders) {
    const n = rest.match(h);
    if (n && n.index !== undefined && n.index < end) end = n.index;
  }
  const body = rest.slice(0, end).trim();
  return body || undefined;
}

/** Возвращает значение поля «Ключ: значение» в строке, регистронезависимо. */
function fieldValue(text: string, key: RegExp): string | undefined {
  // Оборачиваем key в (?: …), иначе альтернация в key.source поглотит окружающие якоря.
  const re = new RegExp(`^\\s*(?:${key.source})\\s*[:：]\\s*(.+)$`, 'im');
  const m = text.match(re);
  return m && m[1] ? norm(m[1]).replace(/[.,;]\s*$/, '') : undefined;
}

/** Чистит маркеры списков (• - – * 1. 2)) в начале строк и нормализует переносы. */
function cleanBullets(block: string): string {
  return block
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*([•·●▪◦\-–—*]|\d+[.)])\s+/, '— ').trimEnd())
    .filter((line) => line.length > 0)
    .join('\n');
}

// ---------- распознаватели ----------

function detectGrade(value: string | undefined): Grade | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  // приоритет — более старший в диапазонах «Middle+/Senior», «Senior/Lead»
  if (/\blead\b|тимлид|тех\.?лид/.test(v)) return 'Lead';
  if (/\bsenior\b|сеньор|старший/.test(v)) return 'Senior';
  if (/middle\s*\+/.test(v)) return 'Senior'; // Middle+ ближе к Senior
  if (/\bmiddle\b|миддл|средний/.test(v)) return 'Middle';
  if (/\bjunior\b|джун|младший/.test(v)) return 'Junior';
  return undefined;
}

function detectFormat(value: string | undefined): WorkFormat | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (/гибрид|hybrid/.test(v)) return 'Гибрид';
  if (/удал[её]н|remote|дистанц/.test(v)) return 'Удалённо';
  if (/офис|on[- ]?site/.test(v)) return 'Офис';
  // «Любая» — формат не задан, оставляем undefined
  return undefined;
}

function detectPriority(text: string): Priority | undefined {
  const v = text.toLowerCase();
  if (/срочно|asap|urgent|критич/.test(v)) return 'urgent';
  if (/высок.{0,3} приоритет|high priority/.test(v)) return 'high';
  return undefined;
}

/** «8 месяцев», «6 мес.», «1 год», «90 дней», «до конца Q3» → YYYY-MM-DD. */
function detectDeadline(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  const now = new Date();
  const addMonths = (n: number) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + n);
    return d.toISOString().slice(0, 10);
  };
  const addDays = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  let m = v.match(/(\d+)\s*(месяц|мес\.?|month)/);
  if (m) return addMonths(parseInt(m[1], 10));
  m = v.match(/(\d+)\s*(год|года|лет|year)/);
  if (m) return addMonths(parseInt(m[1], 10) * 12);
  m = v.match(/(\d+)\s*(недел|week)/);
  if (m) return addDays(parseInt(m[1], 10) * 7);
  m = v.match(/(\d+)\s*(день|дн|day)/);
  if (m) return addDays(parseInt(m[1], 10));
  // ISO дата
  m = v.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // ДД.ММ.ГГГГ
  m = v.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return undefined;
}

/** «3200», «3 200», «3 200 ₽/час», «от 3500» → number. */
function detectRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (/смотр(им|еть)|предложен|рынок|по\s*договор/.test(v)) return undefined;
  const m = v.replace(/[ \s]/g, '').match(/(\d{3,7})/);
  return m ? parseInt(m[1], 10) : undefined;
}

/** Убирает emoji, variation selectors и ZWJ — они часто стоят как маркеры строки. */
function stripEmoji(s: string): string {
  return s.replace(/[\p{Extended_Pictographic}️‍]/gu, '');
}

/** Похоже ли на «Ключ: значение» — такие строки заголовком быть не могут. */
function looksLikeField(line: string): boolean {
  // короткий ключ из 1–4 слов, потом : или ：
  return /^[\p{L}][\p{L}\s./()+\-]{0,40}[:：]/u.test(line);
}

/** Заголовок: первая «осмысленная» строка из верхушки текста. Чистится от эмодзи, ID, маркеров и хвоста «в …компанию». */
function detectTitle(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const limit = Math.min(lines.length, 10);

  for (let i = 0; i < limit; i++) {
    // Чистим эмодзи и маркеры списков, нормализуем пробелы
    let line = norm(stripEmoji(lines[i] ?? ''));
    if (!line) continue;
    line = line.replace(/^[•·●▪◦\-–—*]+\s*/, '');
    line = line.replace(/^№\s*/i, '');

    if (!line) continue;
    // Чисто цифровая строка — это ID
    if (/^\d[\d\s./\\-]*$/.test(line)) continue;
    // Это поле «Ключ: значение», не заголовок
    if (looksLikeField(line)) continue;
    // Слишком коротко (вряд ли вакансия)
    if (line.length < 3) continue;

    // Префикс «Ищем …»
    line = line.replace(/^\s*(ищем|нужен|требуется|ищется|вакансия)\s*[:：]?\s*/i, '');

    // Хвост « в [компанию]» — это контекст клиента, не название вакансии.
    // Tempered greedy: только последнее « в … компанию», не пересекая других « в ».
    line = line.replace(
      /\s+в\s+(?:(?! в ).)+?(?:компани[июя]|холдинг|корпораци[июя]|банк|групп[уы])\.?\s*$/i,
      '',
    );

    line = norm(line);
    if (line.length >= 3) return line;
  }

  return undefined;
}

// Эвристика по стеку: ищем знакомые техноимена в требованиях/задачах
const KNOWN_STACK = [
  'Java','Spring','Kafka','PostgreSQL','MySQL','MongoDB','Redis','Elasticsearch',
  'React','Vue','Angular','TypeScript','JavaScript','Redux','Next.js',
  'Node.js','Python','Django','FastAPI','Flask','Go','Golang','gRPC',
  'Kubernetes','Docker','Terraform','AWS','GCP','Azure',
  'Linux','Astra','RedOS','Ubuntu','CentOS',
  'Swift','SwiftUI','Kotlin','Android',
  'Spark','Airflow','Hadoop','Snowflake','dbt',
  'SQL','Tableau','PowerBI','Grafana','Prometheus',
  'LDAP','DNS','PKI','TCP/IP','SMTP','IMAP','AD','Active Directory',
];

function detectStack(text: string): string | undefined {
  const found = new Set<string>();
  for (const tech of KNOWN_STACK) {
    const re = new RegExp(`(?<![A-Za-zА-Яа-я0-9])${tech.replace(/[.+]/g, '\\$&')}(?![A-Za-zА-Яа-я0-9])`, 'i');
    if (re.test(text)) found.add(tech);
  }
  return found.size ? Array.from(found).join(', ') : undefined;
}

// ---------- основной парсер ----------

export function parseVacancyText(raw: string): ParsedVacancy {
  if (!raw || !raw.trim()) return {};
  // Унифицируем переводы строк и убираем «висячие» пробелы
  const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n');

  const result: ParsedVacancy = {};

  // Заголовок
  result.title = detectTitle(text);

  // Ключ-значение поля
  result.project = fieldValue(text, /проект|project|продукт/);
  result.grade = detectGrade(fieldValue(text, /грейд|уровень|grade|seniority/));
  result.format = detectFormat(fieldValue(text, /локаци[яи]|формат|тип\s+занятости|location|format/));
  result.priority = detectPriority(text);
  result.deadline = detectDeadline(
    fieldValue(text, /период|срок|дедлайн|deadline|длительность/),
  );

  const rateClientRaw = fieldValue(text, /ставка\s+клиента|для\s+клиента|client\s+rate|rate\s+client/);
  const rateAnyRaw = fieldValue(text, /ставка|rate|бюджет|budget/);
  result.rateClient = detectRate(rateClientRaw ?? rateAnyRaw);

  // Секции. После имени секции допускаем уточнение («на проекте», «к кандидату», «в роли…»)
  // вплоть до двоеточия. `[^:：\n]{0,40}` гарантирует, что мы не убежим на следующую строку.
  const tail = String.raw`(?:\s+[^:：\n]{0,40})?\s*[:：]`;
  const reqHeader = new RegExp(String.raw`\n\s*(?:требовани[яе]|requirements)${tail}`, 'i');
  const tasksHeader = new RegExp(
    String.raw`\n\s*(?:(?:ключевые\s+|основные\s+|главные\s+|основной\s+)?задачи|обязанности|функционал|responsibilities|duties)${tail}`,
    'i',
  );
  const aboutHeader = new RegExp(
    String.raw`\n\s*(?:описание|о\s+проекте|о\s+компании|о\s+продукте|about)${tail}`,
    'i',
  );
  const sectionHeaders = [reqHeader, tasksHeader, aboutHeader];

  const reqBlock = extractSection('\n' + text, reqHeader, sectionHeaders);
  const tasksBlock = extractSection('\n' + text, tasksHeader, sectionHeaders);
  const aboutBlock = extractSection('\n' + text, aboutHeader, sectionHeaders);

  if (reqBlock) result.requirements = cleanBullets(reqBlock);

  // Описание собираем из: первой строки (общий контекст), «Описание», «Ключевые задачи», + полезных метаданных (Сфера, Тип запроса)
  const descParts: string[] = [];

  // Берём первую «осмысленную» строку — без эмодзи, без ID, без «Ключ: значение». И только если она реально содержит больше, чем уже распознанный title.
  let lead: string | undefined;
  for (const raw of text.split(/\n/).slice(0, 10)) {
    const cleaned = norm(stripEmoji(raw)).replace(/^[•·●▪◦\-–—*]+\s*/, '').replace(/^№\s*/i, '');
    if (!cleaned) continue;
    if (/^\d[\d\s./\\-]*$/.test(cleaned)) continue;
    if (looksLikeField(cleaned)) continue;
    if (cleaned.length < 3) continue;
    lead = cleaned;
    break;
  }
  // Если lead практически совпадает с title — не дублируем
  if (lead && (!result.title || lead.toLowerCase() !== result.title.toLowerCase())) {
    descParts.push(lead);
  }

  if (aboutBlock) descParts.push(aboutBlock);

  const sphere = fieldValue(text, /сфера|индустри[яи]|отрасль|industry/);
  const requestType = fieldValue(text, /тип\s+запроса|request\s+type/);
  const meta: string[] = [];
  if (sphere) meta.push(`Сфера: ${sphere}`);
  if (requestType) meta.push(`Тип запроса: ${requestType}`);
  if (meta.length) descParts.push(meta.join(' · '));

  if (tasksBlock) {
    descParts.push('Ключевые задачи:\n' + cleanBullets(tasksBlock));
  }

  if (descParts.length) {
    result.description = descParts.join('\n\n');
  }

  // Стек — собираем по упоминаниям во всём тексте
  result.stack = detectStack(text);

  return result;
}
