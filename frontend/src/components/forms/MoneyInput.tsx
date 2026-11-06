import { forwardRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { formatMoneyRub } from '@/lib/utils';

interface MoneyInputProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  name?: string;
  onBlur?: () => void;
  placeholder?: string;
  /** Разрешить копейки/центы (до 2 знаков после «,» или «.») — для ставок в $. */
  allowDecimals?: boolean;
}

/**
 * Денежный инпут с разделителями разрядов.
 *
 * Пока поле в фокусе — показываем «сырые» цифры без пробелов-разделителей.
 * Это ключевой момент: строка в DOM совпадает с тем, что вводит пользователь,
 * поэтому React не переписывает value и каретка не прыгает в конец при каждом
 * нажатии. Форматирование через formatMoneyRub (неразрывные пробелы) применяем
 * только на blur — для отображения. В форму всегда летит чистое число
 * (undefined для пустого/нуля, чтобы zod-схема .positive() не падала).
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, name, onBlur, placeholder, allowDecimals = false }, ref) => {
    const [focused, setFocused] = useState(false);
    const [raw, setRaw] = useState('');

    const hasValue = value != null && value > 0;
    const display = focused
      ? raw
      : hasValue
        ? allowDecimals
          ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value as number)
          : formatMoneyRub(value as number)
        : '';

    return (
      <Input
        type="text"
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
        placeholder={placeholder}
        name={name}
        ref={ref}
        value={display}
        onFocus={() => {
          setRaw(hasValue ? String(value).replace('.', allowDecimals ? ',' : '.') : '');
          setFocused(true);
        }}
        onChange={(e) => {
          if (allowDecimals) {
            // Цифры + один разделитель («,» или «.»), не больше 2 знаков после него.
            const cleaned = e.target.value.replace(/[^\d.,]/g, '').replace(/\./g, ',');
            const [intPart, ...rest] = cleaned.split(',');
            const frac = rest.join('').slice(0, 2);
            const text = rest.length > 0 ? `${intPart},${frac}` : intPart;
            setRaw(text);
            const n = Number(`${intPart || '0'}.${frac || '0'}`);
            onChange(intPart !== '' || frac !== '' ? (n > 0 ? n : undefined) : undefined);
            return;
          }
          const digits = e.target.value.replace(/\D/g, '');
          setRaw(digits);
          const n = Number(digits);
          onChange(digits !== '' && n > 0 ? n : undefined);
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
      />
    );
  },
);
MoneyInput.displayName = 'MoneyInput';
