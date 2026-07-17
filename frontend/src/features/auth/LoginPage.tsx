import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useForceLightTheme } from '@/lib/theme';
import { apiErrorMessage } from '@/lib/utils';
import { useLogin } from './useAuth';
import { BubbleBackdrop } from './BubbleBackdrop';

export function LoginPage() {
  // Экран авторизации всегда в светлой теме, независимо от настройки темы.
  useForceLightTheme();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: '/login' });
  const login = useLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Реальный текст ошибки от бэкенда (lockout / rate-limit / inactive / 500),
  // а не общий «проверьте пароль» — иначе непонятно, почему верные данные не проходят.
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await login.mutateAsync({ email, password });
      // Возвращаемся на исходный deep-link, если он был; иначе на главную.
      // href принимает произвольный внутренний path+search+hash (см. AuthGuard).
      await navigate({ href: redirect ?? '/dashboard' });
    } catch (err) {
      setErrorMsg(
        await apiErrorMessage(err, 'Не удалось войти. Проверьте email и пароль.'),
      );
    }
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
              <CardDescription>Вход в систему</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
