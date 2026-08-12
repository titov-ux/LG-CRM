import { useState } from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ScreeningReport, ScreeningSession, ScreeningVerdict } from '@/api/screenings';

const VERDICT_META: Record<
  ScreeningVerdict,
  { label: string; className: string }
> = {
  fit: { label: 'Подходит', className: 'bg-emerald-500/10 text-emerald-700' },
  partial_fit: {
    label: 'Частично',
    className: 'bg-amber-500/10 text-amber-700',
  },
  no_fit: { label: 'Не подходит', className: 'bg-red-500/10 text-red-700' },
};

const SCORE_LABELS: Record<string, string> = {
  communication: 'Коммуникация',
  motivation: 'Мотивация',
  hard_skills: 'Hard skills',
  experience_fit: 'Опыт',
  culture_fit: 'Культурный fit',
};

/**
 * Скачивание DOCX. Ссылку обязательно добавляем в DOM (вне Chrome click() по
 * detached-элементу игнорируется), а revoke откладываем — иначе Safari/Firefox
 * успевают отменить загрузку.
 *
 * `docx` весит немало, а панель рендерится в карточке кандидата у всех — грузим
 * генератор динамически, только когда действительно жмут «DOCX».
 */
async function downloadReport(session: ScreeningSession, report: ScreeningReport) {
  const { generateScreeningReportDocxBlob, screeningReportFileName } = await import(
    './generateReportDocx'
  );
  const blob = await generateScreeningReportDocxBlob(session, report);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = screeningReportFileName(session);
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}

const STATUS_HINT: Partial<Record<ScreeningSession['status'], string>> = {
  draft: 'Встреча ещё не начиналась — отчёт появится после её завершения.',
  live: 'Встреча идёт — AI-отчёт будет готов после завершения.',
};

export function ScreeningReportPanel({
  session,
  compact = false,
}: {
  session: ScreeningSession;
  compact?: boolean;
}) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async (report: ScreeningReport) => {
    setDownloading(true);
    try {
      await downloadReport(session, report);
    } catch {
      toast.error('Не удалось сформировать DOCX-отчёт');
    } finally {
      setDownloading(false);
    }
  };

  /** Кнопка выгрузки — нужна и в обычной панели, и в ветке `status=error`. */
  const docxButton = (report: ScreeningReport, className?: string) => (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className ?? 'h-7 gap-1 px-2 text-[11px]'}
      onClick={() => void handleDownload(report)}
      disabled={downloading}
      aria-label="Скачать отчёт в формате DOCX"
    >
      {downloading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FileDown className="h-3.5 w-3.5" />
      )}
      {downloading ? 'Готовим…' : 'DOCX'}
    </Button>
  );

  const statusHint = STATUS_HINT[session.status];
  if (statusHint) {
    return <div className="text-[12px] text-muted-foreground">{statusHint}</div>;
  }

  if (session.status === 'processing') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[12px] text-amber-900">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        {session.audioFileId
          ? 'Распознаём запись и готовим AI-отчёт — обычно 1–3 минуты…'
          : 'AI готовит отчёт по встрече — обычно 1–2 минуты…'}
      </div>
    );
  }

  if (session.status === 'error') {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2.5 text-[12px] text-red-800">
          Не удалось сформировать отчёт. Транскрипт и запись сохранены — можно
          оценить встречу вручную.
        </div>
        {/* Пост-анализ мог упасть уже после того, как отчёт сохранился (или на
            повторном прогоне) — не лишаем выгрузки только из-за статуса. */}
        {session.report && docxButton(session.report)}
      </div>
    );
  }

  const report = session.report;
  if (!report) {
    return (
      <div className="text-[12px] text-muted-foreground">Отчёт пока недоступен.</div>
    );
  }

  const verdict = VERDICT_META[report.verdict];
  const scores = report.scores ? Object.entries(report.scores) : [];

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className={verdict.className}>
          {verdict.label}
        </Badge>
        {!compact && session.vacancyTitle && (
          <span className="text-[11.5px] text-muted-foreground">{session.vacancyTitle}</span>
        )}
        {docxButton(report, 'ml-auto h-7 gap-1 px-2 text-[11px]')}
      </div>

      <p className="text-[12.5px] leading-snug text-foreground/90">{report.summary}</p>

      {scores.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {scores.map(([key, val]) => (
            <div
              key={key}
              className="rounded-md border bg-muted/20 px-2.5 py-1.5 text-[11.5px]"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{SCORE_LABELS[key] ?? key}</span>
                <span className="tnum tabular-nums text-muted-foreground">{val.score}/5</span>
              </div>
              {val.note ? (
                <div className="mt-0.5 text-muted-foreground">{val.note}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {report.redFlags && report.redFlags.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Красные флаги
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-[12px] text-red-800/90">
            {report.redFlags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {report.recommendation && (
        <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[12px] leading-snug">
          <span className="font-medium">Рекомендация: </span>
          {report.recommendation}
        </div>
      )}
    </div>
  );
}
