import { api } from './client';
import type { UUID } from './types';

export type DocumentSectionId =
  | 'clients'
  | 'regulations'
  | 'company'
  | 'employees'
  | 'contractors'
  | 'tender'
  | 'general';

export type DocumentKind = 'doc' | 'pdf' | 'xlsx' | 'pptx' | 'image' | 'folder' | 'note';

export interface DocumentFileMeta {
  fileName: string;
  mime: string;
  size: number;
}

export interface DocumentDto {
  id: UUID;
  title: string;
  emoji: string;
  kind: DocumentKind;
  section: DocumentSectionId;
  parentId?: UUID | null;
  description?: string | null;
  tags?: string[];
  ownerUserId: UUID;
  ownerName?: string;
  fileId?: UUID | null;
  fileMeta?: DocumentFileMeta | null;
  body?: string | null;
  versionsCount?: number;
  commentsCount?: number;
  isFavorite?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersionDto {
  id: UUID;
  documentId: UUID;
  label: string;
  note?: string | null;
  authorUserId: UUID;
  authorName?: string;
  fileId?: UUID | null;
  createdAt: string;
}

export interface DocumentCommentDto {
  id: UUID;
  documentId: UUID;
  text: string;
  authorUserId: UUID;
  authorName?: string;
  createdAt: string;
}

export interface DocumentPage {
  items: DocumentDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListDocumentsParams {
  page?: number;
  pageSize?: number;
  section?: DocumentSectionId;
  parentId?: UUID;
  kind?: DocumentKind;
  tag?: string;
  favorite?: boolean;
  q?: string;
  ownerId?: UUID;
  sortBy?: 'updated' | 'oldest' | 'title' | 'owner' | 'kind';
  sortDir?: 'asc' | 'desc';
}

export interface CreateDocumentRequest {
  title: string;
  emoji: string;
  kind: DocumentKind;
  section: DocumentSectionId;
  parentId?: UUID;
  description?: string;
  tags?: string[];
  ownerUserId?: UUID;
  fileId?: UUID;
  body?: string | null;
}

export interface UpdateDocumentRequest {
  title?: string;
  emoji?: string;
  description?: string | null;
  tags?: string[];
  ownerUserId?: UUID;
  fileId?: UUID | null;
  body?: string | null;
}

export interface MoveDocumentRequest {
  section: DocumentSectionId;
  parentId?: UUID;
}

export interface BulkMoveDocumentsRequest {
  ids: UUID[];
  section: DocumentSectionId;
  parentId?: UUID;
}

export interface CreateDocumentVersionRequest {
  label: string;
  note?: string;
  fileId?: UUID;
}

export const documentsApi = {
  list: (params: ListDocumentsParams = {}) => {
    const searchParams: Record<string, string> = {};
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      searchParams[k] = String(v);
    });
    return api.get('documents', { searchParams }).json<DocumentPage>();
  },
  byId: (id: UUID) => api.get(`documents/${id}`).json<DocumentDto>(),
  create: (payload: CreateDocumentRequest) => api.post('documents', { json: payload }).json<DocumentDto>(),
  update: (id: UUID, payload: UpdateDocumentRequest) =>
    api.patch(`documents/${id}`, { json: payload }).json<DocumentDto>(),
  remove: (id: UUID) => api.delete(`documents/${id}`).json<{ ok: true }>(),
  move: (id: UUID, payload: MoveDocumentRequest) =>
    api.post(`documents/${id}/move`, { json: payload }).json<DocumentDto>(),
  bulkMove: (payload: BulkMoveDocumentsRequest) =>
    api.post('documents/bulk-move', { json: payload }).json<{ moved: number }>(),
  bulkDelete: (ids: UUID[]) => api.post('documents/bulk-delete', { json: { ids } }).json<{ deleted: number }>(),
  duplicate: (id: UUID) => api.post(`documents/${id}/duplicate`).json<DocumentDto>(),
  setFavorite: (id: UUID, favorite: boolean) =>
    api.put(`documents/${id}/favorite`, { json: { favorite } }).json<{ ok: true }>(),
  listVersions: (id: UUID) => api.get(`documents/${id}/versions`).json<DocumentVersionDto[]>(),
  createVersion: (id: UUID, payload: CreateDocumentVersionRequest) =>
    api.post(`documents/${id}/versions`, { json: payload }).json<DocumentVersionDto>(),
  listComments: (id: UUID) => api.get(`documents/${id}/comments`).json<DocumentCommentDto[]>(),
  createComment: (id: UUID, text: string) =>
    api.post(`documents/${id}/comments`, { json: { text } }).json<DocumentCommentDto>(),
};

