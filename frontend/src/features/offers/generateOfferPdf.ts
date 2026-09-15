/**
 * Рендер job-оффера в HTML и скачивание PDF.
 *
 * HTML собирается по брендированному шаблону Lachevsky Group (см. дизайн
 * в docs/у заказчика: offer-lg.html) и отправляется на бэкенд
 * POST /files/render-pdf, где Playwright печатает страницу в A4.
 * Шрифт Golos Text тянется с Google Fonts — бэкенд ждёт networkidle,
 * поэтому веб-шрифты в PDF попадают корректно.
 */
import { filesApi } from '@/api/files';
import { formatMoneyRub } from '@/lib/utils';
import { offerDateRu, offerFileName, type OfferModel } from './offerModel';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const LOGO_SVG = `<svg width="30" height="30" viewBox="0 0 37 37" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Логотип Lachevsky Group">
  <path d="M37 31.7143V37H0L0 0L5.28571 0L5.28571 31.7143L37 31.7143Z" fill="currentColor"/>
  <path d="M10.5714 26.4286L10.5714 0L37 0V5.28571L15.8571 5.28571L15.8571 21.1429H31.7143V15.8571H21.1429V10.5714H37V26.4286L10.5714 26.4286Z" fill="currentColor"/>
</svg>`;

function termRow(dt: string, dd: string, note?: string): string {
  const noteHtml = note ? `<span class="note">${escapeHtml(note)}</span>` : '';
  return `<div><dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}${noteHtml}</dd></div>`;
}

export function buildOfferHtml(model: OfferModel): string {
  const dateLabel = offerDateRu(model.date);
  const startLabel = offerDateRu(model.startDate);
  const validLabel = offerDateRu(model.validUntil);

  const terms: string[] = [];
  if (model.fullName) terms.push(termRow('Кандидат', model.fullName));
  if (model.position) terms.push(termRow('Должность', model.position));
  if (model.project) terms.push(termRow('Проект', model.project));
  if (model.reportsTo) terms.push(termRow('Подчинение', model.reportsTo));
  if (model.workFormat) terms.push(termRow('Формат работы', model.workFormat));
  if (model.employment) {
    terms.push(
      termRow(
        'Оформление',
        model.employment,
        model.probation ? `Испытательный срок: ${model.probation}` : undefined,
      ),
    );
  }
  if (startLabel) terms.push(termRow('Дата выхода', startLabel));

  const compItems: string[] = [];
  if (model.salaryAfterProbation) {
    compItems.push(
      `<li>Оклад после испытательного срока <b>${formatMoneyRub(model.salaryAfterProbation)}&nbsp;₽ на руки</b></li>`,
    );
  }
  if (model.bonus.trim()) {
    compItems.push(`<li>Премия <b>${escapeHtml(model.bonus.trim())}</b></li>`);
  }

  const benefits = model.benefits.map((b) => b.trim()).filter(Boolean);

  const greetName = model.firstName.trim() || model.fullName.trim().split(/\s+/)[0] || '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>Предложение о работе — Lachevsky Group</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&display=swap">
<style>
  :root {
    --paper: #FFFFFF;
    --ink: #14171A;
    --accent: #0A47A9;
    --muted: #5D6570;
    --line: #E4E7EB;
    --sans: 'Golos Text', 'Segoe UI', Arial, sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: A4; margin: 0; }
  html, body { background: var(--paper); }
  body {
    color: var(--ink);
    font-family: var(--sans);
    font-size: 15px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { padding: 16mm 17mm 18mm; }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 22px;
    border-bottom: 3px solid var(--ink);
  }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 700; font-size: 18px; }
  .brand svg { flex-shrink: 0; display: block; }
  .doc-meta { text-align: right; font-size: 12.5px; color: var(--muted); line-height: 1.5; }

  .lead { margin-top: 40px; }
  .lead .date { font-size: 13px; color: var(--muted); margin-bottom: 16px; }
  h1 { font-weight: 600; font-size: 30px; line-height: 1.25; letter-spacing: -0.015em; max-width: 18em; }
  .lead p.intro { margin-top: 20px; max-width: 36em; font-size: 15.5px; }

  section { margin-top: 44px; }
  h2 { font-weight: 600; font-size: 19px; letter-spacing: -0.01em; margin-bottom: 16px; }

  .terms { border-top: 1px solid var(--line); }
  .terms > div {
    display: grid;
    grid-template-columns: 190px 1fr;
    gap: 16px;
    padding: 11px 0;
    border-bottom: 1px solid var(--line);
    break-inside: avoid;
  }
  .terms dt { color: var(--muted); font-size: 14px; padding-top: 1px; }
  .terms dd { font-weight: 500; }
  .terms dd .note { display: block; font-weight: 400; font-size: 13px; color: var(--muted); margin-top: 2px; }

  .comp { margin-top: 48px; padding: 30px 32px 26px; border: 3px solid var(--ink); break-inside: avoid; }
  .comp h2 { margin-bottom: 4px; }
  .comp .gross { font-size: 12.5px; color: var(--muted); margin-bottom: 16px; }
  .comp .amount {
    font-weight: 700;
    font-size: 48px;
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .comp .amount small { font-size: 0.45em; color: var(--muted); font-weight: 500; letter-spacing: 0; margin-left: 6px; }
  .comp ul { list-style: none; margin-top: 20px; border-top: 1px solid var(--line); }
  .comp li {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
    font-size: 14.5px;
  }
  .comp li b { font-weight: 600; text-align: right; max-width: 60%; }

  .benefits { columns: 2; column-gap: 44px; list-style: none; }
  .benefits li { break-inside: avoid; padding: 9px 0 9px 18px; position: relative; font-size: 14.5px; }
  .benefits li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 15px;
    width: 8px;
    height: 8px;
    background: var(--accent);
  }

  .validity {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 3px solid var(--ink);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 40px;
    break-inside: avoid;
  }
  .validity h3 { font-weight: 600; font-size: 15.5px; margin-bottom: 8px; }
  .validity p { font-size: 14px; }
  .validity .until { color: var(--accent); font-weight: 600; }

  .sign {
    margin-top: 56px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 32px;
    break-inside: avoid;
  }
  .sign .who { font-size: 14px; line-height: 1.55; }
  .sign .who b { font-weight: 600; }
  .sign .who .role { color: var(--muted); }
  .sign .contact { text-align: right; font-size: 13px; color: var(--muted); line-height: 1.6; }
  .sign .contact a { color: var(--accent); text-decoration: none; }

  .confidential { margin-top: 44px; font-size: 11.5px; color: var(--muted); max-width: 44em; break-inside: avoid; }
