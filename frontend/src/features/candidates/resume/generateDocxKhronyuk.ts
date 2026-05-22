import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from 'docx';
import type { Candidate } from '@/api/types';
import { buildResumeModel, calcExperienceLabel, type ResumeModel } from './buildResumeModel';

/**
 * Альтернативный шаблон резюме «Хронюк / Цифровые привычки» (для МБ).
 *
 * Визуальные правила (см. ПРОМПТ_Шабло.md):
 *   - шрифт Calibri, ВЕСЬ текст жирный (bold=true);
 *   - заголовки разделов — красные (#ff0000), sz=36 (18pt);
 *   - тело — sz=24 (12pt) #0f1115 или #111827;
 *   - проекты идут нумерованным списком «1. … 2. … N. …».
 *
 * Источник данных — обычная Candidate-модель (тот же механизм, что у
 * базового generateDocx). Поля, которых нет в карточке (чеклист, доп.
 * информация, «Готов выйти на проект с»), берутся из доступных данных
 * или скипаются.
 */

const FONT = 'Calibri';

// Цвета
const C_HEADER = '111827';
const C_LABEL = '2C2C36';
const C_RED = 'FF0000';
const C_BODY = '0F1115';

// Размеры (half-points: 24 = 12pt)
const SZ_DEF = 24;
const SZ_SM = 22;
const SZ_COVER = 32;
const SZ_SEC = 36;

const NIL_BORDER = { style: BorderStyle.NIL, size: 0, color: 'FFFFFF' } as const;
const NIL_BORDERS = {
  top: NIL_BORDER,
  bottom: NIL_BORDER,
  left: NIL_BORDER,
  right: NIL_BORDER,
} as const;

interface RunOpts {
  bold?: boolean;
  sz?: number;
  color?: string;
  br?: number;
}

/** В шаблоне Хронюк bold=true ПО УМОЛЧАНИЮ — это не опечатка. */
function r(text: string, opts: RunOpts = {}): TextRun {
  const { bold = true, sz = SZ_DEF, color, br = 0 } = opts;
  return new TextRun({
    text,
    bold,
    size: sz,
    font: FONT,
    color,
    break: br,
  });
}

function sanitizeText(text: string): string {
  return text.replace(/[—–―]/g, '-');
}

function currentMonthIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
}

function formatMonthYear(iso: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(iso);
  if (!m) return sanitizeText(iso);
  return `${m[2]}.${m[1]}`;
}

function formatProjectPeriodMb(startMonth: string, endMonth: string | null | undefined): string {
  const endIso = endMonth && endMonth.trim() ? endMonth : currentMonthIso();
  return `${formatMonthYear(startMonth)} - ${formatMonthYear(endIso)}`;
}

function pa(
  children: TextRun | TextRun[],
  spacing: { after?: number; before?: number } = {},
): Paragraph {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { after: spacing.after ?? 0, before: spacing.before ?? 0 },
  });
}

function redHeader(text: string, sz: number = SZ_SEC): Paragraph {
  return new Paragraph({
    children: [r(text, { bold: true, sz, color: C_RED })],
    spacing: { before: 240, after: 120 },
  });
}

function tcNoB(width: number, children: Paragraph[]): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: NIL_BORDERS,
    margins: { top: 40, bottom: 40, left: 0, right: 80 },
    children,
  });
}

function tbl2(columnWidths: [number, number], rows: TableRow[]): Table {
  return new Table({
    width: { size: columnWidths[0] + columnWidths[1], type: WidthType.DXA },
    columnWidths,
    borders: NIL_BORDERS,
    rows,
  });
}

function numItem(text: string): Paragraph {
  return new Paragraph({
    numbering: { reference: 'khronyuk-decimal', level: 0 },
    children: [r(text, { bold: true, sz: SZ_DEF, color: C_BODY })],
    spacing: { after: 60, before: 0 },
  });
}

function projHeader(name: string, dates: string, role: string, desc: string): Paragraph {
  const lines: TextRun[] = [
    r('Проект: ' + name, { bold: true, sz: SZ_DEF, color: C_BODY }),
    r(dates, { bold: true, sz: SZ_DEF, color: C_BODY, br: 1 }),
    r('Роль в проекте - ' + role, { bold: true, sz: SZ_DEF, color: C_BODY, br: 1 }),
  ];
  if (desc) {
    lines.push(r('Описание проекта:', { bold: true, sz: SZ_DEF, color: C_BODY, br: 1 }));
    lines.push(r(desc, { bold: true, sz: SZ_DEF, color: C_BODY, br: 1 }));
  }
  return new Paragraph({
    children: lines,
    spacing: { before: 200, after: 80 },
  });
}

/**
 * Достаём «уровень» (Senior / Middle / Junior / Lead) — это grade
 * кандидата, но шаблону всё равно без него, поэтому скипаем при пустом.
 */
