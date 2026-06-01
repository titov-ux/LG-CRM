import { usePreferencesStore, type ThemeMode } from '@/stores/preferences';

// Применение темы оформления. Источник истины — preferences-стор (localStorage).
// Класс `.dark` навешивается на <html>; режим 'system' следует за настройкой ОС
// через matchMedia. Анти-FOUC выполняется инлайн-скриптом в index.html ещё до
// загрузки бандла — здесь же поддерживаем класс в актуальном состоянии.

const mql =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

function prefersDark(theme: ThemeMode): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return mql?.matches ?? false;
}

/** Навесить/снять класс `.dark` и colorScheme на корневой элемент. */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const dark = prefersDark(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * Инициализация: применить текущую тему, подписаться на изменения стора и на
 * системную смену темы (только когда выбран режим 'system'). Вызывать один раз
 * при старте приложения.
 */
export function initTheme(): void {
  applyTheme(usePreferencesStore.getState().theme);

  usePreferencesStore.subscribe((state) => applyTheme(state.theme));

  mql?.addEventListener('change', () => {
    if (usePreferencesStore.getState().theme === 'system') {
      applyTheme('system');
    }
  });
}