</style>
</head>
<body>
<div class="sheet">

  <header>
    <div class="brand">${LOGO_SVG}</div>
    <div class="doc-meta">
      Предложение о работе<br>
      № ${escapeHtml(model.offerNumber)}
    </div>
  </header>

  <div class="lead">
    <p class="date">${escapeHtml(model.city)}${model.city && dateLabel ? ', ' : ''}${escapeHtml(dateLabel)}</p>
    <h1>${escapeHtml(greetName)}${greetName ? ', п' : 'П'}риглашаем вас присоединиться к команде Lachevsky&nbsp;Group.</h1>
    <p class="intro">${escapeHtml(model.intro)}</p>
  </div>

  <section>
    <h2>Условия</h2>
    <dl class="terms">
      ${terms.join('\n      ')}
    </dl>
  </section>

  <div class="comp">
    <h2>Вознаграждение</h2>
    <p class="gross">оклад в месяц, на руки (после вычета НДФЛ)</p>
    <div class="amount">${model.salaryNet ? formatMoneyRub(model.salaryNet) : '—'}<small>₽</small></div>
    ${compItems.length ? `<ul>\n      ${compItems.join('\n      ')}\n    </ul>` : ''}
  </div>

  ${
    benefits.length
      ? `<section>
    <h2>Что еще входит в предложение</h2>
    <ul class="benefits">
      ${benefits.map((b) => `<li>${escapeHtml(b)}</li>`).join('\n      ')}
    </ul>
  </section>`
      : ''
  }

  <div class="validity">
    <div>
      <h3>Срок действия</h3>
      <p>Предложение действительно до <span class="until">${escapeHtml(validLabel || '—')}</span> включительно. После этой даты условия могут быть пересмотрены.</p>
    </div>
    <div>
      <h3>Как принять</h3>
      <p>Ответьте на письмо с этим предложением или свяжитесь с нами любым удобным способом — и мы подготовим документы к вашей дате выхода.</p>
    </div>
  </div>

  <div class="sign">
    <div class="who">
      <b>${escapeHtml(model.signerName)}</b><br>
      <span class="role">${escapeHtml(model.signerRole)}</span>
    </div>
    <div class="contact">
      <a href="mailto:${escapeHtml(model.contactEmail)}">${escapeHtml(model.contactEmail)}</a><br>
      ${escapeHtml(model.contactPhone)}
    </div>
  </div>

  <p class="confidential">Это предложение носит конфиденциальный характер и адресовано лично кандидату. Оно не является офертой в смысле ст.&nbsp;435 ГК&nbsp;РФ; трудовые отношения возникают с момента заключения трудового договора.</p>

</div>
</body>
</html>`;
}

/** Скачивает PDF оффера через серверный рендер. */
export async function downloadOfferPdf(model: OfferModel): Promise<void> {
  const html = buildOfferHtml(model);
  const filename = offerFileName(model);
  const blob = await filesApi.renderPdf({ html, filename });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
