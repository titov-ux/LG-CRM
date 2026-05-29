/**
 * Personal API-токены для Chrome-расширения hh.ru.
 *
 * Кнопка «Выпустить» открывает диалог: пользователь вводит имя
 * (например, «MacBook Chrome»), бэк возвращает raw-токен — показываем его
 * ОДИН раз с возможностью копирования. После закрытия диалога видны только
 * префикс и метаданные.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Plus, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiTokensApi, type ApiTokenItem } from '@/api/apiTokens';
import type { UUID } from '@/api/types';

const KEY = ['me', 'api-tokens'] as const;

export function ApiTokensCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: () => apiTokensApi.list(),
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (n: string) => apiTokensApi.create(n),
    onSuccess: (res) => {
      setIssuedToken(res.rawToken);
      setName('');
      qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) =>
      toast.error('Не удалось выпустить токен', {
        description: e instanceof Error ? e.message : '',
      }),
  });

  const revokeMut = useMutation({
    mutationFn: (id: UUID) => apiTokensApi.revoke(id),
    onSuccess: () => {
      toast.success('Токен отозван');
      qc.invalidateQueries({ queryKey: KEY });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMut.mutate(name.trim());
  };

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(token);
    toast.success('Скопировано');
  };

  const active = (data || []).filter((t) => !t.revokedAt);
  const revoked = (data || []).filter((t) => t.revokedAt);

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">API-токены</CardTitle>
        <CardDescription>
          Для браузерного расширения hh.ru. Создайте токен, вставьте его в
          настройках расширения — после этого кнопка «Сохранить в ЛГ» появится
          прямо на странице резюме.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка…
          </div>
        )}

        {!isLoading && active.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Активных токенов нет.
          </div>
        )}

        {active.length > 0 && (
          <div className="divide-y rounded-md border">
            {active.map((t) => (
              <TokenRow
                key={t.id}
                token={t}
                onRevoke={() => revokeMut.mutate(t.id)}
                disabled={revokeMut.isPending}
              />
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            onClick={() => {
              setIssuedToken(null);
              setCreateOpen(true);
            }}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Выпустить токен
          </Button>
        </div>

        {revoked.length > 0 && (
          <details className="pt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              Отозванные ({revoked.length})
            </summary>
            <div className="mt-2 divide-y rounded-md border">
              {revoked.map((t) => (
                <TokenRow key={t.id} token={t} muted />
              ))}
            </div>
          </details>
        )}
      </CardContent>

      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (createMut.isPending) return;
          setCreateOpen(o);
          if (!o) setIssuedToken(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {issuedToken ? 'Скопируйте токен' : 'Новый API-токен'}
            </DialogTitle>
            <DialogDescription>
              {issuedToken
                ? 'Этот ключ показывается один раз. Сохраните его в настройках расширения hh.ru — восстановить позже нельзя.'
                : 'Дайте токену имя — например, «Chrome на MacBook». Это поможет понять, какой токен отзывать, если потеряете доступ.'}
            </DialogDescription>
          </DialogHeader>

          {!issuedToken ? (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="token-name">Имя токена</Label>
                <Input
                  id="token-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Chrome — MacBook"
                  disabled={createMut.isPending}
                  maxLength={128}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createMut.isPending}
                >
                  Отмена
                </Button>
                <Button
                  type="submit"
                  disabled={createMut.isPending || !name.trim()}
                >
                  {createMut.isPending ? 'Создаём…' : 'Создать'}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 p-2.5">
                <code className="block whitespace-pre-wrap break-all font-mono text-xs">
                  {issuedToken}
                </code>
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                >
                  Закрыть
                </Button>
                <Button onClick={() => handleCopy(issuedToken)} className="gap-1.5">
                  <Copy className="h-3.5 w-3.5" />
                  Скопировать
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function TokenRow({
  token,
  onRevoke,
  disabled,
  muted,
}: {
  token: ApiTokenItem;
  onRevoke?: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 ${
        muted ? 'opacity-70' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{token.name}</div>
        <div className="text-[11.5px] text-muted-foreground">
          <span className="font-mono">{token.prefix}…</span>
          {' · '}создан {new Date(token.createdAt).toLocaleDateString('ru-RU')}
          {token.lastUsedAt && (
            <>
              {' · '}использовался{' '}
              {new Date(token.lastUsedAt).toLocaleDateString('ru-RU')}
            </>
          )}
          {token.revokedAt && (
            <>
              {' · '}отозван{' '}
              {new Date(token.revokedAt).toLocaleDateString('ru-RU')}
            </>
          )}
        </div>
      </div>
      {onRevoke && !token.revokedAt && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRevoke}
          disabled={disabled}
          className="gap-1 text-destructive hover:text-destructive"
        >
          <ShieldOff className="h-3.5 w-3.5" />
          Отозвать
        </Button>
      )}
    </div>
  );
}