function getLevel(candidate: Candidate): string {
  return candidate.grade ?? '';
}

/**
 * «Готов выйти на проект с» — в карточке нет такого поля, поэтому ставим
 * «ASAP» (как в эталонном шаблоне).
 */
function getReadyDate(): string {
  return 'ASAP';
}

/**
 * Чек лист по шаблону — короткие предложения о том, что кандидат умеет
 * под вакансию. У нас нет отдельного поля, поэтому собираем по приоритету:
 *   1) summary, разбитый по строкам/предложениям с «- » или «+ »;
 *   2) если в summary нет буллетов — берём первые несколько achievements
 *      из самого свежего места работы (это близко к смыслу «чеклиста»).
 */
function buildChecklistItems(candidate: Candidate, model: ResumeModel): string[] {
  // 1. Попробуем вытащить буллеты из summary
  if (model.summary) {
    const bulletLines = model.summary
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-•+*·]\s*/, '').trim())
      .filter(Boolean);
    if (bulletLines.length >= 2) return bulletLines.map(sanitizeText);
  }
  // 2. Иначе — достижения свежего опыта (до 15 пунктов)
  const recent = candidate.experience?.[0];
  if (recent?.achievements?.length) {
    return recent.achievements.slice(0, 15).map(sanitizeText);
  }
  return [];
}

/**
 * Доп. информация — собираем то, что не вошло в чеклист, но полезно
 * для МБ: сертификаты и языки.
 */
function buildExtraItems(model: ResumeModel): string[] {
  const items: string[] = [];
  for (const c of model.certifications) {
    if (c.line) items.push(c.line);
  }
  if (model.languages?.line) {
    items.push('Языки: ' + model.languages.line);
  }
  return items;
}

function buildHeaderBlock(candidate: Candidate, model: ResumeModel): Paragraph {
  const level = getLevel(candidate);
  const lines: TextRun[] = [
    r(model.fullName.toUpperCase(), { bold: true, sz: SZ_SEC, color: C_HEADER }),
  ];
  if (model.position) {
    lines.push(r('Позиция: ' + model.position, { bold: true, sz: SZ_DEF, color: C_HEADER, br: 1 }));
  }
  if (level) {
    lines.push(r('Уровень: ' + level, { bold: true, sz: SZ_DEF, color: C_HEADER, br: 1 }));
  }
  lines.push(
    r('Готов выйти на проект с: ' + getReadyDate(), {
      bold: true,
      sz: SZ_DEF,
      color: C_HEADER,
      br: 1,
    }),
  );
  if (model.location) {
    lines.push(r('Локация: ' + model.location, { bold: true, sz: SZ_DEF, color: C_HEADER, br: 1 }));
  }
  return new Paragraph({
    children: lines,
    spacing: { after: 180, before: 0, line: 276 },
  });
}

/** Дата рождения и опыт работы. */
function buildBirthdayExperience(candidate: Candidate, model: ResumeModel): Paragraph[] {
  const out: Paragraph[] = [];
  if (model.birthday) {
    out.push(pa([r(model.birthday, { bold: true, color: C_HEADER })], { after: 0 }));
  }
  const expLabel = calcExperienceLabel(
    (candidate.experience ?? []).map((e) => ({ startMonth: e.startMonth, endMonth: e.endMonth })),
  );
  out.push(
    pa(
      [
        r('Опыт работы: ', { bold: true, sz: SZ_SM, color: C_LABEL }),
        r(expLabel, { bold: true, sz: SZ_SM, color: C_LABEL }),
      ],
      { after: 160 },
    ),
  );
  return out;
}

function buildCoverLetter(model: ResumeModel, checklist: string[], extra: string[]): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      children: [
        r('Сопроводительное письмо (О себе, знания и навыки)', {
          bold: true,
          sz: SZ_COVER,
          color: C_RED,
        }),
      ],
      spacing: { before: 200, after: 120 },
    }),
  );
  if (model.summary) {
    // Если summary не «буллетный» — выводим как абзац-текст письма
    const isBulletSummary = /^[-•+*·]\s/m.test(model.summary);
    if (!isBulletSummary) {
      out.push(pa([r(model.summary, { bold: true })], { after: 80 }));
    }
  }
  out.push(pa([r('Чек лист:', { bold: true, sz: SZ_SEC, color: C_RED })], { after: 60 }));
  for (const item of checklist) {
    out.push(
      pa(
        [
          r('+ ', { bold: true, color: C_BODY }),
          r(item, { bold: true, color: C_BODY }),
        ],
        { after: 40 },
      ),
    );
  }
  if (extra.length > 0) {
    out.push(
      pa([r('Дополнительная информация:', { bold: true, sz: SZ_COVER })], {
        after: 60,
        before: 100,
      }),
    );
    for (const item of extra) {
      out.push(
        pa(
          [
            r('+ ', { bold: true, color: C_BODY }),
            r(item, { bold: true, color: C_BODY }),
          ],
          { after: 40 },
        ),
      );
    }
  } else {
    out.push(pa([r('Дополнительная информация:', { bold: true, sz: SZ_COVER })], { before: 100 }));
  }
  return out;
}

