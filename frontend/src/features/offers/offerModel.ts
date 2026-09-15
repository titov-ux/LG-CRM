/**
 * Модель job-оффера Lachevsky Group.
 *
 * Оффер — это одноразовый документ: форма на странице /offers заполняется
 * из кандидата и вакансии, редактируется вручную и скачивается как PDF.
 * Никакого состояния на бэкенде нет — только рендер HTML → PDF через
 * POST /files/render-pdf (Playwright).
 */

export interface OfferModel {
  /** Номер документа, напр. «ОФ150926-1». */
  offerNumber: string;
  /** Город в строке даты. */
  city: string;
  /** Дата составления, ISO YYYY-MM-DD. */
  date: string;
  /** Имя для обращения в заголовке («Рафаэль, приглашаем вас…»). */
  firstName: string;
  /** Полное ФИО кандидата в таблице условий. */
  fullName: string;
  /** Вступительный абзац под заголовком. */
  intro: string;
  position: string;
  /** Грейд: Lead / Senior / Middle+ / Middle / Junior. */
  grade: string;
  /** Проект/клиент — опциональная строка условий. */
  project: string;
  workFormat: string;
  /** Оформление: 'ТК РФ' | 'ИП' | 'СМЗ' (в PDF разворачивается в полную подпись). */
  employment: string;
  /** Испытательный срок, напр. «3 месяца». Пусто — строка не выводится. */
  probation: string;
  /** Дата выхода, ISO YYYY-MM-DD. */
  startDate: string;
  /** Оклад в месяц на руки, ₽. */
  salaryNet: number | undefined;
  /** Оклад после испытательного срока на руки, ₽ (опционально). */
  salaryAfterProbation: number | undefined;
  /** Премия — свободный текст (опционально). */
  bonus: string;
  /** Соцпакет: по пункту на строку. */
  benefits: string[];
  /** Оффер действителен до, ISO YYYY-MM-DD. */
  validUntil: string;
  signerName: string;
  /** Роль подписанта, напр. «HR-менеджер, ООО «ЛГ Интеграция»». */
  signerRole: string;
  contactEmail: string;
  contactPhone: string;
}

function isoToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Номер оффера из его даты: «ОФ» + ддммгг + «-1», напр. 2026-09-15 → ОФ150926-1.
 * При смене даты в форме номер пересчитывается автоматически.
 */
export function offerNumberForDate(iso: string): string {
  const d = iso ? new Date(`${iso}T00:00:00`) : new Date();
  const safe = Number.isNaN(d.getTime()) ? new Date() : d;
  const dd = String(safe.getDate()).padStart(2, '0');
  const mm = String(safe.getMonth() + 1).padStart(2, '0');
  const yy = String(safe.getFullYear()).slice(-2);
  return `ОФ${dd}${mm}${yy}-1`;
}

export const DEFAULT_INTRO =
  'Мы обсудили вашу кандидатуру по итогам всех этапов и единогласно приняли решение сделать вам предложение. Ниже - условия, на которых мы готовы начать работать вместе.';

/** Вариант вступления для ИП/СМЗ: не «работать вместе», а «начать взаимодействие». */
export const DEFAULT_INTRO_SERVICES =
  'Мы обсудили вашу кандидатуру по итогам всех этапов и единогласно приняли решение сделать вам предложение. Ниже - условия, на которых мы готовы начать взаимодействие.';

export function emptyOffer(): OfferModel {
  const date = isoToday();
  return {
    offerNumber: offerNumberForDate(date),
    city: 'Москва',
    date,
    firstName: '',
    fullName: '',
    intro: DEFAULT_INTRO,
    position: '',
    grade: '',
    project: '',
    workFormat: 'Удаленно',
    employment: 'ТК РФ',
    probation: '3 месяца',
    startDate: '',
    salaryNet: undefined,
    salaryAfterProbation: undefined,
    bonus: '',
    benefits: ['Отпуск 28 календарных дней'],
    validUntil: isoPlusDays(7),
    signerName: '',
    signerRole: 'ООО «ЛГ Интеграция»',
    contactEmail: 'hello@lachevsky.group',
    contactPhone: '+7 985 315-51-79',
  };
}

/** «2026-09-15» → «15 сентября 2026» (без «г.»). */
export function offerDateRu(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .replace(/\s*г\.\s*$/, '');
}

/** Имя файла: «Оффер_Рафаэль_Саркисян.pdf», для ИП/СМЗ - «Приглашение_…». */
export function offerFileName(model: OfferModel): string {
  const base = (model.fullName || 'кандидат').trim().replace(/\s+/g, '_');
  const services = model.employment === 'ИП' || model.employment === 'СМЗ';
  return `${services ? 'Приглашение' : 'Оффер'}_${base}.pdf`;
}
