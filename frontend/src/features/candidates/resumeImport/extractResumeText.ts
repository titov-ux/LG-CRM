/**
 * Универсальный диспетчер «файл → plain-текст» по уже определённому формату.
 *
 * Используется и форматтером, и формой создания кандидата. Все 6 экстракторов
 * имеют разный набор зависимостей (pdfjs/mammoth с CDN, бэкенд для .doc и т.д.),
 * но снаружи — единая сигнатура `(File) → Promise<string>`.
 *
 * Ошибки пробрасываются как есть: для .doc это HTTPError от бэкенда, для
 * остальных — обычные Error из браузера. Вызывающий код решает, как их
 * рендерить (см. ResumeFormatterPage / CandidateForm).
 */
import type { ResumeFormat } from './detectFormat';
import { extractDocText } from './extractDocText';
import { extractDocxText } from './extractDocxText';
import { extractHtmlText } from './extractHtmlText';
import { extractPdfText } from './extractPdfText';
import { extractRtfText } from './extractRtfText';
import { extractTxtText } from './extractTxtText';

/** Схлопнуть горизонтальные пробелы построчно — чинит cairo/HH PDF и кривые DOCX. */
function normalizeResumeWhitespace(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export async function extractResumeText(file: File, format: ResumeFormat): Promise<string> {
  let raw: string;
  switch (format) {
    case 'pdf':
      raw = await extractPdfText(file);
      break;
    case 'docx':
      raw = await extractDocxText(file);
      break;
    case 'doc':
      raw = await extractDocText(file);
      break;
    case 'rtf':
      raw = await extractRtfText(file);
      break;
    case 'txt':
      raw = await extractTxtText(file);
      break;
    case 'html':
      raw = await extractHtmlText(file);
      break;
  }
  return normalizeResumeWhitespace(raw);
}
