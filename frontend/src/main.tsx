import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { USE_MOCKS } from '@/lib/constants';
import { initSentry } from '@/lib/sentry';
import { initTheme } from '@/lib/theme';
import './styles/globals.css';

async function bootstrap() {
  // Тема оформления: применяем выбранную тему и подписываемся на её изменения.
  initTheme();

  // Sentry первым — чтобы ловить ошибки начальной загрузки. Тихо игнорируется,
  // если DSN не задан или пакет не установлен.
  await initSentry();

  if (USE_MOCKS) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

bootstrap();
