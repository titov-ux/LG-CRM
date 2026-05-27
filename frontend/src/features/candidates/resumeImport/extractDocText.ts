/**
 * Извлечение текста из бинарного .doc (Word 97-2003) — через бэкенд.
 *
 * В отличие от PDF/DOCX/RTF/TXT, у .doc нет адекватного браузерного декодера,
 * поэтому файл отправляется на /candidates/extract-doc, где обрабатывается
 * системным antiword. Сетевая ошибка / ошибка парсинга пробрасывается
 * вызывающему коду (ResumeFormatterPage уже умеет рендерить HTTPError тостом).
 */
import { candidatesApi } from '@/api/candidates';

export async function extractDocText(file: File): Promise<string> {
  const { text } = await candidatesApi.extractDocText(file);
  return text;
}
