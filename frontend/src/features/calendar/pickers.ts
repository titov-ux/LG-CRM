/**
 * Лёгкие справочники для форм календаря: пользователи (участники),
 * кандидаты и вакансии. Намеренно не зависим от feature-хуков других модулей —
 * календарь самодостаточен. Форму ответа списков нормализуем защитно
 * (массив либо {items}/{data}).
 */
import { useQuery } from '@tanstack/react-query';
import { usersApi } from '@/api/users';
import { candidatesApi } from '@/api/candidates';
import { vacanciesApi } from '@/api/vacancies';
import type { Candidate, User, Vacancy } from '@/api/types';

function normalize<T>(page: unknown): T[] {
  if (Array.isArray(page)) return page as T[];
  if (page && typeof page === 'object') {
    const obj = page as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.results)) return obj.results as T[];
  }
  return [];
}

export function useUsersList(enabled = true) {
  return useQuery({
    queryKey: ['calendar', 'pick', 'users'],
    queryFn: async () => normalize<User>(await usersApi.list()),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useCandidatesList(enabled = true) {
  return useQuery({
    queryKey: ['calendar', 'pick', 'candidates'],
    // Бэкенд ограничивает pageSize значением le=200 — больше отдаёт 422,
    // и тогда дропдаун кандидатов оставался пустым.
    queryFn: async () => normalize<Candidate>(await candidatesApi.list({ pageSize: 200 })),
    staleTime: 60_000,
    enabled,
  });
}

export function useVacanciesList(enabled = true) {
  return useQuery({
    queryKey: ['calendar', 'pick', 'vacancies', { pageSize: 200 }],
    // Как у кандидатов: бэкенд режет pageSize сверху (le=200), иначе в пикере
    // не хватает «моих» вакансий с хвоста списка.
    queryFn: async () =>
      normalize<Vacancy>(
        await (vacanciesApi as { list: (p?: unknown) => Promise<unknown> }).list({
          pageSize: 200,
        }),
      ),
    staleTime: 60_000,
    enabled,
  });
}
