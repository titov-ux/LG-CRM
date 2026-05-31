/**
 * Карточка интеграции с Telegram-ботом уведомлений на странице настроек.
 *
 * Привязка: POST /integrations/telegram/link/start → получаем deep-link
 * `t.me/<bot>?start=<token>` → открываем в новой вкладке. Пользователь жмёт Start
 * в Telegram → бот по токену сохраняет chat_id (вебхук на бэке). После этого
 * статус подтянется по кнопке «Обновить статус».
 *
 * У каждого пользователя своя привязка и свой тумблер доставки.
 */
import { useState } from 'react';
import { Loader2, Plug, RefreshCw, Send, Unplug } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useQueryClient } from '@tanstack/react-query';
import {
  useTelegramDisconnect,
  useTelegramLinkStart,
  useTelegramSetEnabled,
  useTelegramStatus,
} from './hooks';

export function TelegramIntegrationCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useTelegramStatus();
  const linkStart = useTelegramLinkStart();
  const setEnabled = useTelegramSetEnabled();
  const disconnect = useTelegramDisconnect();
  const [linkInfo, setLinkInfo] = useState<{ deepLink: string | null; token: string } | null>(
    null,
  );

  const handleConnect = async () => {
    try {
      const res = await linkStart.mutateAsync();
      if (res.deepLink) {
        window.open(res.deepLink, '_blank', 'noopener');
      }
      setLinkInfo({ deepLink: res.deepLink, token: res.token });
    } catch (e) {
      toast.error('Не удалось начать привязку Telegram', {
        description: e instanceof Error ? e.message : 'Попробуйте позже',
      });
    }
  };

  const handleToggle = async (enabled: boolean) => {
    try {
      await setEnabled.mutateAsync(enabled);
    } catch {
      toast.error('Не удалось сохранить настройку');
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      setLinkInfo(null);
      toast.success('Telegram отвязан');
    } catch {
      toast.error('Не удалось отвязать Telegram');
    }
  };

  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations', 'telegram', 'status'] });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-4 w-4 text-sky-500" />
            Telegram-уведомления
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
            Привяжите бота — и уведомления (назначения, комментарии, смена
            статуса) будут дублироваться в Telegram.
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
            На сервере не задан <code>TELEGRAM_BOT_TOKEN</code>. Создайте бота
            через <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline">@BotFather</a>,
            добавьте токен и <code>TELEGRAM_BOT_USERNAME</code> в <code>.env</code> бэка.
          </div>
        )}

        {data?.connected && (
          <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
            <div>
              <Label className="text-[13px]">Присылать уведомления в Telegram</Label>
              <p className="text-xs text-muted-foreground">
                Бот привязан к вашему аккаунту.
              </p>
            </div>
            <Switch
              checked={!!data.enabled}
              onCheckedChange={handleToggle}
              disabled={setEnabled.isPending}
            />
          </div>
        )}

        {linkInfo && !data?.connected && (
          <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            {linkInfo.deepLink ? (
              <>
                Если бот не открылся автоматически —{' '}
                <a href={linkInfo.deepLink} target="_blank" rel="noreferrer" className="underline">
                  откройте ссылку
                </a>{' '}
                и нажмите <b>Start</b>. Затем обновите статус.
              </>
            ) : (
              <>
                Откройте бота{data?.botUsername ? ` @${data.botUsername}` : ''} в Telegram и
                отправьте: <code>/start {linkInfo.token}</code>
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!data?.connected && (
            <Button
              onClick={handleConnect}
              disabled={linkStart.isPending || (data ? !data.configured : false)}
              size="sm"
              className="gap-1.5"
            >
              {linkStart.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plug className="h-3.5 w-3.5" />
              )}
              Подключить Telegram
            </Button>
          )}
          <Button onClick={refresh} variant="outline" size="sm" className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Обновить статус
          </Button>
          {data?.connected && (
            <Button
              onClick={handleDisconnect}
              variant="outline"
              size="sm"
              disabled={disconnect.isPending}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Unplug className="h-3.5 w-3.5" />
              Отвязать
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
