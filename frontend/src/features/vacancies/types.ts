// Контракт распознавателя вакансий — то, что возвращает эндпоинт POST /vacancies/parse-text.
// ЭТОТ файл сохраняется при переходе на реальную LLM, в отличие от parseVacancyText.ts.

import type { Grade, Priority, WorkFormat } from '@/api/types';

export interface ParsedVacancy {
  title?: string;
  project?: string;
  grade?: Grade;
  format?: WorkFormat;
  priority?: Priority;
  rateClient?: number;
  /** YYYY-MM-DD */
  deadline?: string;
  /** CSV-список технологий */
  stack?: string;
  description?: string;
  requirements?: string;
}
