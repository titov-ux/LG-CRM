/**
 * Карточка интеграции с hh.ru на странице настроек.
 *
 * Подключение: GET authorize_url у бэка → редиректим юзера на hh.ru → hh
 * редиректит обратно на /settings/integrations/hh/callback с ?code=&state= →
 * фронт-роут (см. _authed.settings.integrations.hh.callback.tsx) вызывает
 * /integrations/hh/oauth/exchange и возвращает юзера сюда.
 *
 * Один аккаунт работодателя на весь CRM — кнопка «Подключить» доступна только
 * админам (бэк сам вернёт 403 для остальных).
 */
import { useState } from 'react';
import { ExternalLink, Loader2, Plug, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  useHhDisconnect,
  useHhStartOAuth,
  useHhStatus,
} from './hooks';

export function HhIntegrationCard() {
  const { data, isLoading } = useHhStatus();
  const startOAuth = useHhStartOAuth();
  const disconnect = useHhDisconnect();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConnect = async () => {
    try {
      const { authorizeUrl } = await startOAuth.mutateAsync();
      // Редирект в том же окне — после авторизации hh вернёт нас на наш
      // callback-роут, который сам завершит обмен code → токены.
      window.location.href = authorizeUrl;
    } catch (e) {
      toast.error('Не удалось начать подключение hh', {
        description: e instanceof Error ? e.message : 'Попробуйте позже',
      });
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success('hh-аккаунт отключён');
      setConfirmOpen(false);
    } catch {
      toast.error('Не удалось отключить hh');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            hh.ru
            {data?.connected && (
              <Badge variant="secondary" className="font-normal">
                Подключено
              </Badge>
            )}
            {data && !data.connected && (
              <Badge variant="outline" className="font-normal">
                Не подключено
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Подключите свой рабочий аккаунт hh — просмотры резюме будут идти
            с вашей квоты. У каждого сотрудника свой токен.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка статуса…
          </div>
        )}
        {data && !data.configured && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            На сервере не заполнены <code>HH_CLIENT_ID</code> /{' '}
            <code>HH_CLIENT_SECRET</code>. Добавьте секреты в <code>.env</code>{' '}
            бэка и зарегистрируйте redirect URI на{' '}
            <a
              href="https://dev.hh.ru/admin"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              dev.hh.ru/admin
            </a>
            .
          </div>
        )}
        {data?.connected && (
          <div className="text-muted-foreground">
            Аккаунт:{' '}
            <span className="font-medium text-foreground">
              {data.accountLabel || '—'}
            </span>
            {data.expiresAt && (
              <>
                {' · '}токен до{' '}
                {new Date(data.expiresAt).toLocaleString('ru-RU')}
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {!data?.connected && (
            <Button
              onClick={handleConnect}
              disabled={
                startOAuth.isPending || (data ? !data.configured : false)
              }
              size="sm"
              className="gap-1.5"
            >
              {startOAuth.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              Подключить hh
            </Button>
          )}
          {data?.connected && (
            <>
              <Button
                onClick={handleConnect}
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Переподключить
              </Button>
              <Button
                onClick={() => setConfirmOpen(true)}
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Unplug className="h-3.5 w-3.5" />
                Отключить
              </Button>
            </>
          )}
        </div>
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Отключить hh.ru?</DialogTitle>
            <DialogDescription>
              Импорт резюме станет недоступен, пока кто-то снова не подключит
              аккаунт. Уже импортированные кандидаты останутся в базе.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={disconnect.isPending}
            >
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              disabled={disconnect.isPending}
            >
              {disconnect.isPending ? 'Отключаем…' : 'Отключить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
