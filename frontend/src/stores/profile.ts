import { create } from 'zustand';
import type { User } from '@/api/types';

/** Минимум для открытия профиля; полные данные подтягиваются из списка пользователей. */
export type ProfileUserRef = Pick<User, 'id' | 'fullName' | 'initials' | 'color'> &
  Partial<Pick<User, 'email' | 'telegram' | 'role' | 'isActive'>>;

interface ProfileState {
  open: boolean;
  user: ProfileUserRef | null;
  openProfile: (user: ProfileUserRef) => void;
  setOpen: (open: boolean) => void;
}

export const useProfileStore = create<ProfileState>((set) => ({
  open: false,
  user: null,
  openProfile: (user) => set({ open: true, user }),
  setOpen: (open) => set((s) => ({ open, user: open ? s.user : null })),
}));
