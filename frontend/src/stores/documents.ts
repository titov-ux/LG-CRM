import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { documentsApi } from '@/api/documents';
import { uploadFile } from '@/api/files';
import { getCachedBlobUrl, urlToFile } from '@/features/documents/fileBlob';
import type { DocumentComment, DocumentFileMeta, DocumentItem, DocumentSectionId, DocumentVersion } from '@/features/documents/types';

export interface SyncResult {
  /** сколько файлов реально доехало в S3 */
  uploaded: number;
  /** сколько не удалось дозагрузить (нет контента или ошибка сети) */
  failed: number;
}

interface DocumentsState {
  documents: DocumentItem[];
  favorites: string[]; // ids
  recentEmojis: string[]; // последние выбранные эмодзи
  /** id «старых» локальных документов, уже пересозданных на сервере (чтобы не дублировать) */
  syncedLegacyIds: string[];
  isLoaded: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  loadDocuments: () => Promise<void>;
  /**
   * Дозагрузка «забытых в браузере» файлов на сервер «под капотом».
   * Покрывает два случая:
   *  1) старые документы из localStorage (version ≤ 2), которые никогда
   *     не уезжали на сервер — пересоздаём запись + грузим файл в S3;
   *  2) документы на сервере с прикреплённым файлом, но без fileId
   *     (загрузка в S3 не прошла) — берём контент из in-memory/dataURL и грузим.
   */
  syncPendingUploads: () => Promise<SyncResult>;
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
  /** Прикрепить/обновить файл к документу (только локальная мета) */
  attachFile: (id: string, file: DocumentFileMeta) => void;
  /** Привязать загруженный в S3 файл: PATCH fileId + локальная мета */
  attachUploadedFile: (id: string, fileId: string, file: DocumentFileMeta) => Promise<void>;
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
    fileId: d.fileId ?? undefined,
    file: d.fileMeta
      ? {
          fileName: d.fileMeta.fileName,
          mime: d.fileMeta.mime,
          size: d.fileMeta.size,
        }
      : undefined,
  };
}

// Снимок «старых» документов из localStorage ДО того, как zustand-persist
// (version 3 migrate) затрёт их. В версиях ≤ 2 документы со встроенным
// file.dataUrl хранились только в браузере и никогда не уезжали на сервер.
// Читаем сырой payload здесь — на этом этапе модуля стор ещё не создан,
// значит persist не успел перезаписать ключ.
function salvageLegacyDocuments(): DocumentItem[] {
  try {
    const raw = localStorage.getItem('crm-lg.documents');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { state?: { documents?: DocumentItem[] } };
    const docs = parsed?.state?.documents ?? [];
    // только реальные файлы с восстановимым контентом, которых ещё нет на сервере
    return docs.filter(
      (d) =>
        !!d.file?.dataUrl &&
        !d.fileId &&
        d.kind !== 'folder' &&
        d.kind !== 'note',
    );
  } catch {
    return [];
  }
}

const LEGACY_PENDING = salvageLegacyDocuments();

export const useDocumentsStore = create<DocumentsState>()(
  persist(
    (set, get) => ({
      documents: [],
      favorites: [],
      recentEmojis: [],
      syncedLegacyIds: [],
      isLoaded: false,
      isLoading: false,
      isSyncing: false,

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

      syncPendingUploads: async () => {
        if (get().isSyncing) return { uploaded: 0, failed: 0 };
        set({ isSyncing: true });
        let uploaded = 0;
        let failed = 0;
        try {
          // 1) Старые локальные документы: их вообще нет на сервере — пересоздаём
          //    запись и грузим файл в S3. parentId не переносим (старые id папок
          //    на сервере не существуют) — кладём в корень раздела.
          const synced = new Set(get().syncedLegacyIds);
          for (const legacy of LEGACY_PENDING) {
            if (synced.has(legacy.id)) continue;
            if (!legacy.file?.dataUrl) continue;
            try {
              const created = await get().addDocument({
                title: legacy.title,
                emoji: legacy.emoji,
                kind: legacy.kind,
                section: legacy.section,
                owner: legacy.owner || 'Я',
                tags: legacy.tags,
                description: legacy.description,
                file: legacy.file,
                body: legacy.body,
              });
              const file = await urlToFile(
                legacy.file.dataUrl,
                legacy.file.fileName,
                legacy.file.mime,
              );
              const rec = await uploadFile({
                entityType: 'document',
                entityId: created.id,
                file,
              });
              await get().attachUploadedFile(created.id, rec.id, {
                fileName: rec.originalName,
                mime: rec.mime,
                size: rec.size,
              });
              uploaded++;
            } catch {
              failed++;
            } finally {
              // помечаем как обработанный в любом случае, чтобы не плодить дубли
              synced.add(legacy.id);
            }
          }
          set({ syncedLegacyIds: Array.from(synced) });

          // 2) Документы на сервере с файлом, но без fileId (S3-загрузка не прошла).
          //    Контент берём из in-memory blob текущей сессии или dataURL.
          const pending = get().documents.filter(
            (d) => !!d.file && !d.fileId && d.kind !== 'folder' && d.kind !== 'note',
          );
          for (const d of pending) {
            const url = getCachedBlobUrl(d.id) ?? d.file?.dataUrl;
            if (!url || !d.file) continue; // контент потерян (перезагрузка) — пропускаем
            try {
              const file = await urlToFile(url, d.file.fileName, d.file.mime);
              const rec = await uploadFile({
                entityType: 'document',
                entityId: d.id,
                file,
              });
              await get().attachUploadedFile(d.id, rec.id, {
                fileName: rec.originalName,
                mime: rec.mime,
                size: rec.size,
                dataUrl: d.file.dataUrl,
              });
              uploaded++;
            } catch {
              failed++;
            }
          }
        } finally {
          set({ isSyncing: false });
        }
        return { uploaded, failed };
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

      attachUploadedFile: async (id, fileId, file) => {
        await documentsApi.update(id, { fileId });
        set((s) => ({
          documents: s.documents.map((d) =>
            d.id === id
              ? {
                  ...d,
                  fileId,
                  file,
                  updatedAt: new Date().toISOString(),
                }
              : d,
          ),
        }));
      },

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
      partialize: (state) => ({
        recentEmojis: state.recentEmojis,
        syncedLegacyIds: state.syncedLegacyIds,
      }),
      migrate: (state: unknown) => {
        const s = (state ?? {}) as Partial<DocumentsState>;
        return {
          recentEmojis: s.recentEmojis ?? [],
          syncedLegacyIds: s.syncedLegacyIds ?? [],
          documents: [],
          favorites: [],
          isLoaded: false,
          isLoading: false,
        } as Partial<DocumentsState>;
      },
    },
  ),
);
