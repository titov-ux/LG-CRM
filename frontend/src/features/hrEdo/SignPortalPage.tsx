/**
 * Публичный портал подписания кадровых документов: `/sign/$token`.
 *
 * Для аутстафф-специалистов без аккаунта CRM. Mobile-first.
 * Шаги: ссылка из письма → код из SMS (вход) → при необходимости «Получить
 * подпись» → документы. После входа — httpOnly-cookie на 30 минут, поэтому
 * обновление страницы не требует нового кода.
 */
import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HTTPError } from 'ky';
import { Loader2, LogOut, ShieldAlert, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { hrSignApi, portalDocsApi } from '@/api/hrSign';
import type { HrChallenge } from '@/api/hrEdo';
import { CodeStep } from './CodeStep';
import { DevSmsHint } from './DevSmsHint';
import { EmployeeDocsView } from './SigningFlow';
import { apiErrorMessage } from './statuses';

const portalKeys = {
  link: (t: string) => ['hr-sign', 'link', t] as const,
  session: ['hr-sign', 'session'] as const,
  docs: ['hr-sign', 'docs'] as const,
};

export function SignPortalPage() {
  const { token } = useParams({ from: '/sign/$token' });
  const qc = useQueryClient();

  const session = useQuery({
    queryKey: portalKeys.session,
    queryFn: hrSignApi.session,
    retry: false,
    staleTime: 30_000,
  });
  const loggedIn = session.isSuccess;

  const link = useQuery({
    queryKey: portalKeys.link(token),
    queryFn: () => hrSignApi.linkInfo(token),
    retry: false,
    enabled: session.isError,
  });

  const logout = async () => {
    await hrSignApi.logout().catch(() => undefined);
    qc.removeQueries({ queryKey: ['hr-sign'] });
    void session.refetch();
  };

  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col overflow-auto bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-2.5 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-[11px] font-bold text-background">
            ЛГ
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-semibold">
              {session.data?.companyName ?? link.data?.companyName ?? 'ЛГ Интеграция'}
            </div>
            <div className="text-[11px] text-muted-foreground">Кадровые документы</div>
          </div>
          {loggedIn && (
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={() => void logout()}>
              <LogOut className="h-3.5 w-3.5" /> Выйти
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5">
        {session.isLoading && <Skeleton className="h-40 w-full rounded-lg" />}

        {loggedIn && session.data && (
          <div className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{session.data.fullName}</h1>
              {session.data.position && <p className="text-[12.5px] text-muted-foreground">{session.data.position}</p>}
            </div>
            <EmployeeDocsView
              api={portalDocsApi}
              employee={session.data}
              queryKey={portalKeys.docs}
              onEmployeeChanged={() => void qc.invalidateQueries({ queryKey: portalKeys.session })}
            />
          </div>
        )}

        {session.isError && (
          <div className="mx-auto max-w-sm pt-4">
            {link.isLoading && <Skeleton className="h-48 w-full rounded-lg" />}
            {link.isError && <LinkError error={link.error} />}
            {link.data && (
              <LoginCard
                token={token}
                name={link.data.employeeName}
                phone={link.data.phoneMasked}
                onLoggedIn={() => {
                  void qc.invalidateQueries({ queryKey: portalKeys.session });
                }}
              />
            )}
          </div>
        )}
      </main>

      <footer className="px-4 pb-6 text-center text-[11px] text-muted-foreground">
        Никому не сообщайте коды из SMS — даже сотрудникам компании.
      </footer>
    </div>
  );
}

function LoginCard({
  token,
  name,
  phone,
  onLoggedIn,
}: {
  token: string;
  name: string;
  phone: string;
  onLoggedIn: () => void;
}) {
  const [challenge, setChallenge] = useState<HrChallenge | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      setChallenge(await hrSignApi.loginOtp(token));
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось отправить код'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Здравствуйте, {name}!</CardTitle>
        <CardDescription>
          Для входа подтвердите номер телефона — отправим код на <span className="tnum">{phone}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {challenge ? (
          <>
            <CodeStep
              challenge={challenge}
              submitLabel="Войти"
              onResend={() => hrSignApi.loginOtp(token)}
              onSubmit={async (code) => {
                await hrSignApi.loginVerify(token, challenge.challengeId, code);
                onLoggedIn();
              }}
            />
            <DevSmsHint />
          </>
        ) : (
          <Button className="w-full" onClick={() => void start()} disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}
            Получить код
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function LinkError({ error }: { error: unknown }) {
  const status = error instanceof HTTPError ? error.response.status : 0;
  return (
    <Alert variant="destructive">
      <ShieldAlert className="h-4 w-4" />
      <AlertDescription>
        {status === 410 && 'Срок действия ссылки истёк. Попросите кадровика прислать новую.'}
        {status === 404 && 'Ссылка недействительна: возможно, вам уже прислали новую. Откройте последнее письмо или обратитесь к кадровику.'}
        {status === 503 && 'Кадровый ЭДО сейчас недоступен.'}
        {![404, 410, 503].includes(status) && 'Не удалось открыть ссылку. Проверьте соединение и попробуйте ещё раз.'}
      </AlertDescription>
    </Alert>
  );
}
