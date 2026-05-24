// In-memory cache of full blob/dataURL для документов,
// которые слишком тяжёлые, чтобы класть в localStorage.
// Очищается при перезагрузке — UI должен это учитывать.

import type { DocumentFileMeta, DocumentKind } from './types';

const memCache = new Map<string, string>(); // docId -> blobUrl или dataUrl

export function rememberBlobUrl(docId: string, url: string) {
  // освобождаем предыдущий object URL, если был
  const prev = memCache.get(docId);
  if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
  memCache.set(docId, url);
}

/** Привязать blobUrl к id созданного документа после addDocument */
export function bindBlobToDoc(docId: string, blobUrl: string) {
  rememberBlobUrl(docId, blobUrl);
}

export function getCachedBlobUrl(docId: string): string | undefined {
  return memCache.get(docId);
}

export function forgetBlob(docId: string) {
  const url = memCache.get(docId);
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  memCache.delete(docId);
}

/** Прочитать File → dataURL */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read error'));
    reader.readAsDataURL(file);
  });
}

const KIND_BY_EXT: Record<string, { kind: DocumentKind; emoji: string }> = {
  pdf: { kind: 'pdf', emoji: '📕' },
  doc: { kind: 'doc', emoji: '📄' },
  docx: { kind: 'doc', emoji: '📄' },
  rtf: { kind: 'doc', emoji: '📄' },
  txt: { kind: 'doc', emoji: '📄' },
  md: { kind: 'doc', emoji: '📄' },
  xls: { kind: 'xlsx', emoji: '📊' },
  xlsx: { kind: 'xlsx', emoji: '📊' },
  csv: { kind: 'xlsx', emoji: '📊' },
  ppt: { kind: 'pptx', emoji: '🎯' },
  pptx: { kind: 'pptx', emoji: '🎯' },
};

export function detectKind(file: File): { kind: DocumentKind; emoji: string } {
  if (file.type.startsWith('image/')) return { kind: 'image', emoji: '🖼️' };
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  return KIND_BY_EXT[ext] ?? { kind: 'doc', emoji: '📄' };
}

export function fileMetaFromFile(file: File): Pick<DocumentFileMeta, 'fileName' | 'mime' | 'size'> {
  return {
    fileName: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

/** Лимит входного файла (по UX, не по storage). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 МБ
export const ACCEPTED_MIME_HINT = 'PDF, DOCX, XLSX, PPTX, TXT, изображения';
