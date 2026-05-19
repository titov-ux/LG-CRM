import { AtSign, Bell, Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';
import { useNotifications, useMarkAllRead, useMarkRead } from './hooks';
import { cn } from '@/lib/utils';

const KIND_ICON = {
  mention: AtSign,
  status_change: Bell,
  system: Bell,
};

export function NotificationsPage() {
  const { data, isLoading } = useNotifications();
  const markAll = useMarkAllRead();
  const markOne = useMarkRead();

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Загрузка…</div>;
  if (!data || data.length === 0) return <EmptyState icon={Inbox} title="Уведомлений нет" />;

  return (
    <div className="space-y-3 px-6 pb-6">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => markAll.mutate()}>
          Прочитать все
        </Button>
      </div>

      <Card className="divide-y">
        {data.map((n) => {
          const Icon = KIND_ICON[n.kind];
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => markOne.mutate(n.id)}
              className={cn(
                'flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50',
                !n.read && 'bg-blue-50/40',
              )}
            >
              <span className={cn('mt-0.5 flex h-7 w-7 items-center justify-center rounded-full', n.read ? 'bg-muted text-muted-foreground' : 'bg-blue-100 text-blue-700')}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="flex-1">
                <div className="text-sm">{n.text}</div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {new Date(n.createdAt).toLocaleString('ru-RU')}
                </div>
              </div>
            </button>
          );
        })}
      </Card>
    </div>
  );
}
