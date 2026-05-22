import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Пользовательские предпочтения профиля. Живут в localStorage (persist),
// потому что это персональные UI-настройки, а не серверные данные.
// Серверная синхронизация появится на этапе 2 (см. ТЗ §11).

export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'ru' | 'en';

export interface NotificationChannels {
  emailMentions: boolean;
  emailStatusChanges: boolean;
  emailWeeklyDigest: boolean;
  pushMentions: boolean;
  pushStatusChanges: boolean;
  desktopSounds: boolean;
}

interface PreferencesState {
  theme: ThemeMode;
  language: Language;
  timezone: string;
  channels: NotificationChannels;
  twoFactorEnabled: boolean;

  setTheme: (t: ThemeMode) => void;
  setLanguage: (l: Language) => void;
  setTimezone: (tz: string) => void;
  setChannel: <K extends keyof NotificationChannels>(key: K, value: NotificationChannels[K]) => void;
  setTwoFactorEnabled: (v: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'system',
      language: 'ru',
      timezone: 'Europe/Moscow',
      twoFactorEnabled: false,
      channels: {
        emailMentions: true,
        emailStatusChanges: true,
        emailWeeklyDigest: false,
        pushMentions: true,
        pushStatusChanges: false,
        desktopSounds: true,
      },
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setTimezone: (timezone) => set({ timezone }),
      setChannel: (key, value) =>
        set((s) => ({ channels: { ...s.channels, [key]: value } })),
      setTwoFactorEnabled: (twoFactorEnabled) => set({ twoFactorEnabled }),
    }),
    { name: 'crm-lg.preferences' },
  ),
);
