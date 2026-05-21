import type { Candidate } from '@/api/types';
import { buildResumeModel, calcExperienceLabel, type ResumeModel } from './buildResumeModel';
import { resumeFileName } from './generateDocx';
import { LACHEVSKY_LOGO_DATA_URL } from './lachevskyLogo';

interface JobCardPage {
  company: string;
  position: string;
  period: string;
  project: string;
  duties: string[];
  achievements: string[];
  stack: string[];
}

interface DerivedView {
  experienceLabel: string;
  stackMain: string;
  stackBadge: string;
}

/** «Русский» -> «RU», «Английский» -> «EN», и т.п. */
function languageCode(name: string): string {
  const map: Record<string, string> = {
    Русский: 'RU',
    Английский: 'EN',
    Немецкий: 'DE',
    Французский: 'FR',
    Испанский: 'ES',
    Итальянский: 'IT',
    Китайский: 'ZH',
    Японский: 'JA',
    Корейский: 'KO',
    Португальский: 'PT',
    Турецкий: 'TR',
    Польский: 'PL',
    Украинский: 'UA',
    Арабский: 'AR',
  };
  if (map[name]) return map[name];
  const ascii = name.replace(/[^A-Za-zА-Яа-яЁё]/g, '').slice(0, 2);
  return ascii.toUpperCase();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTags(items: string[]): string {
  return items.map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join('');
}

function jobsToCards(model: ResumeModel): JobCardPage[] {
  return model.experience.map((exp) => {
    const all = [...exp.achievements];
    let duties = all.slice(0, Math.max(1, all.length - 2));
    let achievements = all.slice(duties.length);
    if (achievements.length === 0 && duties.length > 1) {
      achievements = [duties[duties.length - 1]];
      duties = duties.slice(0, duties.length - 1);
    }
    return {
    company: exp.company,
    position: exp.position,
    period: exp.period,
    project: exp.project,
      duties,
      achievements,
      stack: exp.stack
        ? exp.stack.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    };
  });
}

function deriveView(candidate: Candidate, model: ResumeModel): DerivedView {
  const expLabel = calcExperienceLabel(
    (candidate.experience ?? []).map((e) => ({ startMonth: e.startMonth, endMonth: e.endMonth })),
  );
  const stackMain = candidate.stack.slice(0, 3).join(' / ');
  const stackBadge = candidate.grade;
  void model;
  return { experienceLabel: expLabel, stackMain, stackBadge };
}

function buildPageOneHtml(candidate: Candidate, model: ResumeModel, view: DerivedView, totalPages: number): string {
  const badges: string[] = [`<span class="badge dark">${escapeHtml(view.experienceLabel)}</span>`];
  if (model.location) badges.push(`<span class="badge">${escapeHtml(model.location)}</span>`);
  if (model.birthday) badges.push(`<span class="badge">${escapeHtml(model.birthday)}</span>`);
  if (view.stackMain) badges.push(`<span class="badge">${escapeHtml(view.stackMain)}</span>`);
  if (view.stackBadge) badges.push(`<span class="badge">${escapeHtml(view.stackBadge)}</span>`);

  const educationHtml = model.education
    .map((edu) => {
      const sub = [edu.degree, edu.specialty].filter(Boolean).join(' - ');
      return `<div class="edu"><div><b>${escapeHtml(edu.institutionLine)}</b><span>${escapeHtml(sub)}</span></div></div>`;
    })
    .join('');

  const certsHtml = model.certifications
    .map((c) => `<span class="cert">${escapeHtml(c.line)}</span>`)
    .join('');

  const langsHtml = (candidate.languages ?? [])
    .map((l) => {
      const level = l.level === 'родной' ? 'Родной' : l.level;
      return `<div class="lang-item"><div class="lang-icon">${escapeHtml(languageCode(l.language))}</div><div><div class="lang-name">${escapeHtml(l.language)}</div><div class="lang-level">${escapeHtml(level)}</div></div></div>`;
    })
    .join('');

  const logo = `<img src="${LACHEVSKY_LOGO_DATA_URL}" alt="Lachevsky Group" style="width:140px;height:auto;">`;

  return `<div class="page">
    <div class="header">
      <div>
        <div class="h-name">${escapeHtml(model.fullName)}</div>
        <div class="h-role-wrap">${escapeHtml(model.position)}</div>
        <div class="badges">${badges.join('')}</div>
      </div>
      <div>${logo}</div>
    </div>

    ${candidate.stack.length > 0 ? `<div class="sec"><div class="sec-t">Стек</div><div class="sec-l"></div></div><div class="tags">${renderTags(candidate.stack)}</div>` : ''}
    ${model.education.length > 0 ? `<div class="sec"><div class="sec-t">Образование</div><div class="sec-l"></div></div>${educationHtml}` : ''}
    ${model.certifications.length > 0 ? `<div class="sec"><div class="sec-t">Сертификаты</div><div class="sec-l"></div></div>${certsHtml}` : ''}
    ${(candidate.languages?.length ?? 0) > 0 ? `<div class="sec"><div class="sec-t">Языки</div><div class="sec-l"></div></div><div class="lang-row">${langsHtml}</div>` : ''}
    ${model.summary ? `<div class="sec"><div class="sec-t">Сопроводительное письмо</div><div class="sec-l"></div></div><div class="cover"><div class="cover-body">${escapeHtml(model.summary)}</div></div>` : ''}

    <div class="foot"><span>LACHEVSKY GROUP</span><span>1 / ${totalPages}</span></div>
  </div>`;
}

function buildJobPageHtml(card: JobCardPage, experienceLabel: string, pageNum: number, totalPages: number): string {
  const duties = card.duties.map((d) => `<li>${escapeHtml(d)}</li>`).join('');
  const achievements = card.achievements.map((a) => `<li>${escapeHtml(a)}</li>`).join('');
  const logoMini = `<img src="${LACHEVSKY_LOGO_DATA_URL}" alt="Lachevsky Group" style="width:100px;height:auto;">`;
  return `<div class="page page-break">
    <div class="mini-head">
      <div>
        <div class="mh-role">Опыт работы</div>
        <div class="mh-sub">Общий стаж: ${escapeHtml(experienceLabel)}</div>
      </div>
      ${logoMini}
    </div>

    <div class="job">
      <div class="job-company">${escapeHtml(card.company)}</div>
      <div class="job-head">
        <div class="job-pos">${escapeHtml(card.position)}</div>
        <div class="job-dates">${escapeHtml(card.period)}</div>
      </div>
      ${card.project ? `<div class="job-project">Проект: ${escapeHtml(card.project)}</div>` : ''}
      ${duties ? `<div class="lbl">КЛЮЧЕВЫЕ ЗАДАЧИ</div><ul>${duties}</ul>` : ''}
      ${achievements ? `<div class="lbl">ДОСТИЖЕНИЯ</div><ul>${achievements}</ul>` : ''}
      ${card.stack.length > 0 ? `<div class="lbl">СТЕК</div><div class="tags">${renderTags(card.stack)}</div>` : ''}
    </div>

    <div class="foot"><span>LACHEVSKY GROUP</span><span>${pageNum} / ${totalPages}</span></div>
  </div>`;
}

function buildResumeHtml(candidate: Candidate, model: ResumeModel, view: DerivedView): string {
  const cards = jobsToCards(model);
  const totalPages = 1 + cards.length;
  const pages = [
    buildPageOneHtml(candidate, model, view, totalPages),
    ...cards.map((card, idx) => buildJobPageHtml(card, view.experienceLabel, idx + 2, totalPages)),
  ].join('');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(resumeFileName(candidate, 'pdf'))}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Inter', sans-serif; font-size: 13px; color: #1A1A2E; background: #fff; line-height: 1.55; }
    .page { width: 210mm; min-height: 297mm; padding: 36px 46px 28px; margin: 0 auto; position: relative; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .page-break { page-break-before: always; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 1.5px solid #E0E1E8; margin-bottom: 24px; }
    .h-name { font-size: 30px; font-weight: 700; color: #0B0B1F; margin-bottom: 6px; line-height: 1.1; }
    .h-role-wrap { display: inline-block; background: #0B0B1F; color: #fff; padding: 5px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-bottom: 12px; }
    .badges { display: flex; gap: 7px; flex-wrap: wrap; }
    .badge { padding: 5px 14px; border-radius: 20px; font-size: 11px; font-weight: 600; background: #EEEEF5; color: #4A4A65; }
    .badge.dark { background: #0B0B1F; color: #fff; }
    .sec { display: flex; align-items: center; gap: 12px; margin: 22px 0 12px; }
    .sec-t { font-size: 10px; font-weight: 700; letter-spacing: 1.8px; color: #9A9AB0; text-transform: uppercase; white-space: nowrap; }
    .sec-l { flex: 1; height: 1px; background: #E0E1E8; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { padding: 4px 12px; border-radius: 6px; font-size: 11px; font-weight: 500; background: #EEEEF5; color: #3A3A55; border: 1px solid #D8D9E5; }
    .edu { display: flex; align-items: center; gap: 14px; background: #F5F6F8; border-radius: 10px; padding: 13px 18px; margin-bottom: 10px; }
    .edu b { font-size: 12.5px; color: #0B0B1F; display: block; }
    .edu span { font-size: 11.5px; color: #7A7A95; }
    .cert { display: inline-flex; align-items: center; gap: 7px; background: #EEF5FF; border: 1px solid #C4D8F0; border-radius: 8px; padding: 7px 14px; font-size: 11.5px; color: #2A5A8A; font-weight: 500; margin-bottom: 6px; margin-right: 6px; }
    .lang-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 4px; }
    .lang-item { display: flex; align-items: center; gap: 10px; background: #F5F6F8; border-radius: 8px; padding: 10px 16px; }
    .lang-icon { width: 32px; height: 32px; background: #0B0B1F; color: #fff; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
    .lang-name { font-size: 12.5px; font-weight: 600; color: #0B0B1F; }
    .lang-level { font-size: 11px; color: #7A7A95; }
    .cover { background: #F8F8FB; border-radius: 12px; padding: 28px 32px; border: 1px solid #E8E9ED; margin-top: 4px; }
    .cover-body { font-size: 13px; color: #2A2A3F; line-height: 1.85; }
    .mini-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 1.5px solid #E0E1E8; margin-bottom: 22px; }
    .mini-head .mh-role { font-size: 16px; font-weight: 700; color: #0B0B1F; }
    .mini-head .mh-sub { font-size: 11px; color: #9A9AB0; margin-top: 2px; }
    .job { background: #F8F8FB; border-radius: 11px; padding: 18px 20px; border: 1px solid #E8E9ED; }
    .job-company { font-size: 13px; font-weight: 700; color: #0B0B1F; margin-bottom: 3px; }
    .job-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 8px; }
    .job-pos { font-size: 12.5px; font-weight: 600; color: #4A4A65; }
    .job-dates { font-size: 11.5px; font-weight: 600; color: #4A4A65; white-space: nowrap; }
    .job-project { font-size: 11.5px; color: #6B6B85; margin-bottom: 8px; font-style: italic; }
    .lbl { font-size: 9px; font-weight: 700; letter-spacing: 1.4px; color: #B0B0C8; text-transform: uppercase; margin: 10px 0 5px; }
    ul { list-style: disc outside; padding-left: 18px; margin-bottom: 6px; }
    li { font-size: 11.5px; color: #3A3A55; margin-bottom: 2px; line-height: 1.5; }
    .foot { position: absolute; left: 46px; right: 46px; bottom: 28px; border-top: 1px solid #E0E1E8; padding-top: 8px; display: flex; justify-content: space-between; }
    .foot span { font-size: 9.5px; color: #C8C8D8; font-weight: 600; letter-spacing: 1.2px; text-transform: uppercase; }
    @page { size: A4; margin: 0; }
    @media print {
      body { margin: 0; }
      .page { margin: 0; }
    }
  </style>
</head>
<body>
  ${pages}
  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.focus();
        window.print();
      }, 450);
    });
  </script>
</body>
</html>`;
}

export async function downloadResumePdf(candidate: Candidate): Promise<void> {
  const model = buildResumeModel(candidate);
  const view = deriveView(candidate, model);
  const html = buildResumeHtml(candidate, model, view);

  const win = window.open('', '_blank');
  if (!win) {
    throw new Error('Popup blocked');
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
