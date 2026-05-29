/**
 * OAuth-callback hh.ru.
 *
 * Этот URL зарегистрирован в карточке приложения на dev.hh.ru. hh редиректит
 * сюда после логина пользователя с ?code=&state= (или ?error=...). Мы
 * передаём (code, state) на бэк, бэк проверяет state, обменивает code на
 * токены и сохраняет в БД. После — кидаем пользователя обратно на /settings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { HTTPError } from 'ky';
import { Button } from '@/components/ui/button';
import { useHhExchangeCode } from '@/features/integrations/hooks';

interface CallbackSearch {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

// `as any` тут — мостик до запуска `vite-plugin-tanstack-router` codegen'а:
// routeTree.gen.ts ещё не знает про этот файл, и strict-литеральная подпись
// `createFileRoute<...>` падает. После первой сборки фронта типы вернутся сами.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = (createFileRoute as any)('/_authed/settings/integrations/hh/callback')({
  validateSearch: (search: Record<string, unknown>): CallbackSearch => ({
    code: typeof search.code === 'string' ? search.code : undefined,
    state: typeof search.state === 'string' ? search.state : undefined,
    error: typeof search.error === 'string' ? search.error : undefined,
    error_description:
      typeof search.error_description === 'string'
        ? search.error_description
        : undefined,
  }),
  component: HhCallbackPage,
});

function HhCallbackPage() {
  // Парсим search прямо из window.location, чтобы не зависеть от типов Route.
  const search: CallbackSearch = useMemo(() => {
    if (typeof window === 'undefined') return {};
    const sp = new URLSearchParams(window.location.search);
    return {
      code: sp.get('code') ?? undefined,
      state: sp.get('state') ?? undefined,
      error: sp.get('error') ?? undefined,
      error_description: sp.get('error_description') ?? undefined,
    };
  }, []);
  const navigate = useNavigate();
  const exchange = useHhExchangeCode();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Чтобы exchange не выполнился дважды в React StrictMode.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      if (search.error) {
        const msg = search.error_description || search.error;
        setErrorMessage(msg);
        toast.error('hh.ru отклонил авторизацию', { description: msg });
        return;
      }
      if (!search.code || !search.state) {
        setErrorMessage('Не получен code/state от hh.ru');
        return;
      }
      try {
        await exchange.mutateAsync({ code: search.code, state: search.state });
        toast.success('hh.ru подключён');
        navigate({ to: '/settings' });
      } catch (e) {
        let msg = 'Не удалось завершить подключение';
        if (e instanceof HTTPError) {
          try {
            const body = (await e.response.clone().json()) as {
              message?: string;
              code?: string;
            };
            msg = body?.message || body?.code || msg;
          } catch {
            /* ignore */
          }
        } else if (e instanceof Error) {
          msg = e.message;
        }
        setErrorMessage(msg);
        toast.error('Не удалось подключить hh', { description: msg });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="max-w-md space-y-3 text-center">
        {!errorMessage ? (
          <>
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              Завершаем подключение hh.ru…
            </div>
          </>
        ) : (
          <>
            <div className="text-base font-medium">Не получилось подключить hh.ru</div>
            <div className="text-sm text-muted-foreground">{errorMessage}</div>
            <Button onClick={() => navigate({ to: '/settings' })}>
              Вернуться в настройки
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
