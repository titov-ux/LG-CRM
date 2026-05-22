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

const DAY_DISPLAY_FORMAT = 'dd.MM.yyyy';
const ISO_DAY_FORMAT = 'yyyy-MM-dd';
const ISO_MONTH_FORMAT = 'yyyy-MM';

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

function tryParseDay(text: string): Date | null {
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

function normalizeTypingMonth(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

type PickerStep = 'day' | 'year' | 'month';
type DateGranularity = 'day' | 'month';

function clampByMaxDate(date: Date, maxDate?: Date): Date {
  if (!maxDate) return date;
  return date > maxDate ? maxDate : date;
}

export interface DateFieldProps {
  /** ISO YYYY-MM-DD или YYYY-MM (в зависимости от granularity). */
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
  granularity?: DateGranularity;
}

function valueToDate(value: string | undefined | null, granularity: DateGranularity): Date | undefined {
  if (!value) return undefined;
  if (granularity === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(value);
    if (!m) return undefined;
    const d = buildDate(Number(m[1]), Number(m[2]), 1);
    return d ?? undefined;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return undefined;
  const d = buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return d ?? undefined;
}

function valueToDisplay(value: string | undefined | null, granularity: DateGranularity): string {
  const d = valueToDate(value, granularity);
  if (!d) return '';
  return granularity === 'month' ? format(d, ISO_MONTH_FORMAT) : format(d, DAY_DISPLAY_FORMAT);
}

function tryParseMonth(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const ymd = /^(\d{4})[-./](\d{1,2})$/.exec(trimmed);
  if (ymd) return buildDate(Number(ymd[1]), Number(ymd[2]), 1);

  const mdy = /^(\d{1,2})[-./](\d{4})$/.exec(trimmed);
  if (mdy) return buildDate(Number(mdy[2]), Number(mdy[1]), 1);

  if (/^\d{6}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6));
    return buildDate(year, month, 1);
  }

  return null;
}

function tryParseByGranularity(text: string, granularity: DateGranularity): Date | null {
  return granularity === 'month' ? tryParseMonth(text) : tryParseDay(text);
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
  granularity = 'day',
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState<string>(() => valueToDisplay(value, granularity));
  const selectedDate = valueToDate(value, granularity);
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
    setText(valueToDisplay(value, granularity));
  }, [value, granularity]);

  React.useEffect(() => {
    if (!open) return;
    // Если пользователь уже набрал валидную дату, но ещё не потерял фокус,
    // синхронизируем пикер именно с текстом инпута, чтобы редактирование через
    // календарь работало предсказуемо для уже заполненного поля.
    const parsedFromText = tryParseByGranularity(text, granularity);
    const base = clampByMaxDate(parsedFromText ?? selectedDate ?? new Date(), maxDate);
    setPickerMonth(base);
    setPickerStep(granularity === 'month' ? 'month' : 'day');
    setYearPageStart(base.getFullYear() - 6);
  }, [open, selectedDate, maxDate, granularity, text]);

  const commitText = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange('');
      setText('');
      return;
    }
    const parsed = granularity === 'month' ? tryParseMonth(trimmed) : tryParseDay(trimmed);
    if (parsed) {
      const output = granularity === 'month'
        ? format(parsed, ISO_MONTH_FORMAT)
        : format(parsed, ISO_DAY_FORMAT);
      onChange(output);
      setText(granularity === 'month' ? output : format(parsed, DAY_DISPLAY_FORMAT));
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
        onChange={(e) =>
          setText(
            granularity === 'month'
              ? normalizeTypingMonth(e.target.value)
              : normalizeTyping(e.target.value),
          )
        }
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
          {granularity === 'day' && pickerStep === 'day' && (
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
                    onChange(format(d, ISO_DAY_FORMAT));
                    setText(format(d, DAY_DISPLAY_FORMAT));
                  } else {
                    onChange('');
                    setText('');
                  }
                  setOpen(false);
                }}
              />
            </>
          )}

          {granularity === 'month' && (
            <div className="w-[280px] p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() => setPickerMonth((prev) => setYear(prev, prev.getFullYear() - 1))}
                  aria-label="Предыдущий год"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="text-sm font-medium">{pickerMonth.getFullYear()}</div>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground',
                    maxYear != null &&
                      pickerMonth.getFullYear() + 1 > maxYear &&
                      'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
                  )}
                  onClick={() => {
                    if (maxYear != null && pickerMonth.getFullYear() + 1 > maxYear) return;
                    setPickerMonth((prev) => setYear(prev, prev.getFullYear() + 1));
                  }}
                  aria-label="Следующий год"
                  disabled={maxYear != null && pickerMonth.getFullYear() + 1 > maxYear}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {monthOptions.map((label, monthIndex) => {
                  const year = pickerMonth.getFullYear();
                  const active =
                    selectedDate != null &&
                    selectedDate.getFullYear() === year &&
                    selectedDate.getMonth() === monthIndex;
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
                        const picked = new Date(year, monthIndex, 1);
                        onChange(format(picked, ISO_MONTH_FORMAT));
                        setText(format(picked, ISO_MONTH_FORMAT));
                        setOpen(false);
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

          {granularity === 'day' && pickerStep === 'year' && (
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

          {granularity === 'day' && pickerStep === 'month' && (
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
