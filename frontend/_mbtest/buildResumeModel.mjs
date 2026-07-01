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
function currentMonthIso() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`;
}
function formatMonth(iso) {
    const m = /^(\d{4})-(\d{2})$/.exec(iso);
    if (!m)
        return iso;
    const month = Number(m[2]);
    if (month < 1 || month > 12)
        return iso;
    return `${MONTH_NAMES_RU[month - 1]} ${m[1]}`;
}
/** "Месяц Год - Месяц Год", без «по настоящее время». */
function formatPeriodStrict(start, end) {
    const endIso = end && end.trim() ? end : currentMonthIso();
    return `${formatMonth(start)} - ${formatMonth(endIso)}`;
}
/** ISO YYYY-MM-DD → "ДД.ММ.ГГГГ". */
function formatBirthday(iso) {
    if (!iso)
        return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m)
        return '';
    return `${m[3]}.${m[2]}.${m[1]}`;
}
/** Удаляет длинные тире из строки — рендер не должен их видеть. */
function stripEmDashes(text) {
    // Em-dash, en-dash, horizontal bar — все вариации заменяем на дефис.
    return text.replace(/[—–―]/g, '-');
}
function joinNonEmpty(parts, sep) {
    return parts.filter((p) => !!p && !!p.trim()).join(sep);
}
function formatLanguages(languages) {
    if (!languages || languages.length === 0)
        return null;
    const parts = languages.map((l) => `${l.language}: ${l.level}`);
    return { line: parts.join(', ') };
}
function pluralRu(n, one, few, many) {
    const mod100 = n % 100;
    const mod10 = n % 10;
    if (mod10 === 1 && mod100 !== 11)
        return one;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14))
        return few;
    return many;
}
/**
 * Считает общий стаж от самой ранней даты начала до самой поздней даты
 * окончания (включая текущее место — для `endMonth=null` берём текущий
 * месяц). Возвращает строку вида «4 года 8 месяцев», с корректным
 * склонением и без округления.
 */
export function calcExperienceLabel(experience) {
    if (!experience || experience.length === 0)
        return '0 лет';
    let earliest = null;
    let latest = null;
    const now = new Date();
    const nowYM = { y: now.getFullYear(), m: now.getMonth() + 1 };
    for (const e of experience) {
        const ms = /^(\d{4})-(\d{2})$/.exec(e.startMonth);
        if (!ms)
            continue;
        const start = { y: Number(ms[1]), m: Number(ms[2]) };
        let end;
        if (e.endMonth) {
            const me = /^(\d{4})-(\d{2})$/.exec(e.endMonth);
            end = me ? { y: Number(me[1]), m: Number(me[2]) } : nowYM;
        }
        else {
            end = nowYM;
        }
        if (!earliest || start.y < earliest.y || (start.y === earliest.y && start.m < earliest.m)) {
            earliest = start;
        }
        if (!latest || end.y > latest.y || (end.y === latest.y && end.m > latest.m)) {
            latest = end;
        }
    }
    if (!earliest || !latest)
        return '0 лет';
    const totalMonths = (latest.y - earliest.y) * 12 + (latest.m - earliest.m);
    if (totalMonths <= 0)
        return 'менее месяца';
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    const parts = [];
    if (years > 0)
        parts.push(`${years} ${pluralRu(years, 'год', 'года', 'лет')}`);
    if (months > 0)
        parts.push(`${months} ${pluralRu(months, 'месяц', 'месяца', 'месяцев')}`);
    return parts.length > 0 ? parts.join(' ') : 'менее месяца';
}
export function buildResumeModel(candidate) {
    const skillCategories = (candidate.skillCategories ?? [])
        .filter((c) => c.items.length > 0)
        .map((c) => ({
        name: stripEmDashes(c.name),
        items: c.items.map(stripEmDashes),
    }));
    const experience = (candidate.experience ?? []).map((e) => ({
        company: stripEmDashes(e.company),
        position: stripEmDashes(e.position),
        period: formatPeriodStrict(e.startMonth, e.endMonth),
        project: stripEmDashes(e.project ?? ''),
        achievements: e.achievements.map(stripEmDashes),
        stack: stripEmDashes(e.stack.join(', ')),
    }));
    const education = (candidate.education ?? []).map((e) => ({
        degree: stripEmDashes(e.degree),
        institutionLine: stripEmDashes(joinNonEmpty([e.institution, e.city, String(e.graduationYear)], ', ')),
        specialty: stripEmDashes(e.specialty ?? ''),
    }));
    const certifications = (candidate.certifications ?? []).map((c) => ({
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
