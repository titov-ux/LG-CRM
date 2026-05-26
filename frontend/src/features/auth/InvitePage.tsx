import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/auth';
import { authKeys } from './useAuth';
import { BubbleBackdrop } from './BubbleBackdrop';

/**
 * Страница активации аккаунта по invite-ссылке.
 *
 * Поток:
 * 1) На mount запрашиваем GET /auth/invite/{token} — это и проверка валидности,
 *    и подтяжка имени/email, чтобы юзер увидел, что приглашение именно ему.
 *    Ошибки 404/410 показываем понятным текстом.
 * 2) Юзер вводит пароль дважды (вторая проверка — клиентская, формат знаком ему
 *    по любому signup-флоу), сабмит идёт POST /auth/invite/{token}/activate.
 * 3) Бэк сразу возвращает access/refresh — кладём accessToken в стор и
 *    редиректим на /dashboard, не прогоняя через форму логина.
 *
 * Визуально страница использует тот же [[BubbleBackdrop]] и «стеклянную»
 * карточку, что и LoginPage — это одно семейство публичных экранов.
 */
export function InvitePage() {
  const { token } = useParams({ from: '/invite/$token' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setAccessToken = useAuthStore((s) => s.setAccessToken);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [clientError, setClientError] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => authApi.inviteInfo(token),
    retry: false,
    staleTime: 30_000,
  });

  const activate = useMutation({
    mutationFn: () => authApi.inviteActivate(token, { password }),
    onSuccess: async (data) => {
      setAccessToken(data.accessToken);
      await queryClient.invalidateQueries({ queryKey: authKeys.me });
      navigate({ to: '/dashboard' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);
    if (password.length < 8) {
      setClientError('Минимум 8 символов');
      return;
    }
    if (!/[A-Za-zА-Яа-я]/.test(password) || !/\d/.test(password)) {
      setClientError('Пароль должен содержать буквы и цифры');
      return;
    }
    if (password !== confirm) {
      setClientError('Пароли не совпадают');
      return;
    }
    activate.mutate();
  };

  return (
    <BubbleBackdrop>
      <Card className="relative w-full max-w-sm border-white/50 bg-white/70 shadow-2xl shadow-slate-900/10 backdrop-blur-xl">
        <CardHeader className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-xs font-bold text-background shadow-sm">
              ЛГ
            </div>
            <div>
              <CardTitle>ЛГ Интеграция · SaaS</CardTitle>
              <CardDescription>Активация аккаунта</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {info.isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          )}

          {info.isError && <InviteError error={info.error} />}

          {info.data && (
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="rounded-md border border-white/60 bg-white/60 p-3 text-[12.5px] backdrop-blur-sm">
                <div className="text-muted-foreground">Приглашение для</div>
                <div className="mt-0.5 font-medium text-foreground">{info.data.fullName}</div>
                <div className="text-[11.5px] text-muted-foreground">{info.data.email}</div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Новый пароль</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  autoFocus
                  className="bg-white/80"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Повторите пароль</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="bg-white/80"
                />
              </div>

              {(clientError || activate.isError) && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {clientError ?? 'Не удалось активировать аккаунт. Попробуйте ещё раз.'}
                  </AlertDescription>
                </Alert>
              )}

              <Button type="submit" className="w-full" disabled={activate.isPending}>
                {activate.isPending ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Активация…
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" /> Активировать и войти
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </BubbleBackdrop>
  );
}

/**
 * 410 = expired / used, 404 = not_found. Отдельно подсвечиваем «срок истёк» —
 * там есть смысл попросить админа переотправить. На 404 предполагаем опечатку
 * в ссылке и просим перепроверить.
 */
function InviteError({ error }: { error: unknown }) {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  const isGone = status === 410;
  const isMissing = status === 404;
  return (
    <Alert variant="destructive" className="border-rose-200">
      <ShieldAlert className="h-4 w-4" />
      <AlertDescription>
        {isGone && 'Ссылка приглашения недействительна — срок действия истёк или ею уже воспользовались. Попросите администратора прислать новую.'}
        {isMissing && 'Ссылка не найдена. Проверьте, что вы перешли по полному адресу из письма.'}
        {!isGone && !isMissing && 'Не удалось проверить приглашение. Попробуйте позже или обратитесь к администратору.'}
      </AlertDescription>
    </Alert>
  );
}
