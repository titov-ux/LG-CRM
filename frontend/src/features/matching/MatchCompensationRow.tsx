import { ChevronRight, FileDown, Loader2, Sparkles, X } from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { pairSupportsMargin } from '@/lib/compensation';
import { MarginBadge } from './MarginBadge';
import type { Candidate, Vacancy } from '@/api/types';

interface Props {
  vacancy: Vacancy;
  candidate: Candidate;
  hoursPerMonth: number;
  onOpen: () => void;
  onDetach: () => void;
  detachDisabled?: boolean;
  /** Скачать резюме как есть (DOCX). */
  onDownloadOriginal: () => void;
  /** Сгенерировать AI-адаптированную под эту вакансию версию и скачать (DOCX). */
  onDownloadImproved: () => void;
  /**
   * В процессе AI-генерации этого конкретного кандидата — крутим спиннер
   * на кнопке скачивания и блокируем меню, чтобы не плодить дубль-запросы.
   */
  improving?: boolean;
}

export function MatchCompensationRow({
  vacancy,
  candidate,
  hoursPerMonth,
  onOpen,
  onDetach,
  detachDisabled,
  onDownloadOriginal,
  onDownloadImproved,
  improving,
}: Props) {
  // В агентской модели маржа бессмысленна: LG получает разовый fee,
  // а не платит кандидату ежемесячно. Маржу показываем только для outstaff-пары.
  const showMargin = pairSupportsMargin(vacancy, candidate);

  return (
    <div className="group flex items-center rounded-md border bg-muted/30 hover:bg-muted">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <UserAvatar
          user={{
            fullName: candidate.fullName,
            initials: candidate.fullName.split(' ').map((p) => p[0]).slice(0, 2).join(''),
            color: '#475569',
          }}
          size={26}
        />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{candidate.fullName}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {candidate.role} · {candidate.employmentType}
          </div>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-2 pr-2">
        {showMargin && (
          <MarginBadge
            vacancy={vacancy}
            candidate={candidate}
            hoursPerMonth={hoursPerMonth}
            size="md"
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={improving}
              aria-label={`Скачать резюме ${candidate.fullName}`}
              title="Скачать резюме"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 disabled:cursor-not-allowed"
            >
              {improving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuItem onSelect={onDownloadOriginal} disabled={improving}>
              <FileDown className="mr-2 h-3.5 w-3.5" />
              Скачать в исходном виде
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDownloadImproved} disabled={improving}>
              <Sparkles className="mr-2 h-3.5 w-3.5 text-amber-500" />
              <div className="flex flex-col gap-0.5">
                <span>Скачать в улучшенном виде</span>
                <span className="text-[11px] text-muted-foreground">
                  AI адаптирует резюме под вакансию
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={onDetach}
          disabled={detachDisabled}
          aria-label={`Открепить ${candidate.fullName}`}
          title="Открепить от вакансии"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}
