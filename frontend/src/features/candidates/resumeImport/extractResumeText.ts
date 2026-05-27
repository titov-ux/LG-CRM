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

export async function extractResumeText(file: File, format: ResumeFormat): Promise<string> {
  switch (format) {
    case 'pdf':
      return extractPdfText(file);
    case 'docx':
      return extractDocxText(file);
    case 'doc':
      return extractDocText(file);
    case 'rtf':
      return extractRtfText(file);
    case 'txt':
      return extractTxtText(file);
    case 'html':
      return extractHtmlText(file);
  }
}
