/**
 * Ввод одноразового кода из SMS: 6 ячеек, `autocomplete="one-time-code"`,
 * `inputMode="numeric"`, вставка из буфера, WebOTP (Android Chrome подставит
 * код сам: SMS заканчивается строкой `@домен #код`).
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const LENGTH = 6;

interface OTPCredential extends Credential {
  code: string;
}

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus = true,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const setAll = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, LENGTH);
    onChange(digits);
    if (digits.length === LENGTH) onCompleteRef.current?.(digits);
    return digits;
  };

  // WebOTP: браузер сам достаёт код из SMS (Android Chrome).
  useEffect(() => {
    if (disabled || typeof window === 'undefined' || !('OTPCredential' in window)) return;
    const ac = new AbortController();
    navigator.credentials
      .get({ otp: { transport: ['sms'] }, signal: ac.signal } as CredentialRequestOptions)
      .then((cred) => {
        const code = (cred as OTPCredential | null)?.code;
        if (code) setAll(code);
      })
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  useEffect(() => {
    if (autoFocus && !disabled) refs.current[Math.min(value.length, LENGTH - 1)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, disabled]);

  const handleInput = (index: number, raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;
    if (digits.length > 1) {
      // Автоподстановка iOS / вставка — сразу весь код.
      const next = setAll(value.slice(0, index) + digits);
      refs.current[Math.min(next.length, LENGTH - 1)]?.focus();
      return;
    }
    const chars = value.padEnd(LENGTH, ' ').split('');
    chars[index] = digits;
    const next = setAll(chars.join('').replace(/\s/g, ''));
    if (index < LENGTH - 1 && next.length > index) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[index]) {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        refs.current[index - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < LENGTH - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  return (
    <div className="flex justify-center gap-1.5 sm:gap-2" role="group" aria-label="Код из SMS">
      {Array.from({ length: LENGTH }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ''}
          disabled={disabled}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Цифра ${i + 1}`}
          maxLength={i === 0 ? LENGTH : 1}
          onChange={(e) => handleInput(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => {
            e.preventDefault();
            const next = setAll(e.clipboardData.getData('text'));
            refs.current[Math.min(next.length, LENGTH - 1)]?.focus();
          }}
          onFocus={(e) => e.target.select()}
          className={cn(
            'tnum h-12 w-10 rounded-md border bg-background text-center text-xl font-semibold shadow-sm outline-none transition-colors sm:h-12 sm:w-11',
            'focus:border-foreground/40 focus:ring-2 focus:ring-ring/30',
            invalid && 'border-red-400 text-red-600',
            disabled && 'opacity-60',
          )}
        />
      ))}
    </div>
  );
}
