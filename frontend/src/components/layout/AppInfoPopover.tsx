import { ExternalLink } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  APP_COMMIT,
  APP_ENV,
  APP_RELEASE_DATE,
  APP_VERSION,
  CHANGELOG_URL,
  type AppEnv,
} from '@/lib/constants';

interface AppInfoPopoverProps {
  children: React.ReactNode;
}

const ENV_META: Record<AppEnv, { label: string; className: string }> = {
  dev: { label: 'DEV', className: 'bg-amber-100 text-amber-800 ring-amber-200' },
  stage: { label: 'STAGE', className: 'bg-sky-100 text-sky-800 ring-sky-200' },
  prod: { label: 'PROD', className: 'bg-emerald-100 text-emerald-800 ring-emerald-200' },
};

function copyToClipboard(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    void navigator.clipboard.writeText(text);
  }
}

export function AppInfoPopover({ children }: AppInfoPopoverProps) {
  const env = ENV_META[APP_ENV] ?? ENV_META.dev;
  const supportText = `Версия: ${APP_VERSION}\nРелиз: ${APP_RELEASE_DATE}\nКоммит: ${APP_COMMIT}\nОкружение: ${env.label}`;

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-72 p-0">
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <div className="text-[13px] font-semibold tracking-tight">ЛГ Интеграция · SaaS</div>
            <div className="text-[11px] text-muted-foreground">Информация о сборке</div>
          </div>
          <span
            className={cn(
              'tnum rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1',
              env.className,
            )}
          >
            {env.label}
          </span>
        </div>

        <dl className="space-y-1.5 px-4 py-3 text-[12px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Версия</dt>
            <dd className="tnum font-semibold">{APP_VERSION}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Релиз</dt>
            <dd className="tnum">{APP_RELEASE_DATE}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Коммит</dt>
            <dd className="tnum font-mono text-[11px]">{APP_COMMIT}</dd>
          </div>
        </dl>

        <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <button
            type="button"
            onClick={() => copyToClipboard(supportText)}
            className="text-[11.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Скопировать для саппорта
          </button>
          <a
            href={CHANGELOG_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-foreground hover:underline"
          >
            Changelog
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
