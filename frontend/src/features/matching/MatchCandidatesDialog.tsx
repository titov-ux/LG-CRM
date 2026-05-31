import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/common/UserAvatar';
import { StackTags } from '@/components/common/StackTags';
import { cn } from '@/lib/utils';
import { useAttachCandidate, useRankCandidates } from './hooks';
import type { MatchRecommendation, RankedCandidate, Vacancy } from '@/api/types';

/**
 * Подбор кандидатов из базы под вакансию: ранжирование по соответствию.
 * Быстрый режим — детерминированный скоринг (мгновенно). Тумблер «Уточнить ИИ»
 * дообогащает верхние результаты оценкой релевантности от LLM.
 */

const REC_CLASS: Record<MatchRecommendation, string> = {
  strong: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  good: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  weak: 'bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  mismatch: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

const CRITERION_LABEL: Record<string, string> = {
  stack: 'Стек',
  relevance: 'Релевантность',
  grade: 'Грейд',
  experience: 'Опыт',
  format: 'Формат',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vacancy: Vacancy;
}

export function MatchCandidatesDialog({ open, onOpenChange, vacancy }: Props) {
  const [enrich, setEnrich] = useState(false);
  const { data, isFetching, isError, refetch } = useRankCandidates(vacancy.id, {
    limit: 20,
    enrich,
    enabled: open,
  });
  const attach = useAttachCandidate();

  const handleAttach = (candidateId: string, name: string) => {
    attach.mutate(
      { vacancyId: vacancy.id, candidateId },
      {
        onSuccess: () => {
          toast.success(`${name} прикреплён к вакансии`);
          refetch();
        },
        onError: () => toast.error('Не удалось прикрепить кандидата'),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-3 p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center justify-between gap-3 text-[15px]">
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Подбор кандидатов под «{vacancy.title}»
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 text-[11.5px] font-normal text-muted-foreground">
              <Switch checked={enrich} onCheckedChange={setEnrich} />
              Уточнить ИИ
            </label>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[520px] space-y-1.5 overflow-y-auto px-5 pb-5">
          {isFetching && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {enrich ? 'Считаем оценки ИИ…' : 'Ранжируем базу…'}
            </div>
          )}

          {!isFetching && isError && (
            <div className="py-10 text-center text-xs text-muted-foreground">
              Не удалось подобрать кандидатов.
            </div>
          )}

          {!isFetching && !isError && (data?.length ?? 0) === 0 && (
            <div className="py-10 text-center text-xs text-muted-foreground">
              Подходящих кандидатов в базе не нашлось.
            </div>
          )}

          {!isFetching && !isError && (data?.length ?? 0) > 0 && (
            <TooltipProvider delayDuration={150}>
              {data!.map((c, i) => (
                <RankRow
                  key={c.candidateId}
                  rank={i + 1}
                  candidate={c}
                  pending={attach.isPending}
                  onAttach={() => handleAttach(c.candidateId, c.fullName)}
                />
              ))}
            </TooltipProvider>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface RowProps {
  rank: number;
  candidate: RankedCandidate;
  pending: boolean;
  onAttach: () => void;
}

function RankRow({ rank, candidate: c, pending, onAttach }: RowProps) {
  const initials = c.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');

  return (
    <div className="group flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 hover:bg-muted/40">
      <span className="w-5 shrink-0 text-center text-[12px] font-medium tabular-nums text-muted-foreground">
        {rank}
      </span>

      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'tnum inline-flex h-7 min-w-[40px] cursor-default items-center justify-center gap-1 rounded-md px-1.5 text-[12px] font-semibold',
              REC_CLASS[c.recommendation],
            )}
          >
            <Sparkles className="h-3 w-3" />
            {c.score}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px]">
          <div className="space-y-1">
            <div className="font-semibold">AI-оценка: {c.score}/100</div>
            {!c.aiEnriched && (
              <div className="text-[10px] text-muted-foreground">
                быстрая оценка · включите «Уточнить ИИ»
              </div>
            )}
            <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pt-0.5">
              {Object.entries(c.breakdown).map(([key, cr]) => (
                <div key={key} className="contents">
                  <span className="text-muted-foreground">{CRITERION_LABEL[key] ?? key}</span>
                  <span className="tnum">
                    {cr.score}
                    {cr.note ? <span className="text-muted-foreground"> · {cr.note}</span> : null}
                  </span>
                </div>
              ))}
            </div>
            {c.summary && (
              <div className="border-t pt-1 text-[11px] leading-snug text-muted-foreground">
                {c.summary}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>

      <UserAvatar
        user={{ fullName: c.fullName, initials, color: '#475569' }}
        size={26}
        interactive={false}
      />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold leading-tight">{c.fullName}</div>
        <div className="truncate text-[11.5px] text-muted-foreground">
          {c.role}
          {c.grade ? ` · ${c.grade}` : ''}
        </div>
        {c.stack.length > 0 && (
          <div className="mt-1">
            <StackTags stack={c.stack} max={5} variant="accent" singleLine />
          </div>
        )}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 px-2.5 text-xs opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 data-[pending=true]:opacity-100"
        data-pending={pending}
        onClick={onAttach}
        disabled={pending}
      >
        Прикрепить
      </Button>
    </div>
  );
}
