import { AlignmentType, BorderStyle, Document, Footer, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, } from 'docx';
import { buildResumeModel } from './buildResumeModel.mjs';
/**
 * Шаблон резюме для Московской биржи (МБ) — «Шаблон Резюме ПАП для B2B 06/2026».
 *
 * Структура (порядок полей менять нельзя — требование МБ):
 *   1. Заголовок «Резюме кандидата» (по центру, тёмно-синий).
 *   2. ФИО (красный) + Позиция / Уровень / Готов выйти на проект с / Локация.
 *   3. Разделительная линия.
 *   4. Сопроводительное письмо (О себе, знания и навыки).
 *   5. Чек-лист (заполняется вручную из Excel — выводим только пометку).
 *   6. Ключевые навыки (Основной стек) — таблица: Платформы / Языки
 *      программирования / Инструменты / Базы данных.
 *   7. Образование.
 *   8. Опыт работы (Роль-Уровень-Компетенция).
 *   9. Недавние проекты (Описание проекта + Что было сделано).
 *   Футер на каждой странице: пометка об обязательности полей.
 *
 * Визуальные правила:
 *   - шрифт Arial;
 *   - заголовки разделов — красные (#FF0000), body — обычного начертания
 *     тёмно-серым (#333333), заголовки проектов/подзаголовки — тёмно-синие
 *     (#1F3864) и жирные.
 */
