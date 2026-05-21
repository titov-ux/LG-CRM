import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

// HMR: при правке handlers.ts перерегистрируем обработчики «на лету»,
// иначе MSW продолжает держать старый набор и новые маршруты улетают в bypass.
if (import.meta.hot) {
  import.meta.hot.accept('./handlers', (mod) => {
    if (!mod) return;
    const next = (mod as unknown as { handlers?: typeof handlers }).handlers;
    if (next) worker.resetHandlers(...next);
  });
}
