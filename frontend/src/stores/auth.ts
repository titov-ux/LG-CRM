import { create } from 'zustand';
import type { User } from '@/api/types';

// Доступ-токен живёт только в памяти (Zustand). Refresh — в httpOnly cookie, недоступен JS.
// См. архитектуру §7.2.

interface AuthState {
  user: User | null;
  accessToken: string | null;
  setUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  setUser: (user) => set({ user }),
  setAccessToken: (accessToken) => set({ accessToken }),
  clear: () => set({ user: null, accessToken: null }),
}));
