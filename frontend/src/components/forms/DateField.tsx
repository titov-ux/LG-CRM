import * as React from 'react';
import { CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, format, isValid, setMonth, setYear } from 'date-fns';
import { ru } from 'date-fns/locale';
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

function formatDigitsAsDate(rawDigits: string): string {
  const digits = rawDigits.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}.${digits.slice(4)}`;
}

/**
 * Нормализуем ввод «на лету», чтобы поле не прыгало между форматами:
 * - принимаем любые символы, но оставляем только цифры
 * - автоматически ставим точки: 01011990 -> 01.01.1990
 * - ограничиваем длину до 8 цифр (ддммгггг)
 */
function normalizeTyping(raw: string): string {
  return formatDigitsAsDate(raw);
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

type PickerStep = 'day' | 'year' | 'month';

function clampByMaxDate(date: Date, maxDate?: Date): Date {
  if (!maxDate) return date;
  return date > maxDate ? maxDate : date;
}

export interface DateFieldProps {
  /** ISO YYYY-MM-DD или пустая строка / undefined. */
  value: string | undefined | null;
  onChange: (isoOrEmpty: string) => void;
  /** Верхняя граница выбора (включительно), например today для даты рождения. */
  maxDate?: Date;
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
  maxDate,
  disabled,
  placeholder = 'дд.мм.гггг',
  className,
  name,
  id,
  onBlur,
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState<string>(() => isoToDisplay(value));
  const selectedDate = isoToDate(value);
  const [pickerMonth, setPickerMonth] = React.useState<Date>(() =>
    clampByMaxDate(selectedDate ?? new Date(), maxDate),
  );
  const [pickerStep, setPickerStep] = React.useState<PickerStep>('day');
  const [yearPageStart, setYearPageStart] = React.useState<number>(() => (selectedDate ?? new Date()).getFullYear() - 6);
  const maxYear = maxDate?.getFullYear();
  const maxMonthIndex = maxDate?.getMonth();
  const nextMonth = React.useMemo(() => addMonths(pickerMonth, 1), [pickerMonth]);
  const isNextMonthDisabled = !!maxDate && (
    nextMonth.getFullYear() > maxDate.getFullYear()
    || (nextMonth.getFullYear() === maxDate.getFullYear() && nextMonth.getMonth() > maxDate.getMonth())
  );

  const monthOptions = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        capitalizeFirst(format(new Date(2024, i, 1), 'LLLL', { locale: ru })),
      ),
    [],
  );

  // Синхронизируем локальный текст при внешних изменениях value (например, reset формы).
  React.useEffect(() => {
    setText(isoToDisplay(value));
  }, [value]);

  React.useEffect(() => {
    if (!open) return;
    const base = clampByMaxDate(selectedDate ?? new Date(), maxDate);
    setPickerMonth(base);
    setPickerStep('day');
    setYearPageStart(base.getFullYear() - 6);
  }, [open, selectedDate, maxDate]);

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
        onChange={(e) => setText(normalizeTyping(e.target.value))}
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
          {pickerStep === 'day' && (
            <>
              <div className="flex items-center justify-between px-3 pt-3">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setPickerMonth((prev) => addMonths(prev, -1))}
                  aria-label="Предыдущий месяц"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="text-sm font-medium capitalize hover:underline"
                  onClick={() => {
                    setYearPageStart(pickerMonth.getFullYear() - 6);
                    setPickerStep('year');
                  }}
                >
                  {capitalizeFirst(format(pickerMonth, 'LLLL yyyy', { locale: ru }))}
                </button>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground',
                    isNextMonthDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
                  )}
                  onClick={() => {
                    if (isNextMonthDisabled) return;
                    setPickerMonth((prev) => addMonths(prev, 1));
                  }}
                  aria-label="Следующий месяц"
                  disabled={isNextMonthDisabled}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <Calendar
                mode="single"
                selected={selectedDate}
                month={pickerMonth}
                onMonthChange={setPickerMonth}
                hidden={maxDate ? { after: maxDate } : undefined}
                disabled={maxDate ? { after: maxDate } : undefined}
                className="pt-1"
                classNames={{
                  caption: 'hidden',
                  nav: 'hidden',
                }}
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
            </>
          )}

          {pickerStep === 'year' && (
            <div className="w-[280px] p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setYearPageStart((y) => y - 12)}
                  aria-label="Предыдущие годы"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-medium">
                  {yearPageStart} - {yearPageStart + 11}
                </div>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground',
                    maxYear != null &&
                      yearPageStart + 12 > maxYear &&
                      'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
                  )}
                  onClick={() => {
                    if (maxYear != null && yearPageStart + 12 > maxYear) return;
                    setYearPageStart((y) => y + 12);
                  }}
                  aria-label="Следующие годы"
                  disabled={maxYear != null && yearPageStart + 12 > maxYear}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {Array.from({ length: 12 }, (_, i) => yearPageStart + i).map((year) => {
                  const active = pickerMonth.getFullYear() === year;
                  const yearDisabled = maxYear != null && year > maxYear;
                  return (
                    <button
                      key={year}
                      type="button"
                      className={cn(
                        'h-8 rounded-md text-sm hover:bg-accent',
                        active && 'bg-primary text-primary-foreground hover:bg-primary',
                        yearDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                      )}
                      onClick={() => {
                        if (yearDisabled) return;
                        setPickerMonth((prev) => setYear(prev, year));
                        setPickerStep('month');
                      }}
                      disabled={yearDisabled}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {pickerStep === 'month' && (
            <div className="w-[280px] p-3">
              <div className="mb-2 text-center text-sm font-medium">{pickerMonth.getFullYear()}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {monthOptions.map((label, monthIndex) => {
                  const active = pickerMonth.getMonth() === monthIndex;
                  const year = pickerMonth.getFullYear();
                  const monthDisabled =
                    maxYear != null &&
                    (year > maxYear || (year === maxYear && maxMonthIndex != null && monthIndex > maxMonthIndex));
                  return (
                    <button
                      key={label}
                      type="button"
                      className={cn(
                        'h-8 rounded-md text-sm hover:bg-accent',
                        active && 'bg-primary text-primary-foreground hover:bg-primary',
                        monthDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent',
                      )}
                      onClick={() => {
                        if (monthDisabled) return;
                        setPickerMonth((prev) => setMonth(prev, monthIndex));
                        setPickerStep('day');
                      }}
                      disabled={monthDisabled}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
