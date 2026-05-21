import * as React from 'react';
import { CalendarIcon } from 'lucide-react';
import { format, isValid } from 'date-fns';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';

/**
 * Гибридный инпут даты: пользователь может или выбрать день в календаре,
 * или ввести дату руками практически в любом разумном формате —
 * 21.05.2026, 21/5/26, 21052026, 2026-05-21 и т.п. На blur строка нормализуется
 * к виду «21.05.2026», а во внешнюю форму уходит ISO «YYYY-MM-DD».
 *
 * Это сознательная замена нативного <input type="date">, потому что нативный
 * input на разных раскладках/локалях по-разному обрабатывает ручной ввод
 * и пугает пользователей «зачёркнутыми» сегментами.
 */

const DISPLAY_FORMAT = 'dd.MM.yyyy';
const ISO_FORMAT = 'yyyy-MM-dd';

/**
 * Самопальный парсер: на удивление надёжнее, чем перебор форматов date-fns,
 * потому что token `yyyy` у date-fns в v3 жадно ест 1+ цифр и ломается на «1.1.26».
 *
 * Поддерживает:
 *   • DMY: 21.05.2026, 21/5/26, 21-05-2026 (любая комбинация . / -)
 *   • YMD: 2026-05-21, 2026.05.21 (если первый сегмент — 4 цифры)
 *   • Сплошные 8 цифр: 21052026 → 21.05.2026
 *   • 2-значный год расширяем: <50 → 20xx, иначе 19xx (как Excel)
 *   • Леп-проверка через round-trip через Date — «29.02.2023» вернёт null.
 */
function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 50 ? 2000 + y : 1900 + y;
}

function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // Round-trip: отсекает «31.04», «29.02.2023» и подобное.
  if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
    return d;
  }
  return null;
}

function tryParse(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Три числовых сегмента через .  / -  или пробел.
  const segs = trimmed.split(/[\s./\-]+/).filter(Boolean);
  if (segs.length === 3 && segs.every((s) => /^\d+$/.test(s))) {
    const [a, b, c] = segs.map(Number);
    if (segs[0].length === 4) {
      // YMD
      return buildDate(a, b, c);
    }
    // DMY (2-значный год расширяем).
    return buildDate(expandYear(c), b, a);
  }

  // Сплошные 8 цифр: DDMMYYYY.
  if (/^\d{8}$/.test(trimmed)) {
    const day = Number(trimmed.slice(0, 2));
    const month = Number(trimmed.slice(2, 4));
    const year = Number(trimmed.slice(4, 8));
    return buildDate(year, month, day);
  }

  // Последняя попытка — пусть браузер разберёт сам (например, «21 May 2026»).
  const fallback = new Date(trimmed);
  return isValid(fallback) ? fallback : null;
}

function isoToDate(iso: string | undefined | null): Date | undefined {
  if (!iso) return undefined;
  // ISO YYYY-MM-DD парсим вручную, чтобы не зависеть от TZ-смещений Date.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const d = buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return d ?? undefined;
}

function isoToDisplay(iso: string | undefined | null): string {
  const d = isoToDate(iso);
  return d ? format(d, DISPLAY_FORMAT) : '';
}

export interface DateFieldProps {
  /** ISO YYYY-MM-DD или пустая строка / undefined. */
  value: string | undefined | null;
  onChange: (isoOrEmpty: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Имя поля для атрибутов (a11y, автозаполнение). */
  name?: string;
  id?: string;
  onBlur?: () => void;
}

export function DateField({
  value,
  onChange,
  disabled,
  placeholder = 'дд.мм.гггг',
  className,
  name,
  id,
  onBlur,
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState<string>(() => isoToDisplay(value));

  // Синхронизируем локальный текст при внешних изменениях value (например, reset формы).
  React.useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  const commitText = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange('');
      setText('');
      return;
    }
    const parsed = tryParse(trimmed);
    if (parsed) {
      onChange(format(parsed, ISO_FORMAT));
      setText(format(parsed, DISPLAY_FORMAT));
    } else {
      // Текст оставляем как есть — пользователь увидит, что напечатал.
      // Значение формы при этом обнуляем, чтобы валидатор/сабмит знал, что даты нет.
      onChange('');
    }
  };

  const selectedDate = isoToDate(value);

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          commitText(text);
          onBlur?.();
        }}
        className="pr-9"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Открыть календарь"
            className={cn(
              'absolute inset-y-0 right-0 inline-flex items-center justify-center px-2',
              'text-muted-foreground hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate}
            onSelect={(d) => {
              if (d) {
                onChange(format(d, ISO_FORMAT));
                setText(format(d, DISPLAY_FORMAT));
              } else {
                onChange('');
                setText('');
              }
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
