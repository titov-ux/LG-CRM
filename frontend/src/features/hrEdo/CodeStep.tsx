/**
 * Шаг «Введите код из SMS»: ячейки кода, таймер повторной отправки, ошибки.
 * Общий для входа на портал, выпуска подписи и подписания.
 */
import { useEffect, useState } from 'react';
import { Loader2, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { HrChallenge } from '@/api/hrEdo';
import { OtpInput } from './OtpInput';
import { apiErrorMessage } from './statuses';

export function CodeStep({
  challenge,
  onSubmit,
  onResend,
  submitLabel = 'Подтвердить',
  hint,
}: {
  challenge: HrChallenge;
  onSubmit: (code: string) => Promise<void>;
  onResend: () => Promise<HrChallenge>;
  submitLabel?: string;
  hint?: React.ReactNode;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(challenge);
  const [left, setLeft] = useState(challenge.resendAfter);

  useEffect(() => {
    setCurrent(challenge);
    setLeft(challenge.resendAfter);
  }, [challenge]);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const submit = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value);
    } catch (e) {
      setError(await apiErrorMessage(e, 'Не удалось проверить код'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await onResend();
      setCurrent(next);
      setLeft(next.resendAfter);
      setCode('');
    } catch (e) {
      setError(await apiErrorMessage(e, 'Не удалось отправить код'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-[12.5px]">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          Код отправлен на <span className="tnum font-medium">{current.phoneMasked}</span>. Он действует 5 минут.
          {hint && <div className="mt-1 text-muted-foreground">{hint}</div>}
        </div>
      </div>
      <OtpInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} disabled={busy} invalid={!!error} />
      {error && <p className="text-center text-[12.5px] text-red-600">{error}</p>}
      <Button className="w-full" onClick={() => void submit()} disabled={busy || code.length !== 6}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
      <div className="text-center text-[12px] text-muted-foreground">
        {left > 0 ? (
          <span className="tnum">Новый код — через {left} с</span>
        ) : (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => void resend()} disabled={busy}>
            Отправить код ещё раз
          </button>
        )}
      </div>
    </div>
  );
}
