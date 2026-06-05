// Тонкий клиент к /files/*.
// MSW для этого домена ничего не делает (см. mocks/handlers.ts) — файлы появились
// сразу с боевым бэком на Этапе 6. Если фронт работает с VITE_USE_MOCKS=true,
// этот API будет уходить «в никуда» и UI должен это учитывать (отрисовка пустого
// списка/ошибки, либо целиком прятать блок «Файлы резюме»).

import { api } from './client';
import type { UUID } from './types';

export type FileEntityType =
  | 'candidate'
  | 'vacancy'
  | 'client'
  | 'contact'
  | 'chat_message'
  | 'document';

export type ScanStatus = 'pending' | 'clean' | 'infected' | 'error';

export interface FileResponse {
  id: UUID;
  ownerUserId: UUID;
  entityType: FileEntityType;
  entityId: UUID;
  fileKey: string;
  originalName: string;
  mime: string;
  size: number;
  scanStatus: ScanStatus;
  scannedAt?: string | null;
  createdAt: string;
}

export interface PresignRequest {
  entityType: FileEntityType;
  entityId: UUID;
  originalName: string;
  mime: string;
  size: number;
}

export interface PresignResponse {
  url: string;
  fields: Record<string, string>;
  fileKey: string;
  maxBytes: number;
}

export interface ConfirmRequest {
  fileKey: string;
  entityType: FileEntityType;
  entityId: UUID;
  originalName: string;
  mime: string;
  size: number;
}

export interface DownloadResponse {
  url: string;
  expiresIn: number;
}

export interface RenderPdfRequest {
  html: string;
  filename: string;
}

export const filesApi = {
  presign: (payload: PresignRequest) =>
    api.post('files/presign', { json: payload }).json<PresignResponse>(),
  confirm: (payload: ConfirmRequest) =>
    api.post('files/confirm', { json: payload }).json<FileResponse>(),
  list: (entityType: FileEntityType, entityId: UUID) =>
    api
      .get('files', { searchParams: { entityType, entityId } })
      .json<FileResponse[]>(),
  download: (id: UUID) => api.get(`files/${id}/download`).json<DownloadResponse>(),
  renderPdf: (payload: RenderPdfRequest) => api.post('files/render-pdf', { json: payload }).blob(),
  remove: (id: UUID) => api.delete(`files/${id}`).json<{ ok: true }>(),
};

/**
 * Хелпер: загружает файл напрямую в S3 через presigned POST.
 * Возвращает созданную запись в БД (через /files/confirm).
 *
 * Использование:
 *   const rec = await uploadFile({ entityType: 'candidate', entityId, file })
 *
 * При желании можно прокинуть `onProgress` через XMLHttpRequest вместо fetch.
 */
export async function uploadFile(args: {
  entityType: FileEntityType;
  entityId: UUID;
  file: File;
}): Promise<FileResponse> {
  const { entityType, entityId, file } = args;
  const pres = await filesApi.presign({
    entityType,
    entityId,
    originalName: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  });

  // S3 POST: все поля из pres.fields + 'file' в конце.
  const form = new FormData();
  for (const [k, v] of Object.entries(pres.fields)) form.append(k, v);
  form.append('file', file);
  const s3res = await fetch(pres.url, { method: 'POST', body: form });
  if (!s3res.ok) {
    throw new Error(`S3 upload failed: ${s3res.status} ${s3res.statusText}`);
  }

  return filesApi.confirm({
    fileKey: pres.fileKey,
    entityType,
    entityId,
    originalName: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
  });
}
