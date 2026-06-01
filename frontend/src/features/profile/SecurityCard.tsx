import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { HTTPError } from 'ky';
import { KeyRound, ShieldCheck, ShieldAlert, Eye, EyeOff, LogOut } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { usePreferencesStore } from '@/stores/preferences';
import { useChangePassword, useLogout } from '@/features/auth/useAuth';
import { useProfileStore } from '@/stores/profile';

const passwordSchema = z
  .object({
    current: z.string().min(1, 'Введите текущий пароль'),
    next: z
      .string()
      .min(8, 'Минимум 8 символов')
      .max(64, 'Максимум 64 символа')
      .regex(/[A-Za-zА-Яа-я]/, 'Должна содержать буквы')
      .regex(/\d/, 'Должна содержать цифры'),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, {
    path: ['confirm'],
    message: 'Пароли не совпадают',
  })
  .refine((v) => v.current !== v.next, {
    path: ['next'],
    message: 'Новый пароль должен отличаться от текущего',
  });

type PasswordValues = z.infer<typeof passwordSchema>;

function strength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-ZА-Я]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-zА-Яа-я0-9]/.test(pw)) s++;
  if (s <= 1) return { score: 1, label: 'Слабый', color: 'bg-rose-500' };
  if (s <= 3) return { score: 3, label: 'Средний', color: 'bg-amber-500' };
  return { score: 5, label: 'Сильный', color: 'bg-emerald-500' };
}

export function SecurityCard() {
  const twoFA = usePreferencesStore((s) => s.twoFactorEnabled);
  const setTwoFA = usePreferencesStore((s) => s.setTwoFactorEnabled);
  const closeProfile = useProfileStore((s) => s.setOpen);
  const logout = useLogout();
  const changePassword = useChangePassword();

  const handleLogout = () => {
    closeProfile(false);
    logout.mutate();
  };

  const [show, setShow] = useState<{ current: boolean; next: boolean }>({
    current: false,
    next: false,
  });

  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: '', next: '', confirm: '' },
  });

  const nextPw = form.watch('next');
  const meter = strength(nextPw);

  const onSubmit = async (v: PasswordValues) => {
    try {
      await changePassword.mutateAsync({ currentPassword: v.current, newPassword: v.next });
      toast.success('Пароль обновлён. Остальные устройства разлогинены.');
      form.reset({ current: '', next: '', confirm: '' });
    } catch (e) {
      let code: string | undefined;
      let message: string | undefined;
      if (e instanceof HTTPError) {
        try {
          const body = (await e.response.json()) as
            | { detail?: { code?: string; message?: string } }
            | undefined;
          code = body?.detail?.code;
          message = body?.detail?.message;
        } catch {
          // тело не JSON — оставляем дефолтное сообщение
        }
      }
      if (code === 'invalid_current_password') {
        form.setError('current', { message: message ?? 'Текущий пароль указан неверно' });
      } else if (code === 'password_unchanged') {
        form.setError('next', { message: message ?? 'Новый пароль должен отличаться от текущего' });
      } else {
        toast.error(message ?? 'Не удалось сменить пароль. Попробуйте ещё раз.');
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          Безопасность
        </CardTitle>
        <CardDescription>
          Смена пароля и двухфакторная аутентификация для вашего аккаунта.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5" />
              Смена пароля
            </div>

            <FormField
              control={form.control}
              name="current"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Текущий пароль</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type={show.current ? 'text' : 'password'}
                        autoComplete="current-password"
                        className="pr-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShow((s) => ({ ...s, current: !s.current }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {show.current ? (
                          <EyeOff className="h-3.5 w-3.5" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="next"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Новый пароль</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={show.next ? 'text' : 'password'}
                          autoComplete="new-password"
                          className="pr-9"
                        />
                        <button
                          type="button"
                          onClick={() => setShow((s) => ({ ...s, next: !s.next }))}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          tabIndex={-1}
                        >
                          {show.next ? (
                            <EyeOff className="h-3.5 w-3.5" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </FormControl>
                    {nextPw.length > 0 && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex h-1 flex-1 gap-1 overflow-hidden rounded-full bg-muted">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div
                              key={i}
                              className={`h-full flex-1 rounded-full ${
                                i <= meter.score ? meter.color : 'bg-transparent'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-[11px] text-muted-foreground">{meter.label}</span>
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="confirm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Повторите пароль</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" autoComplete="new-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end pt-1">
              <Button
                type="submit"
                size="sm"
                disabled={form.formState.isSubmitting || changePassword.isPending}
              >
                {changePassword.isPending ? 'Обновляем…' : 'Обновить пароль'}
              </Button>
            </div>
          </form>
        </Form>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            Двухфакторная аутентификация
          </div>
          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="min-w-0">
              <Label className="text-[13px]">Подтверждение входа кодом</Label>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                После ввода пароля система запросит одноразовый код из приложения-аутентификатора
                (Google Authenticator, Authy и др.).
              </p>
              {twoFA && (
                <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-medium text-emerald-700">
                  <ShieldCheck className="h-3 w-3" />
                  Включено
                </div>
              )}
            </div>
            <Switch
              checked={twoFA}
              onCheckedChange={(v) => {
                setTwoFA(v);
                toast.message(v ? 'Двухфакторная аутентификация включена' : 'Двухфакторная аутентификация отключена');
              }}
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-[12.5px] font-medium text-muted-foreground">Активные сессии</div>
          <div className="rounded-md border p-3 text-[12.5px]">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Текущая сессия</div>
                <div className="text-[11.5px] text-muted-foreground">
                  Браузер · последний вход только что
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => toast.info('Выход из других устройств появится на этапе 2')}
              >
                Завершить остальные
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="text-[13px] font-medium">Выход из аккаунта</div>
            <p className="text-[12px] text-muted-foreground">
              Завершит текущую сессию и вернёт вас на страницу входа.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            disabled={logout.isPending}
            className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            {logout.isPending ? 'Выходим…' : 'Выйти'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
