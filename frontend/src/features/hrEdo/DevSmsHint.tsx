import { APP_ENV, USE_MOCKS } from '@/lib/constants';

/** Мок-режим MSW: фиксированный код. */
export const MOCK_OTP_CODE = '123456';

/**
 * Подсказка для dev-контура: SMS реально не уходят (SMS_PROVIDER=log), код
 * виден кадровику в «Кадровые документы» → «SMS (dev)». На проде не рендерится.
 */
export function DevSmsHint() {
  if (USE_MOCKS) {
    return (
      <p className="mt-3 text-center text-[11.5px] text-muted-foreground">
        Демо-режим: код <span className="tnum font-medium text-foreground">{MOCK_OTP_CODE}</span>
      </p>
    );
  }
  if (APP_ENV !== 'dev') return null;
  return (
    <p className="mt-3 text-center text-[11.5px] text-muted-foreground">
      Dev-контур: SMS не отправляются — код в разделе «Кадровые документы» → «SMS (dev)».
    </p>
  );
}
