import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { documentsApi } from '@/api/documents';
import type { DocumentComment, DocumentFileMeta, DocumentItem, DocumentSectionId, DocumentVersion } from '@/features/documents/types';

interface DocumentsState {
  documents: DocumentItem[];
  favorites: string[]; // ids
  recentEmojis: string[]; // последние выбранные эмодзи
  isLoaded: boolean;
  isLoading: boolean;
  loadDocuments: () => Promise<void>;
  reloadDocument: (id: string) => Promise<void>;
  loadDocumentExtras: (id: string) => Promise<void>;
  // CRUD
  addDocument: (doc: Omit<DocumentItem, 'id' | 'updatedAt'>) => Promise<DocumentItem>;
  updateDocument: (id: string, patch: Partial<Omit<DocumentItem, 'id'>>) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  moveDocument: (id: string, section: DocumentSectionId, parentId?: string) => Promise<void>;
  setEmoji: (id: string, emoji: string) => Promise<void>;
  /** Дублирование документа (новая копия, не разделяет blob-контент) */
  duplicateDocument: (id: string) => Promise<DocumentItem | null>;
  /** Прикрепить/обновить файл к документу */
  attachFile: (id: string, file: DocumentFileMeta) => void;
  // Bulk
  bulkDelete: (ids: string[]) => Promise<void>;
  bulkMove: (ids: string[], section: DocumentSectionId, parentId?: string) => Promise<void>;
  // Versions & comments
  addVersion: (id: string, version: Omit<DocumentVersion, 'id' | 'createdAt'>) => Promise<void>;
  addComment: (id: string, comment: Omit<DocumentComment, 'id' | 'createdAt'>) => Promise<void>;
  // Favorites
  toggleFavorite: (id: string) => Promise<void>;
  isFavorite: (id: string) => boolean;
  // Emoji recents
  pushRecentEmoji: (e: string) => void;
  resetToSeed: () => Promise<void>;
}

function mapDoc(d: Awaited<ReturnType<typeof documentsApi.byId>>): DocumentItem {
  return {
    id: d.id,
    title: d.title,
    emoji: d.emoji,
    kind: d.kind,
    section: d.section,
    updatedAt: d.updatedAt,
    owner: d.ownerName || 'Я',
    tags: d.tags ?? [],
    description: d.description ?? undefined,
    parentId: d.parentId ?? undefined,
    body: d.body ?? undefined,
    file: d.fileMeta
      ? {
          fileName: d.fileMeta.fileName,
          mime: d.fileMeta.mime,
          size: d.fileMeta.size,
        }
      : undefined,
  };
}

