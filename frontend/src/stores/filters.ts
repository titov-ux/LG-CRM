import { create } from 'zustand';
import type {
  EmploymentType,
  EngagementType,
  Grade,
  Priority,
} from '@/api/types';

// Глобальный поиск/фильтры для Kanban-страниц. Локальные фильтры конкретных страниц
// (списки клиентов/контактов) живут внутри страниц через useState.
//
// Здесь — общий набор фильтров для канбанов вакансий и кандидатов. Если фильтр
// неприменим к одной из досок (например, priority/clientId не используются на
// доске кандидатов), он просто игнорируется на соответствующей странице.

interface FiltersState {
  search: string;
  grade: Grade | null;
  priority: Priority | null;
  clientId: string | null;
  recruiterId: string | null;
  engagementType: EngagementType | null;
  employmentType: EmploymentType | null;
  setSearch: (v: string) => void;
  setGrade: (v: Grade | null) => void;
  setPriority: (v: Priority | null) => void;
  setClientId: (v: string | null) => void;
  setRecruiterId: (v: string | null) => void;
  setEngagementType: (v: EngagementType | null) => void;
  setEmploymentType: (v: EmploymentType | null) => void;
  /** Сбрасывает все фильтры кроме строки поиска. */
  resetBoardFilters: () => void;
  /** Полный сброс — включая поиск. */
  reset: () => void;
}

const EMPTY_BOARD = {
  grade: null,
  priority: null,
  clientId: null,
  recruiterId: null,
  engagementType: null,
  employmentType: null,
} as const;

export const useFiltersStore = create<FiltersState>((set) => ({
  search: '',
  ...EMPTY_BOARD,
  setSearch: (search) => set({ search }),
  setGrade: (grade) => set({ grade }),
  setPriority: (priority) => set({ priority }),
  setClientId: (clientId) => set({ clientId }),
  setRecruiterId: (recruiterId) => set({ recruiterId }),
  setEngagementType: (engagementType) => set({ engagementType }),
  setEmploymentType: (employmentType) => set({ employmentType }),
  resetBoardFilters: () => set({ ...EMPTY_BOARD }),
  reset: () => set({ search: '', ...EMPTY_BOARD }),
}));
