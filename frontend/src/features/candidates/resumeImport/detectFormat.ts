/**
 * Общая логика определения формата резюме и константы для `<input accept>`.
 *
 * Используется в двух местах:
 *  • полноценный «Форматтер резюме» (`ResumeFormatterPage`);
 *  • кнопка «Распознать из файла» в карточке кандидата (`CandidateForm`).
 *
 * Раньше `detectResumeFormat` жил в одном файле, а второе место умело только
 * PDF. После расширения списка форматов вынесли сюда, чтобы не дублировать
 * правила и accept-атрибут.
 */

export type ResumeFormat = 'pdf' | 'docx' | 'doc' | 'rtf' | 'txt' | 'html';

/**
 * Определяем формат по расширению + MIME.
 *
 * Расширение имеет приоритет, потому что .doc/.docx у Windows-юзеров часто
 * приходят с одинаковым `application/msword`, а у Mac-овских PDF-резюме
 * браузер иногда забывает выставить MIME вовсе.
 */
export function detectResumeFormat(file: File): ResumeFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.doc')) return 'doc';
  if (name.endsWith('.rtf')) return 'rtf';
  if (name.endsWith('.txt')) return 'txt';
  if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';

  switch (file.type) {
    case 'application/pdf':
      return 'pdf';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/msword':
      // Без расширения отличить .doc от .docx по MIME нельзя — пусть будет .doc.
      return 'doc';
    case 'application/rtf':
    case 'text/rtf':
      return 'rtf';
    case 'text/plain':
      return 'txt';
    case 'text/html':
    case 'application/xhtml+xml':
      return 'html';
    default:
      return null;
  }
}

/**
 * Готовая строка для атрибута `accept` у `<input type="file">`.
 * Перечисляем и MIME, и расширения — некоторые ОС/браузеры фильтруют
 * только по одному из критериев.
 */
export const RESUME_ACCEPT = [
  'application/pdf',
  '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.docx',
  'application/msword',
  '.doc',
  'application/rtf',
  'text/rtf',
  '.rtf',
  'text/plain',
  '.txt',
  'text/html',
  'application/xhtml+xml',
  '.html',
  '.htm',
].join(',');

/** Человекочитаемый список форматов для тостов/подписей в UI. */
export const RESUME_FORMATS_LABEL = 'PDF, DOCX, DOC, RTF, TXT и HTML';
