/**
 * DOCX-выгрузка отчёта AI-скрининга (Этап 5).
 * Паттерн как у generateResumeDocxBlob — Packer.toBlob на клиенте.
 */
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import type { ScreeningReport, ScreeningSession, ScreeningVerdict } from '@/api/screenings';

const FONT = 'Arial';
const SIZE_TITLE = 32;
const SIZE_HEADING = 24;
const SIZE_BODY = 22;

const VERDICT_LABEL: Record<ScreeningVerdict, string> = {
  fit: 'Подходит',
  partial_fit: 'Частично подходит',
  no_fit: 'Не подходит',
};

const SCORE_LABELS: Record<string, string> = {
  communication: 'Коммуникация',
  motivation: 'Мотивация',
  hard_skills: 'Hard skills',
  experience_fit: 'Релевантный опыт',
  culture_fit: 'Культурный fit',
};

function r(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    size: opts.size ?? SIZE_BODY,
    font: FONT,
  });
}

function p(children: TextRun | TextRun[], spacingAfter = 80): Paragraph {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: { after: spacingAfter },
  });
}

function heading(title: string): Paragraph {
  return new Paragraph({
    children: [r(title, { bold: true, size: SIZE_HEADING })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
  });
}

export function screeningReportFileName(session: ScreeningSession): string {
  const name = (session.candidateName ?? 'кандидат').replace(/[\\/:*?"<>|]+/g, '_');
  const date = session.endedAt
    ? new Date(session.endedAt).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return `Скрининг_${name}_${date}.docx`;
}

export async function generateScreeningReportDocxBlob(
  session: ScreeningSession,
  report: ScreeningReport,
): Promise<Blob> {
  const children: Paragraph[] = [
    p(r('Отчёт AI-скрининга', { bold: true, size: SIZE_TITLE }), 120),
    p([
      r('Кандидат: ', { bold: true }),
      r(session.candidateName ?? session.candidateId),
    ]),
  ];
  if (session.vacancyTitle) {
    children.push(p([r('Вакансия: ', { bold: true }), r(session.vacancyTitle)]));
  }
  if (session.durationSec != null) {
    const m = Math.floor(session.durationSec / 60);
    const s = session.durationSec % 60;
    children.push(p([r('Длительность: ', { bold: true }), r(`${m} мин ${s} с`)]));
  }
  children.push(
    p([r('Вердикт: ', { bold: true }), r(VERDICT_LABEL[report.verdict])], 160),
    heading('Резюме беседы'),
    p(r(report.summary), 120),
  );

  if (report.scores && Object.keys(report.scores).length > 0) {
    children.push(heading('Оценки по компетенциям'));
    for (const [key, val] of Object.entries(report.scores)) {
      const label = SCORE_LABELS[key] ?? key;
      const note = val.note ? ` — ${val.note}` : '';
      children.push(p(r(`${label}: ${val.score}/5${note}`)));
    }
  }

  if (report.redFlags && report.redFlags.length > 0) {
    children.push(heading('Красные флаги'));
    for (const flag of report.redFlags) {
      children.push(p(r(`- ${flag}`)));
    }
  }

  if (report.recommendation) {
    children.push(heading('Рекомендация'), p(r(report.recommendation)));
  }

  const answered = session.questions.filter((q) => q.status === 'answered');
  if (answered.length > 0) {
    children.push(heading('Отвеченные вопросы'));
    for (const q of answered) {
      children.push(p(r(q.text, { bold: true }), 40));
      if (q.answerSummary) {
        children.push(p(r(`Ответ: ${q.answerSummary}`), 100));
      }
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