const FONT = 'Arial';
// Цвета
const C_NAVY = '1F3864'; // заголовок, названия проектов, подзаголовки
const C_RED = 'FF0000'; // заголовки секций, ФИО
const C_BODY = '333333'; // основной текст
const C_MUTED = '595959'; // даты, технологии, мелкие пометки
const C_FOOT = '808080'; // футер
const C_BORDER = 'BFBFBF'; // границы таблицы навыков
// Размеры (half-points: 24 = 12pt)
const SZ_TITLE = 36; // «Резюме кандидата»
const SZ_NAME = 32; // ФИО
const SZ_SEC = 30; // красные заголовки секций
const SZ_PROJ = 28; // название проекта
const SZ_BODY = 22; // основной текст (11pt)
const SZ_SM = 18; // даты / технологии / футер (9pt)
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: C_BORDER };
const CELL_BORDERS = {
    top: CELL_BORDER,
    bottom: CELL_BORDER,
    left: CELL_BORDER,
    right: CELL_BORDER,
};
/** По умолчанию текст ОБЫЧНЫЙ (не жирный) — жирность включается явно. */
function r(text, opts = {}) {
    const { bold = false, sz = SZ_BODY, color = C_BODY, br = 0, italics = false } = opts;
    return new TextRun({ text, bold, size: sz, font: FONT, color, break: br, italics });
}
function sanitizeText(text) {
    return text.replace(/[—–―]/g, '-');
}
function currentMonthIso() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`;
}
function formatMonthYear(iso) {
    const m = /^(\d{4})-(\d{2})$/.exec(iso);
    if (!m)
        return sanitizeText(iso);
    return `${m[2]}.${m[1]}`;
}
function formatProjectPeriodMb(startMonth, endMonth) {
    const endIso = endMonth && endMonth.trim() ? endMonth : currentMonthIso();
    return `${formatMonthYear(startMonth)} - ${formatMonthYear(endIso)}`;
}
function pa(children, spacing = {}, alignment) {
    return new Paragraph({
        children: Array.isArray(children) ? children : [children],
        spacing: { after: spacing.after ?? 0, before: spacing.before ?? 0, line: spacing.line },
        alignment,
    });
}
/** Красный заголовок секции. */
function redHeader(text, spacing = {}) {
    return new Paragraph({
        children: [r(text, { bold: true, sz: SZ_SEC, color: C_RED })],
        spacing: { before: spacing.before ?? 260, after: spacing.after ?? 120 },
    });
}
function getLevel(candidate) {
    return candidate.grade ?? '';
}
/**
 * «Готов выйти на проект с» — в карточке нет такого поля, поэтому ставим
 * «ASAP» (как в эталонном шаблоне).
 */
function getReadyDate() {
    return 'ASAP';
}
// ─────────────────────────────────────────────────────────────────────────
// Заголовок + шапка
// ─────────────────────────────────────────────────────────────────────────
function buildTitle() {
    return new Paragraph({
        children: [r('Резюме кандидата', { bold: true, sz: SZ_TITLE, color: C_NAVY })],
        alignment: AlignmentType.CENTER,
        spacing: { after: 260, before: 0 },
    });
}
function buildHeaderBlock(candidate, model) {
    const level = getLevel(candidate);
    const out = [];
    out.push(new Paragraph({
        children: [r(model.fullName, { bold: true, sz: SZ_NAME, color: C_RED })],
        spacing: { after: 80, before: 0 },
    }));
    if (model.position) {
        out.push(pa([r('Позиция: ' + model.position)], { after: 20 }));
    }
    if (level) {
        out.push(pa([r('Уровень: ' + level)], { after: 20 }));
    }
    out.push(pa([r('Готов(-а) выйти на проект с: ' + getReadyDate(), { bold: true })], { after: 20 }));
    if (model.location) {
        out.push(pa([r('Локация: ' + model.location, { bold: true })], { after: 20 }));
    }
    // Разделительная линия
    out.push(new Paragraph({
        children: [r('', { sz: 2 })],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C_BORDER, space: 1 } },
        spacing: { after: 60, before: 60 },
    }));
    return out;
}
// ─────────────────────────────────────────────────────────────────────────
// Сопроводительное письмо + Чек-лист
// ─────────────────────────────────────────────────────────────────────────
function buildCoverLetter(model) {
    const out = [];
    out.push(redHeader('Сопроводительное письмо (О себе, знания и навыки)'));
    if (model.summary) {
        for (const line of model.summary.split(/\r?\n/)) {
            const clean = line.replace(/^[-•+*·]\s*/, '').trim();
            if (clean)
                out.push(pa([r(clean)], { after: 40 }));
        }
    }
    return out;
}
function buildChecklist() {
    return [
        redHeader('Чек-лист'),
        pa([r('(скопировать заполненный чек-лист из Excel, приложенного к запросу)', {
                sz: SZ_SM,
                color: C_MUTED,
            })]),
    ];
}
const SKILL_ROWS = [
    { key: 'platforms', label: 'Платформы' },
    { key: 'languages', label: 'Языки программирования' },
    { key: 'tools', label: 'Инструменты' },
    { key: 'databases', label: 'Базы данных' },
];
/** Раскладывает произвольные категории навыков кандидата по 4 строкам МБ. */
function bucketSkills(model) {
    const buckets = {
        platforms: [],
        languages: [],
        tools: [],
        databases: [],
    };
    for (const cat of model.skillCategories) {
        const name = cat.name.toLowerCase();
        let key;
        if (/платформ|операционн|\bос\b|\bos\b/.test(name)) {
            key = 'platforms';
        }
        else if (/язык|language/.test(name)) {
            key = 'languages';
        }
        else if (/баз.*данн|\bбд\b|\bсубд\b|database|\bsql\b/.test(name)) {
            key = 'databases';
        }
        else {
            key = 'tools';
        }
        buckets[key].push(...cat.items);
    }
    return buckets;
}
function skillCell(width, paras) {
    return new TableCell({
        width: { size: width, type: WidthType.DXA },
        borders: CELL_BORDERS,
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: paras,
    });
}
function buildSkillsBlock(model) {
    if (model.skillCategories.length === 0)
        return [];
    const buckets = bucketSkills(model);
    const out = [redHeader('Ключевые навыки (Основной стек)')];
    const rows = SKILL_ROWS.map(({ key, label }) => new TableRow({
        children: [
            skillCell(2900, [pa([r(label, { bold: true })])]),
            skillCell(6738, [pa([r(buckets[key].join(', '))])]),
        ],
    }));
    out.push(new Table({
        width: { size: 9638, type: WidthType.DXA },
        columnWidths: [2900, 6738],
        borders: CELL_BORDERS,
        rows,
    }));
    return out;
}
// ─────────────────────────────────────────────────────────────────────────
// Образование
// ─────────────────────────────────────────────────────────────────────────
function buildEducationBlock(model) {
    if (model.education.length === 0)
        return [];
    const out = [redHeader('Образование')];
    for (const edu of model.education) {
        const line1 = [edu.specialty, edu.degree].filter(Boolean).join(', ');
        if (line1)
            out.push(pa([r(line1, { bold: true, color: C_NAVY })], { after: 20 }));
        if (edu.institutionLine)
            out.push(pa([r(edu.institutionLine)], { after: 120 }));
    }
    return out;
}
// ─────────────────────────────────────────────────────────────────────────
// Опыт работы (Роль-Уровень-Компетенция)
// ─────────────────────────────────────────────────────────────────────────
function buildExperienceBlock(candidate, model) {
    if (model.experience.length === 0)
        return [];
    const level = getLevel(candidate);
    const out = [redHeader('Опыт работы')];
    out.push(pa([r('(Роль-Уровень-Компетенция)', { bold: true, color: C_NAVY, sz: SZ_BODY })], {
        after: 120,
    }));
    for (const [idx, exp] of model.experience.entries()) {
        const rawExp = candidate.experience?.[idx];
        const period = rawExp
            ? formatProjectPeriodMb(rawExp.startMonth, rawExp.endMonth)
            : sanitizeText(exp.period);
        const roleLine = [exp.position, level].filter(Boolean).join(', ');
        out.push(pa([r([roleLine, exp.company].filter(Boolean).join(' - '), { bold: true, color: C_NAVY })], { after: 20, before: idx === 0 ? 0 : 120 }));
        out.push(pa([r(period, { sz: SZ_SM, color: C_MUTED })], { after: 40 }));
        if (exp.project)
            out.push(pa([r(exp.project)], { after: 40 }));
    }
    return out;
}
// ─────────────────────────────────────────────────────────────────────────
// Недавние проекты
// ─────────────────────────────────────────────────────────────────────────
function buildProjectsBlock(candidate, model) {
    if (model.experience.length === 0)
        return [];
    const out = [redHeader('Недавние проекты')];
    for (const [idx, exp] of model.experience.entries()) {
        const rawExp = candidate.experience?.[idx];
        const period = rawExp
            ? formatProjectPeriodMb(rawExp.startMonth, rawExp.endMonth)
            : sanitizeText(exp.period);
        out.push(pa([r(exp.company, { bold: true, sz: SZ_PROJ, color: C_NAVY })], {
            after: 20,
            before: idx === 0 ? 0 : 160,
        }));
        out.push(pa([r(period, { sz: SZ_SM, color: C_MUTED })], { after: 20 }));
        if (exp.stack) {
            out.push(pa([r('Набор использованных технологий: ' + exp.stack, { sz: SZ_SM, color: C_MUTED })], {
                after: 80,
            }));
        }
        out.push(pa([r('Описание проекта', { bold: true, color: C_NAVY })], { after: 20 }));
        out.push(pa([r(exp.project || '-')], { after: 80 }));
        out.push(pa([r('Что было сделано', { bold: true, color: C_NAVY })], { after: 20 }));
        if (exp.achievements.length > 0) {
            for (const a of exp.achievements) {
                out.push(pa([r('- ' + a)], { after: 20 }));
            }
        }
        else {
            out.push(pa([r('-')], { after: 20 }));
        }
    }
    return out;
}
// ─────────────────────────────────────────────────────────────────────────
// Сборка документа
// ─────────────────────────────────────────────────────────────────────────
function buildFooter() {
    return new Footer({
        children: [
            new Paragraph({
                children: [
                    r('* Все поля обязательны для заполнения, изменение порядка полей не допускается.', { sz: SZ_SM, color: C_FOOT }),
                ],
                spacing: { before: 120, after: 0 },
            }),
        ],
    });
}
function buildDocument(candidate, model) {
    const children = [];
    children.push(buildTitle());
    for (const p of buildHeaderBlock(candidate, model))
        children.push(p);
    for (const p of buildCoverLetter(model))
        children.push(p);
    for (const p of buildChecklist())
        children.push(p);
    for (const p of buildSkillsBlock(model))
        children.push(p);
    for (const p of buildEducationBlock(model))
        children.push(p);
    for (const p of buildExperienceBlock(candidate, model))
        children.push(p);
    for (const p of buildProjectsBlock(candidate, model))
        children.push(p);
    const section = {
        properties: {
            page: {
                size: { width: 11906, height: 16838 },
                margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
            },
        },
        footers: { default: buildFooter() },
        children,
    };
    return new Document({
        creator: 'CRM ЛГ',
        title: `Резюме для МБ - ${model.fullName}`,
        styles: {
            default: {
                document: { run: { font: FONT, size: SZ_BODY, color: C_BODY } },
            },
        },
        sections: [section],
    });
}
/**
 * Собирает резюме в Blob (.docx) по шаблону «для МБ».
 */
export async function generateResumeDocxBlobKhronyuk(candidate) {
    const model = buildResumeModel(candidate);
    const doc = buildDocument(candidate, model);
    return Packer.toBlob(doc);
}
/** Имя файла: «Иванов_Иван_резюме_МБ.docx». */
export function resumeFileNameKhronyuk(candidate) {
    const safe = candidate.fullName.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    return `${safe}_резюме_МБ.docx`;
}