export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set, get) => ({
      documents: [],
      favorites: [],
      recentEmojis: [],
      isLoaded: false,
      isLoading: false,

      loadDocuments: async () => {
        if (get().isLoading) return;
        set({ isLoading: true });
        try {
          const pageSize = 500;
          let page = 1;
          const all: DocumentItem[] = [];
          let favs: string[] = [];
          while (true) {
            const res = await documentsApi.list({ page, pageSize });
            all.push(...res.items.map(mapDoc));
            favs = favs.concat(res.items.filter((x) => x.isFavorite).map((x) => x.id));
            if (res.items.length < pageSize) break;
            page += 1;
          }
          set({
            documents: all,
            favorites: Array.from(new Set(favs)),
            isLoaded: true,
            isLoading: false,
          });
        } catch {
          set({ isLoading: false });
        }
      },

      reloadDocument: async (id) => {
        const doc = await documentsApi.byId(id);
        set((s) => {
          const item = mapDoc(doc);
          return {
            documents: s.documents.map((d) => (d.id === id ? { ...d, ...item } : d)),
            favorites: doc.isFavorite
              ? Array.from(new Set([...s.favorites, id]))
              : s.favorites.filter((f) => f !== id),
          };
        });
      },

      loadDocumentExtras: async (id) => {
        const [versions, comments] = await Promise.all([
          documentsApi.listVersions(id),
          documentsApi.listComments(id),
        ]);
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  versions: versions.map((v) => ({
                    id: v.id,
                    label: v.label,
                    createdAt: v.createdAt,
                    author: v.authorName || 'Система',
                    note: v.note ?? undefined,
                  })),
                  comments: comments.map((c) => ({
                    id: c.id,
                    author: c.authorName || 'Система',
                    createdAt: c.createdAt,
                    text: c.text,
                  })),
                }
              : d,
          ),
        }));
      },

      addDocument: async (doc) => {
        const created = await documentsApi.create({
          title: doc.title,
          emoji: doc.emoji,
          kind: doc.kind,
          section: doc.section,
          parentId: doc.parentId,
          description: doc.description,
          tags: doc.tags,
          body: doc.body ?? null,
        });
        const mapped = mapDoc(created);
        const item: DocumentItem = {
          ...mapped,
          file: doc.file ?? mapped.file,
          owner: doc.owner || mapped.owner,
        };
        set((s) => ({ documents: [item, ...s.documents] }));
        return item;
      },

      updateDocument: async (id, patch) => {
        const updated = await documentsApi.update(id, {
          title: patch.title,
          emoji: patch.emoji,
          description: patch.description ?? null,
          tags: patch.tags,
          body: patch.body ?? null,
        });
        const mapped = mapDoc(updated);
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  ...mapped,
                  file: patch.file ?? d.file,
                }
              : d,
          ),
        }));
      },

      deleteDocument: async (id) => {
        await documentsApi.remove(id);
        set((s) => ({
          documents: s.documents.filter((d) => d.id !== id && d.parentId !== id),
          favorites: s.favorites.filter((f) => f !== id),
        }));
      },

      moveDocument: async (id, section, parentId) => {
        const moved = await documentsApi.move(id, { section, parentId });
        const mapped = mapDoc(moved);
        set((s) => ({
          documents: s.documents.map((d) => (d.id === id ? { ...d, ...mapped } : d)),
        }));
      },

      bulkDelete: async (ids) => {
        await documentsApi.bulkDelete(ids);
        const idSet = new Set(ids);
        set((s) => ({
          documents: s.documents.filter((d) => !idSet.has(d.id)),
          favorites: s.favorites.filter((f) => !idSet.has(f)),
        }));
      },

      bulkMove: async (ids, section, parentId) => {
        await documentsApi.bulkMove({ ids, section, parentId });
        const idSet = new Set(ids);
        set((s) => ({
          documents: s.documents.map((d) =>
            idSet.has(d.id) ? { ...d, section, parentId, updatedAt: new Date().toISOString() } : d,
          ),
        }));
      },

      duplicateDocument: async (id) => {
        try {
          const copy = await documentsApi.duplicate(id);
          const item = mapDoc(copy);
          set((s) => ({ documents: [item, ...s.documents] }));
          return item;
        } catch {
          return null;
        }
      },

      attachFile: (id, file) =>
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  file,
                  updatedAt: new Date().toISOString(),
                }
              : d,
          ),
        })),

      addVersion: async (id, version) => {
        const created = await documentsApi.createVersion(id, {
          label: version.label,
          note: version.note,
        });
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  versions: [
                    {
                      id: created.id,
                      label: created.label,
                      createdAt: created.createdAt,
                      author: created.authorName || version.author,
                      note: created.note ?? undefined,
                    },
                    ...(d.versions ?? []),
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : d,
          ),
        }));
      },

      addComment: async (id, comment) => {
        const created = await documentsApi.createComment(id, comment.text);
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  comments: [
                    ...(d.comments ?? []),
                    {
                      id: created.id,
                      createdAt: created.createdAt,
                      author: created.authorName || comment.author,
                      text: created.text,
                    },
                  ],
                  updatedAt: new Date().toISOString(),
                }
              : d,
          ),
        }));
      },

      toggleFavorite: async (id) => {
        const isFav = get().favorites.includes(id);
        await documentsApi.setFavorite(id, !isFav);
        set((s) => ({
          favorites: isFav ? s.favorites.filter((f) => f !== id) : [...s.favorites, id],
        }));
      },

      isFavorite: (id) => get().favorites.includes(id),

      setEmoji: async (id, emoji) => {
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id ? { ...d, emoji, updatedAt: new Date().toISOString() } : d,
          ),
        }));
        await documentsApi.update(id, { emoji });
      },

      pushRecentEmoji: (e) =>
        set((s) => {
          const next = [e, ...s.recentEmojis.filter((x) => x !== e)].slice(0, 24);
          return { recentEmojis: next };
        }),

      resetToSeed: async () => {
        await get().loadDocuments();
      },
    }),
    {
      name: 'crm-lg.documents',
      version: 3,
      partialize: (state) => ({ recentEmojis: state.recentEmojis }),
      migrate: (state: unknown) => {
        const s = (state ?? {}) as Partial<DocumentsState>;
        return {
          recentEmojis: s.recentEmojis ?? [],
          documents: [],
          favorites: [],
          isLoaded: false,
          isLoading: false,
        } as Partial<DocumentsState>;
      },
    },
  ),
);
