import { MessageSquare, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';

export function ChatPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <Card className="flex w-full max-w-xl flex-col items-center gap-5 px-8 py-12 text-center">
        <div className="relative">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
            <MessageSquare className="h-8 w-8 text-muted-foreground" strokeWidth={1.6} />
          </div>
          <span className="absolute -right-2 -top-2 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground shadow-sm">
            <Sparkles className="h-3 w-3" /> v2
          </span>
        </div>

        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">Чат скоро появится</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Внутренний чат для общения с коллегами, кандидатами и клиентами станет
            доступен во 2-й версии SaaS. Сейчас раздел зарезервирован — здесь будут
            переписки, групповые обсуждения и быстрые ответы по карточкам.
          </p>
        </div>

        <div className="mt-2 grid w-full grid-cols-1 gap-2 text-left sm:grid-cols-3">
          <FeatureHint title="Личные диалоги" text="Сообщения 1-на-1 с коллегами" />
          <FeatureHint title="Чаты по вакансиям" text="Обсуждения внутри карточки" />
          <FeatureHint title="Telegram" text="Интеграция с Telegram для уведомлений и переписки" />
        </div>
      </Card>
    </div>
  );
}

function FeatureHint({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[12px] font-semibold">{title}</div>
      <div className="text-[11.5px] text-muted-foreground">{text}</div>
    </div>
  );
}
