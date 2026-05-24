/**
 * Идентификатор «этой вкладки» — нужен для realtime-канала: backend пересылает
 * собственный X-Client-Id в payload события, и фронт игнорирует эхо своих же
 * мутаций, чтобы оптимистичные апдейты не «дёргались» туда-обратно.
 *
 * sessionStorage намеренно: на каждую вкладку — свой id, переживает reload.
 */
const STORAGE_KEY = '__crm_lg_client_id__';

function generate(): string {
  // crypto.randomUUID — есть везде кроме старого Safari; fallback на Math.random
  // тоже норм: id нужен только для дедупликации внутри сессии.
  try {
    return crypto.randomUUID();
  } catch {
    return `c_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }
}

let cached: string | null = null;

export function getClientId(): string {
  if (cached) return cached;
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) {
      cached = existing;
      return existing;
    }
    const fresh = generate();
    sessionStorage.setItem(STORAGE_KEY, fresh);
    cached = fresh;
    return fresh;
  } catch {
    // SSR / приватный режим без storage — id живёт в памяти модуля.
    if (!cached) cached = generate();
    return cached;
  }
}
