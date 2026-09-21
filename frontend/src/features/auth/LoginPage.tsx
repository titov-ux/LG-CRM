import { useState } from 'react';
import { useRouter, useSearch } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useForceLightTheme } from '@/lib/theme';
import { apiErrorMessage } from '@/lib/utils';
import { authApi } from '@/api/auth';
import { useLogin } from './useAuth';
import { useLoginCamera } from './useLoginCamera';
import { BubbleBackdrop } from './BubbleBackdrop';

export function LoginPage() {
  // Экран авторизации всегда в светлой теме, независимо от настройки темы.
  useForceLightTheme();
  const router = useRouter();
  const { redirect } = useSearch({ from: '/login' });
  const login = useLogin();
  // Камера безопасности: живое превью (прозрачность сбора) + кадр при входе.
  // Сотрудники уведомлены и дали письменные согласия.
  const camera = useLoginCamera();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Реальный текст ошибки от бэкенда (lockout / rate-limit / inactive / 500),
  // а не общий «проверьте пароль» — иначе непонятно, почему верные данные не проходят.
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    // Кадр снимаем ДО логина, пока превью гарантированно живое. Если камера не
    // готова — фиксируем причину (denied/no_camera/error), вход не блокируем.
    const blob = camera.ready ? await camera.capture() : null;
    try {
      await login.mutateAsync({ email, password });
      // Снимок отправляем ПОСЛЕ успешного логина: нужен access-токен. Любая
      // ошибка загрузки не должна мешать входу — поэтому catch-глушилка.
      void authApi
        .uploadLoginSnapshot(blob ? 'ok' : camera.reason, blob)
        .catch(() => undefined);
      // Возвращаемся на исходный deep-link, если он был; иначе на главную.
      // history.push принимает произвольный внутренний path+search+hash (redirect
      // валидируется в routes/login.tsx). Через navigate({ href }) переход молча
      // не срабатывал — логин проходил, но страница не открывалась.
      // Страховка от возврата на сам /login (вложенные redirect из старых URL).
      router.history.push(redirect && !redirect.startsWith('/login') ? redirect : '/dashboard');
    } catch (err) {
      setErrorMsg(
        await apiErrorMessage(err, 'Не удалось войти. Проверьте email и пароль.'),
      );
    }
  };

  const cameraHint =
    camera.status === 'denied'
      ? 'Доступ к камере отклонён — вход будет отмечен без снимка.'
      : camera.status === 'no_camera'
        ? 'Камера не найдена — вход будет отмечен без снимка.'
        : camera.status === 'error'
          ? 'Не удалось включить камеру — вход будет отмечен без снимка.'
          : camera.status === 'starting'
            ? 'Включаем камеру…'
            : null;

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
              <CardDescription>Вход в систему</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Превью камеры безопасности. Видимое — сотрудник знает, что при входе
              делается снимок (соответствует полученным письменным согласиям). */}
          <div className="mb-4 space-y-1.5">
            <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/60 bg-slate-900/90">
              <video
                ref={camera.videoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
              {camera.status !== 'ready' && (
                <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-[11px] text-white/80">
                  {cameraHint}
                </div>
              )}
              {camera.status === 'ready' && (
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  REC
                </div>
              )}
            </div>
            <p className="text-[10.5px] leading-tight text-muted-foreground">
              В целях безопасности при входе делается снимок с веб-камеры.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="bg-white/80"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="bg-white/80"
              />
            </div>
            {login.isError && errorMsg && (
              <Alert variant="destructive">
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? 'Вход…' : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </BubbleBackdrop>
  );
}