function buildSkillsBlock(model: ResumeModel): Paragraph[] | Array<Paragraph | Table> {
  if (model.skillCategories.length === 0) return [];
  const out: Array<Paragraph | Table> = [];
  out.push(redHeader('Ключевые навыки (Основной стек)'));

  // Правая колонка — список «Категория: items»
  const rightCellParas: Paragraph[] = model.skillCategories.map((cat) =>
    pa(
      [
        r(cat.name + ':', { bold: true, color: C_BODY }),
        r(' ' + cat.items.join(', '), { bold: true, color: C_BODY }),
      ],
      { after: 40 },
    ),
  );

  out.push(
    tbl2(
      [2500, 7138],
      [
        new TableRow({
          children: [
            tcNoB(2500, [pa([r('Ключевые навыки', { bold: true, sz: SZ_SM })], { after: 0 })]),
            tcNoB(7138, rightCellParas),
          ],
        }),
      ],
    ),
  );
  return out;
}

function buildEducationBlock(model: ResumeModel): Paragraph[] {
  if (model.education.length === 0) return [];
  const out: Paragraph[] = [redHeader('Образование')];
  for (const edu of model.education) {
    const parts: TextRun[] = [];
    parts.push(r(edu.degree + '  ', { bold: true, color: C_HEADER }));
    if (edu.institutionLine) {
      parts.push(r(edu.institutionLine + '  ', { bold: true, color: C_HEADER }));
    }
    if (edu.specialty) {
      parts.push(r(edu.specialty, { bold: true, color: C_HEADER }));
    }
    out.push(pa(parts, { after: 120 }));
  }
  return out;
}

function buildProjectsBlock(candidate: Candidate, model: ResumeModel): Paragraph[] {
  if (model.experience.length === 0) return [];
  const out: Paragraph[] = [
    new Paragraph({
      children: [r('Недавние проекты', { bold: true, color: C_HEADER })],
      spacing: { before: 240, after: 120 },
    }),
  ];
  for (const [idx, exp] of model.experience.entries()) {
    const rawExp = candidate.experience?.[idx];
    const strictPeriod = rawExp
      ? formatProjectPeriodMb(rawExp.startMonth, rawExp.endMonth)
      : sanitizeText(exp.period);
    out.push(projHeader(exp.company, strictPeriod, exp.position, exp.project ?? ''));
    for (const a of exp.achievements) {
      out.push(numItem(a));
    }
    if (exp.stack) {
      out.push(numItem('Стек: ' + exp.stack));
    }
  }
  return out;
}

function buildDocument(candidate: Candidate, model: ResumeModel): Document {
  const checklist = buildChecklistItems(candidate, model);
  const extra = buildExtraItems(model);

  const children: Array<Paragraph | Table> = [];
  children.push(buildHeaderBlock(candidate, model));
  for (const p of buildBirthdayExperience(candidate, model)) children.push(p);
  for (const p of buildCoverLetter(model, checklist, extra)) children.push(p);
  for (const p of buildSkillsBlock(model)) children.push(p);
  for (const p of buildEducationBlock(model)) children.push(p);
  for (const p of buildProjectsBlock(candidate, model)) children.push(p);

  const section: ISectionOptions = {
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
      },
    },
    children,
  };

  return new Document({
    creator: 'CRM ЛГ',
    title: `Резюме для МБ - ${model.fullName}`,
    numbering: {
      config: [
        {
          reference: 'khronyuk-decimal',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: 720, hanging: 360 },
                  spacing: { after: 60, before: 0 },
                },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: { run: { font: FONT, size: SZ_DEF, bold: true } },
      },
    },
    sections: [section],
  });
}

/**
 * Собирает резюме в Blob (.docx) по альтернативному шаблону «для МБ».
 * Принимает Candidate, нормализует через buildResumeModel и собирает
 * документ — точно так же, как обычный generateResumeDocxBlob.
 */
export async function generateResumeDocxBlobKhronyuk(candidate: Candidate): Promise<Blob> {
  const model = buildResumeModel(candidate);
  const doc = buildDocument(candidate, model);
  return Packer.toBlob(doc);
}

/** Имя файла: «Иванов_Иван_резюме_МБ.docx». */
export function resumeFileNameKhronyuk(candidate: Candidate): string {
  const safe = candidate.fullName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  return `${safe}_резюме_МБ.docx`;
}
