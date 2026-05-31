import { useState } from 'react';
import { Clock, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useMatchScore, useScoreMatch, useScorePreview } from './hooks';
import type { MatchRecommendation, MatchScore, UUID, VacancyCandidate } from '@/api/types';

/**
 * AI-чип соответствия кандидата вакансии. Живёт в строке прикреплённого
 * кандидата (MatchCompensationRow), слева от бейджа маржи.
 *
 * Состояния:
 *   • есть скор   → цветная пилюля со счётом (клик — раскрыть разбивку);
 *   • устарело    → к пилюле значок «часы» (данные изменились);
 *   • не считали  → кнопка-призрак «Оценить» (клик — посчитать);
 *   • идёт расчёт → спиннер.
 */

const REC_CLASS: Record<MatchRecommendation, string> = {
  strong: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  good: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  weak: 'bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  mismatch: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

const REC_LABEL: Record<MatchRecommendation, string> = {
  strong: 'отлично подходит',
  good: 'подходит',
  weak: 'подходит частично',
  mismatch: 'не подходит',
};

const CRITERION_LABEL: Record<string, string> = {
  stack: 'Стек',
  relevance: 'Релевантность',
  grade: 'Грейд',
  experience: 'Опыт',
  format: 'Формат',
};

interface BadgeProps {
  vacancyId: UUID;
  candidateId: UUID;
  match?: VacancyCandidate;
  expanded: boolean;
  onToggle: () => void;
}

export function AiScoreBadge({ vacancyId, candidateId, match, expanded, onToggle }: BadgeProps) {
  const scoreMutation = useScoreMatch();
  const scoring = scoreMutation.isPending;

  const score = match?.aiScore ?? null;
  const recommendation = match?.aiRecommendation ?? null;
  const stale = !!match?.aiScoredAt && match?.aiModel === 'cheap'; // cheap = без LLM, стоит пересчитать

  const runScore = (force: boolean) => {
    scoreMutation.mutate(
      { vacancyId, candidateId, force },
      {
        onError: () =>
          toast.error('Не удалось посчитать AI-оценку. Попробуйте позже.'),
      },
    );
  };

  if (scoring) {
    return (
      <span className="inline-flex h-6 min-w-[44px] items-center justify-center rounded-md bg-muted px-1.5">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </span>
    );
  }

  if (score === null || recommendation === null) {
    return (
      <button
        type="button"
        onClick={() => runScore(false)}
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        title="Оценить соответствие вакансии (AI)"
      >
        <Sparkles className="h-3.5 w-3.5" />
        Оценить
      </button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`AI-оценка ${score} из 100 — ${REC_LABEL[recommendation]}`}
          className={`tnum inline-flex h-6 min-w-[44px] cursor-pointer items-center justify-center gap-1 rounded-md px-1.5 text-[11.5px] font-semibold ${REC_CLASS[recommendation]}`}
        >
          <Sparkles className="h-3 w-3" />
          {score}
          {stale && <Clock className="h-3 w-3 opacity-70" />}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">
        <div className="font-semibold">AI-оценка: {score}/100</div>
        <div className="text-muted-foreground">{REC_LABEL[recommendation]}</div>
        {stale && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Без AI (оценка приблизительная). Нажмите, затем «Пересчитать».
          </div>
        )}
        <div className="mt-1 text-[10px] text-muted-foreground">
          Нажмите, чтобы раскрыть разбивку
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

interface BreakdownProps {
  vacancyId: UUID;
  candidateId: UUID;
  open: boolean;
}

export function AiScoreBreakdown({ vacancyId, candidateId, open }: BreakdownProps) {
  const { data, isLoading, isError } = useMatchScore(vacancyId, candidateId, open);
  const scoreMutation = useScoreMatch();

  if (!open) return null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 border-t px-3 py-2 text-[11.5px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка разбивки…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="border-t px-3 py-2 text-[11.5px] text-muted-foreground">
        Разбивка недоступна.
      </div>
    );
  }

  const recalc = () =>
    scoreMutation.mutate(
      { vacancyId, candidateId, force: true },
      { onError: () => toast.error('Не удалось пересчитать.') },
    );

  const criteria = Object.entries(data.breakdown);

  return (
    <div className="border-t px-3 py-2.5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[20px] font-semibold leading-none">{data.score}</span>
        <span className="text-[11px] text-muted-foreground">/ 100</span>
        {!data.aiEnriched && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            без AI
          </span>
        )}
        <button
          type="button"
          onClick={recalc}
          disabled={scoreMutation.isPending}
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {scoreMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Пересчитать
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {criteria.map(([key, c]) => (
          <div key={key} className="flex items-start gap-2 text-[11.5px]">
            <span className="w-[92px] shrink-0 text-muted-foreground">
              {CRITERION_LABEL[key] ?? key}
            </span>
            <span className="tnum w-[52px] shrink-0 text-right font-semibold tabular-nums">
              {c.score}
              <span className="text-[10px] font-normal text-muted-foreground">/100</span>
            </span>
            <span className="flex-1 text-[11px] leading-snug text-muted-foreground">
              {c.note}
            </span>
          </div>
        ))}
      </div>

      {data.summary && (
        <div className="mt-2 border-t pt-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {data.summary}
        </div>
      )}

      {(data.strengths.length > 0 || data.gaps.length > 0) && (
        <div className="mt-2 grid grid-cols-2 gap-3">
          {data.strengths.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
                Сильные стороны
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {data.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {data.gaps.length > 0 && (
            <div>
              <div className="mb-1 text-[10.5px] font-medium text-amber-700 dark:text-amber-300">
                Пробелы
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {data.gaps.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Краткая разбивка для тултипа превью-чипа. */
function PreviewTooltip({ data }: { data: MatchScore }) {
  return (
    <div className="space-y-1">
      <div className="font-semibold">
        AI-оценка: {data.score}/100 — {REC_LABEL[data.recommendation]}
      </div>
      {!data.aiEnriched && (
        <div className="text-[10px] text-muted-foreground">приблизительно, без AI</div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pt-0.5">
        {Object.entries(data.breakdown).map(([key, c]) => (
          <PreviewRow key={key} label={CRITERION_LABEL[key] ?? key} score={c.score} note={c.note} />
        ))}
      </div>
      {data.summary && (
        <div className="border-t pt-1 text-[11px] leading-snug text-muted-foreground">
          {data.summary}
        </div>
      )}
    </div>
  );
}

function PreviewRow({ label, score, note }: { label: string; score: number; note: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum">
        {score}
        {note ? <span className="text-muted-foreground"> · {note}</span> : null}
      </span>
    </>
  );
}

interface PreviewProps {
  vacancyId: UUID;
  candidateId: UUID;
}

/**
 * Превью-чип AI-оценки кандидата под вакансию ДО прикрепления (on-demand).
 * Ничего не пишет в БД — дёргает /score-preview лениво по клику. Используется
 * в диалоге подбора и в базе кандидатов под выбранную вакансию.
 */
export function AiPreviewBadge({ vacancyId, candidateId }: PreviewProps) {
  const [enabled, setEnabled] = useState(false);
  const { data, isFetching, isError } = useScorePreview(vacancyId, candidateId, enabled);

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEnabled(true);
        }}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Оценить соответствие вакансии (AI)"
      >
        <Sparkles className="h-3 w-3" />
        AI
      </button>
    );
  }

  if (isFetching) {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5">
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      </span>
    );
  }

  if (isError || !data) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEnabled(false);
          setTimeout(() => setEnabled(true), 0);
        }}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-muted-foreground hover:bg-muted"
        title="Не удалось посчитать — повторить"
      >
        <RefreshCw className="h-3 w-3" /> ещё раз
      </button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`tnum inline-flex h-[18px] min-w-[40px] cursor-default items-center justify-center gap-1 rounded-md px-1 text-[10.5px] font-semibold ${REC_CLASS[data.recommendation]}`}
          aria-label={`AI-оценка ${data.score} из 100`}
        >
          <Sparkles className="h-2.5 w-2.5" />
          {data.score}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]">
        <PreviewTooltip data={data} />
      </TooltipContent>
    </Tooltip>
  );
}
