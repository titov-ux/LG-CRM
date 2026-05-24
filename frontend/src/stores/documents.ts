import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  DocumentComment,
  DocumentFileMeta,
  DocumentItem,
  DocumentSectionId,
  DocumentVersion,
} from '@/features/documents/types';
import { DOCUMENTS } from '@/features/documents/mocks';

/** Граница, до которой кладём dataURL в persist-store (≈2МБ исходного файла ≈ 2.7МБ base64). */
const PERSIST_BLOB_LIMIT = 2 * 1024 * 1024;

// Локальный стор документов. Пока работаем без бэка — данные и избранное
// живут в localStorage. При появлении API заменится на TanStack Query +
// серверная мутация, а избранное переедет в user preferences.

interface DocumentsState {
  documents: DocumentItem[];
  favorites: string[]; // ids
  recentEmojis: string[]; // последние выбранные эмодзи
  // CRUD
  addDocument: (doc: Omit<DocumentItem, 'id' | 'updatedAt'>) => DocumentItem;
  updateDocument: (id: string, patch: Partial<Omit<DocumentItem, 'id'>>) => void;
  deleteDocument: (id: string) => void;
  moveDocument: (id: string, section: DocumentSectionId, parentId?: string) => void;
  setEmoji: (id: string, emoji: string) => void;
  /** Дублирование документа (новая копия, не разделяет blob-контент) */
  duplicateDocument: (id: string) => DocumentItem | null;
  /** Прикрепить/обновить файл к документу */
  attachFile: (id: string, file: DocumentFileMeta) => void;
  // Bulk
  bulkDelete: (ids: string[]) => void;
  bulkMove: (ids: string[], section: DocumentSectionId, parentId?: string) => void;
  // Versions & comments
  addVersion: (id: string, version: Omit<DocumentVersion, 'id' | 'createdAt'>) => void;
  addComment: (id: string, comment: Omit<DocumentComment, 'id' | 'createdAt'>) => void;
  // Favorites
  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;
  // Emoji recents
  pushRecentEmoji: (e: string) => void;
  // Maintenance
  resetToSeed: () => void;
}

const nowIso = () => new Date().toISOString();
const newId = () => `d-${Math.random().toString(36).slice(2, 10)}`;

export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set, get) => ({
      documents: DOCUMENTS,
      favorites: [],
      recentEmojis: [],

      addDocument: (doc) => {
        // если файл большой — dataURL в persist не пишем, остаётся только в in-memory кэше
        const file = doc.file
          ? doc.file.size <= PERSIST_BLOB_LIMIT
            ? doc.file
            : { ...doc.file, dataUrl: undefined }
          : undefined;
        const created: DocumentItem = {
          ...doc,
          file,
          id: newId(),
          updatedAt: nowIso(),
        };
        set((s) => ({ documents: [created, ...s.documents] }));
        return created;
      },

      updateDocument: (id, patch) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: nowIso() } : d,
          ),
        })),

      deleteDocument: (id) =>
        set((s) => ({
          documents: s.documents.filter((d) => d.id !== id),
          favorites: s.favorites.filter((f) => f !== id),
        })),

      moveDocument: (id, section, parentId) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, section, parentId, updatedAt: nowIso() } : d,
          ),
        })),

      bulkDelete: (ids) =>
        set((s) => {
          const idSet = new Set(ids);
          return {
            documents: s.documents.filter((d) => !idSet.has(d.id)),
            favorites: s.favorites.filter((f) => !idSet.has(f)),
          };
        }),

      bulkMove: (ids, section, parentId) =>
        set((s) => {
          const idSet = new Set(ids);
          return {
            documents: s.documents.map((d) =>
              idSet.has(d.id)
                ? { ...d, section, parentId, updatedAt: nowIso() }
                : d,
            ),
          };
        }),

      duplicateDocument: (id) => {
        const original = get().documents.find((d) => d.id === id);
        if (!original) return null;
        const copy: DocumentItem = {
          ...original,
          id: newId(),
          title: `${original.title} — копия`,
          updatedAt: nowIso(),
          versions: [],
          comments: [],
        };
        set((s) => ({ documents: [copy, ...s.documents] }));
        return copy;
      },

      attachFile: (id, file) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  file: file.size <= PERSIST_BLOB_LIMIT ? file : { ...file, dataUrl: undefined },
                  updatedAt: nowIso(),
                }
              : d,
          ),
        })),

      addVersion: (id, version) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  versions: [
                    {
                      id: newId(),
                      createdAt: nowIso(),
                      ...version,
                    },
                    ...(d.versions ?? []),
                  ],
                  updatedAt: nowIso(),
                }
              : d,
          ),
        })),

      addComment: (id, comment) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  comments: [
                    ...(d.comments ?? []),
                    {
                      id: newId(),
                      createdAt: nowIso(),
                      ...comment,
                    },
                  ],
                }
              : d,
          ),
        })),

      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id)
            ? s.favorites.filter((f) => f !== id)
            : [...s.favorites, id],
        })),

      isFavorite: (id) => get().favorites.includes(id),

      setEmoji: (id, emoji) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, emoji, updatedAt: nowIso() } : d,
          ),
        })),

      pushRecentEmoji: (e) =>
        set((s) => {
          const next = [e, ...s.recentEmojis.filter((x) => x !== e)].slice(0, 24);
          return { recentEmojis: next };
        }),

      resetToSeed: () => set({ documents: DOCUMENTS, favorites: [], recentEmojis: [] }),
    }),
    {
      name: 'crm-lg.documents',
      version: 2,
      // Идемпотентная миграция: добираем seed-документы новых разделов,
      // не затрагивая то, что пользователь уже добавил/изменил вручную.
      migrate: (state: unknown, _from: number) => {
        const s = (state ?? {}) as Partial<DocumentsState>;
        const existing = s.documents ?? [];
        const existingIds = new Set(existing.map((d) => d.id));
        const missing = DOCUMENTS.filter((d) => !existingIds.has(d.id));
        return {
          ...s,
          documents: [...missing, ...existing],
          favorites: s.favorites ?? [],
          recentEmojis: s.recentEmojis ?? [],
        } as DocumentsState;
      },
    },
  ),
);
