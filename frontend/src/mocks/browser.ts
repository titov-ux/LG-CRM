import { setupWorker } from 'msw/browser';
import { enabledHandlers, handlers } from './handlers';

// Стартуем с тем набором handlers, что разрешён `VITE_DISABLED_HANDLERS` —
// домены, перенесённые на боевой бэк, MSW обходит и они летят в API.
export const worker = setupWorker(...enabledHandlers());

// HMR: при правке handlers.ts перерегистрируем обработчики «на лету»,
// иначе MSW продолжает держать старый набор и новые маршруты улетают в bypass.
if (import.meta.hot) {
  import.meta.hot.accept('./handlers', (mod) => {
    if (!mod) return;
    const m = mod as unknown as {
      enabledHandlers?: () => typeof handlers;
      handlers?: typeof handlers;
    };
    const next = m.enabledHandlers ? m.enabledHandlers() : m.handlers;
    if (next) worker.resetHandlers(...next);
  });
}
