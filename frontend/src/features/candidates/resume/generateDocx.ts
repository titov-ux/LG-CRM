import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type AlignmentType,
  type ISectionOptions,
} from 'docx';
import type { Candidate } from '@/api/types';
import { buildResumeModel, type ResumeModel } from './buildResumeModel';

/**
 * Генерация .docx по шаблону «ПРОМПТ_Генератор_резюме».
 *
 * docx-библиотека считает размер в half-points (24 = 12pt), так что:
 *   - Имя:               16pt = 32 hp, жирное
 *   - Должность:         14pt = 28 hp, жирное
 *   - Заголовки секций:  12pt = 24 hp, жирные
 *   - Тело:              11pt = 22 hp
 *
 * Шрифт — Arial. Между блоками мест работы — пустой Paragraph как воздух.
 */

const FONT = 'Arial';

const SIZE_NAME = 32; // 16pt
const SIZE_POSITION = 28; // 14pt
const SIZE_HEADING = 24; // 12pt
const SIZE_BODY = 22; // 11pt

function r(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    size: opts.size ?? SIZE_BODY,
    font: FONT,
  });
}

/** Параграф из одного prepared TextRun или массива. */
function p(children: TextRun | TextRun[], opts: { spacingAfter?: number; alignment?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}): Paragraph {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { after: opts.spacingAfter ?? 0 },
    alignment: opts.alignment,
  });
}

/** Пустой параграф как «воздух» между блоками. */
function spacer(): Paragraph {
  return new Paragraph({ children: [r('', { size: SIZE_BODY })] });
}

function sectionHeading(title: string): Paragraph {
  return new Paragraph({
    children: [r(title, { bold: true, size: SIZE_HEADING })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
  });
}

/** Параграф «Метка: значение», где «Метка:» жирная. */
function labeledLine(label: string, value: string): Paragraph {
  return p([
    r(`${label}: `, { bold: true }),
    r(value),
  ]);
}

/** Один пункт-буллет «- {text}». Шаблон не требует автонумерации, поэтому пишем дефис вручную. */
function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [r(`- ${text}`)],
    spacing: { after: 0 },
  });
}

function buildHeaderParagraphs(model: ResumeModel): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(p(r(model.fullName, { bold: true, size: SIZE_NAME }), { spacingAfter: 120 }));
  if (model.position) {
    out.push(p(r(model.position, { bold: true, size: SIZE_POSITION }), { spacingAfter: 120 }));
  }
  if (model.location) out.push(labeledLine('Локация', model.location));
  if (model.birthday) out.push(labeledLine('Дата рождения', model.birthday));
  return out;
}

function buildSkillsParagraphs(model: ResumeModel): Paragraph[] {
  if (model.skillCategories.length === 0) return [];
  const paras: Paragraph[] = [sectionHeading('Ключевые навыки')];
  for (const cat of model.skillCategories) {
    paras.push(
      p([
        r(`${cat.name}: `, { bold: true }),
        r(`${cat.items.join(', ')}.`),
      ]),
    );
  }
  return paras;
}

function buildSummaryParagraphs(model: ResumeModel): Paragraph[] {
  if (!model.summary) return [];
  return [sectionHeading('Сопроводительное письмо'), p(r(model.summary))];
}

function buildExperienceParagraphs(model: ResumeModel): Paragraph[] {
  if (model.experience.length === 0) return [];
  const paras: Paragraph[] = [sectionHeading('Профессиональный опыт')];
  model.experience.forEach((exp, i) => {
    if (i > 0) paras.push(spacer());
    paras.push(p(r(exp.company, { bold: true })));
    paras.push(p(r(exp.position)));
    paras.push(p(r(exp.period)));
    if (exp.project) {
      paras.push(spacer());
      paras.push(
        p([
          r('Проект: ', { bold: true }),
          r(exp.project),
        ]),
      );
    }
    if (exp.achievements.length > 0) {
      paras.push(spacer());
      paras.push(p(r('Ключевые задачи и достижения:', { bold: true })));
      for (const a of exp.achievements) paras.push(bullet(a));
    }
    if (exp.stack) {
      paras.push(spacer());
      paras.push(
        p([
          r('Стек: ', { bold: true }),
          r(`${exp.stack}.`),
        ]),
      );
    }
  });
  return paras;
}

function buildEducationParagraphs(model: ResumeModel): Paragraph[] {
  if (model.education.length === 0) return [];
  const paras: Paragraph[] = [sectionHeading('Образование')];
  model.education.forEach((edu, i) => {
    if (i > 0) paras.push(spacer());
    paras.push(p(r(edu.degree, { bold: true })));
    if (edu.institutionLine) paras.push(p(r(edu.institutionLine)));
    if (edu.specialty) paras.push(p(r(edu.specialty)));
  });
  return paras;
}

function buildCertificationsParagraphs(model: ResumeModel): Paragraph[] {
  if (model.certifications.length === 0) return [];
  const paras: Paragraph[] = [sectionHeading('Повышение квалификации')];
  for (const c of model.certifications) {
    if (c.line) paras.push(p(r(c.line)));
  }
  return paras;
}

function buildLanguagesParagraphs(model: ResumeModel): Paragraph[] {
  if (!model.languages) return [];
  return [sectionHeading('Знание языков'), p(r(`${model.languages.line}.`))];
}

function buildDocument(model: ResumeModel): Document {
  const children: Paragraph[] = [
    ...buildHeaderParagraphs(model),
    ...buildSkillsParagraphs(model),
    ...buildSummaryParagraphs(model),
    ...buildExperienceParagraphs(model),
    ...buildEducationParagraphs(model),
    ...buildCertificationsParagraphs(model),
    ...buildLanguagesParagraphs(model),
  ];

  const section: ISectionOptions = { properties: {}, children };

  return new Document({
    creator: 'CRM ЛГ',
    title: `Резюме — ${model.fullName}`,
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE_BODY } },
      },
    },
    sections: [section],
  });
}

/**
 * Сборка резюме в Blob (.docx). Принимает Candidate, нормализует через
 * buildResumeModel и собирает документ.
 */
export async function generateResumeDocxBlob(candidate: Candidate): Promise<Blob> {
  const model = buildResumeModel(candidate);
  const doc = buildDocument(model);
  return Packer.toBlob(doc);
}

/** Имя файла резюме: «Иванов_Иван_резюме.docx» из строки «Иван Иванов». */
export function resumeFileName(candidate: Candidate, ext: 'docx' | 'pdf'): string {
  const safe = candidate.fullName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  return `${safe}_резюме.${ext}`;
}
