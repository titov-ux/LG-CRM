import { create } from 'zustand';

// Глобальный поиск/фильтры для Kanban-страниц. Локальные фильтры конкретных страниц
// живут внутри страниц через useSearch() TanStack Router.

interface FiltersState {
  search: string;
  grade: string | null;
  priority: string | null;
  clientId: string | null;
  recruiterId: string | null;
  setSearch: (v: string) => void;
  setGrade: (v: string | null) => void;
  setPriority: (v: string | null) => void;
  setClientId: (v: string | null) => void;
  setRecruiterId: (v: string | null) => void;
  reset: () => void;
}

export const useFiltersStore = create<FiltersState>((set) => ({
  search: '',
  grade: null,
  priority: null,
  clientId: null,
  recruiterId: null,
  setSearch: (search) => set({ search }),
  setGrade: (grade) => set({ grade }),
  setPriority: (priority) => set({ priority }),
  setClientId: (clientId) => set({ clientId }),
  setRecruiterId: (recruiterId) => set({ recruiterId }),
  reset: () => set({ search: '', grade: null, priority: null, clientId: null, recruiterId: null }),
}));
