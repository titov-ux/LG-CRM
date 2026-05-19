import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { USE_MOCKS } from '@/lib/constants';
import './styles/globals.css';

async function bootstrap() {
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
