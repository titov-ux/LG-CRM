import { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  FileType,
  FolderClosed,
  FolderPlus,
  Globe,
  Image as ImageIcon,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/common/EmptyState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useDocumentsStore } from '@/stores/documents';
import { SECTIONS } from './mocks';
import type { DocumentItem, DocumentKind, DocumentSectionId, DocumentTemplate } from './types';
import { DocumentFormDialog } from './DocumentFormDialog';
import { UploadDialog } from './UploadDialog';
import { MoveDialog } from './MoveDialog';
import { PreviewDialog } from './PreviewDialog';
import { EmojiPicker } from './EmojiPicker';
import { TemplatesDialog } from './TemplatesDialog';

type ScopeId = DocumentSectionId | 'all' | 'favorites';
type SortBy = 'updated' | 'oldest' | 'title' | 'owner';

const KIND_ICON: Record<DocumentKind, LucideIcon> = {
  doc: FileText,
  pdf: FileType,
  xlsx: FileSpreadsheet,
  pptx: FileText,
  image: ImageIcon,
  folder: FolderClosed,
};

const KIND_COLOR: Record<DocumentKind, string> = {
  doc: 'text-blue-600 bg-blue-50',
  pdf: 'text-red-600 bg-red-50',
  xlsx: 'text-emerald-600 bg-emerald-50',
  pptx: 'text-orange-600 bg-orange-50',
  image: 'text-purple-600 bg-purple-50',
  folder: 'text-amber-600 bg-amber-50',
};

const KIND_LABEL: Record<DocumentKind, string> = {
  doc: 'Документ',
  pdf: 'PDF',
  xlsx: 'Таблица',
  pptx: 'Презентация',
  image: 'Изображение',
  folder: 'Папка',
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'сегодня';
  if (diff < 2 * day) return 'вчера';
  if (diff < 7 * day) return `${Math.floor(diff / day)} дн. назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

export function DocumentsPage() {
  const documents = useDocumentsStore((s) => s.documents);
  const favorites = useDocumentsStore((s) => s.favorites);
  const addDocument = useDocumentsStore((s) => s.addDocument);
  const updateDocument = useDocumentsStore((s) => s.updateDocument);
  const deleteDocument = useDocumentsStore((s) => s.deleteDocument);
  const moveDocument = useDocumentsStore((s) => s.moveDocument);
  const toggleFavorite = useDocumentsStore((s) => s.toggleFavorite);
  const setEmojiInStore = useDocumentsStore((s) => s.setEmoji);
  const bulkDelete = useDocumentsStore((s) => s.bulkDelete);
  const bulkMove = useDocumentsStore((s) => s.bulkMove);

  const [scope, setScope] = useState<ScopeId>('clients');
  const [folderPath, setFolderPath] = useState<string[]>([]); // ids цепочки папок
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updated');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // выделение
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);

  // DnD
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  // Диалоги
  const [formOpen, setFormOpen] = useState(false);
  const [formEditDoc, setFormEditDoc] = useState<DocumentItem | undefined>(undefined);
  const [formPrefill, setFormPrefill] = useState<Partial<DocumentItem> | undefined>(undefined);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [moveDoc, setMoveDoc] = useState<DocumentItem | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<DocumentItem | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const isSection = (s: ScopeId): s is DocumentSectionId =>
    s !== 'all' && s !== 'favorites';

  const currentFolderId = folderPath[folderPath.length - 1];
  const inFolder = !!currentFolderId;

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: documents.length, favorites: favorites.length };
    for (const s of SECTIONS) map[s.id] = 0;
    for (const d of documents) map[d.section] = (map[d.section] ?? 0) + 1;
    return map;
  }, [documents, favorites]);

  const tagsInScope = useMemo(() => {
    const inScope = documents.filter((d) => {
      if (scope === 'all') return true;
      if (scope === 'favorites') return favorites.includes(d.id);
      return d.section === scope;
    });
    const seen = new Map<string, number>();
    for (const d of inScope) for (const t of d.tags ?? []) seen.set(t, (seen.get(t) ?? 0) + 1);
    return Array.from(seen.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }, [documents, scope, favorites]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const effectiveAll = globalSearch && q.length > 0;
    let list = documents.filter((d) => {
      if (effectiveAll) return true;
      if (scope === 'all') return true;
      if (scope === 'favorites') return favorites.includes(d.id);
      if (d.section !== scope) return false;
      // Если идёт поиск без globalSearch — показываем всё в разделе плоско
      if (q) return true;
      // Иначе соблюдаем папочную иерархию
      return (d.parentId ?? null) === (currentFolderId ?? null);
    });

    if (activeTag) list = list.filter((d) => (d.tags ?? []).includes(activeTag));

    if (q) {
      list = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.owner.toLowerCase().includes(q) ||
          (d.description ?? '').toLowerCase().includes(q) ||
          (d.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }

    list = [...list].sort((a, b) => {
      // Папки всегда выше
      if (a.kind === 'folder' && b.kind !== 'folder') return -1;
      if (b.kind === 'folder' && a.kind !== 'folder') return 1;
      if (sortBy === 'title') return a.title.localeCompare(b.title, 'ru');
      if (sortBy === 'owner') return a.owner.localeCompare(b.owner, 'ru');
      if (sortBy === 'oldest')
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
    return list;
  }, [documents, scope, favorites, activeTag, query, sortBy, globalSearch, currentFolderId]);

  const headerSection = isSection(scope) ? SECTIONS.find((s) => s.id === scope)! : null;
  const currentFolderDoc = inFolder
    ? documents.find((d) => d.id === currentFolderId)
    : undefined;
  const headerTitle = inFolder
    ? currentFolderDoc?.title ?? '...'
    : scope === 'all'
      ? 'Все документы'
      : scope === 'favorites'
        ? 'Избранное'
        : headerSection?.title ?? '';
  const headerEmoji = inFolder
    ? currentFolderDoc?.emoji ?? '📁'
    : scope === 'all'
      ? '📚'
      : scope === 'favorites'
        ? '⭐'
        : headerSection?.emoji ?? '📁';
  const headerDescription = inFolder
    ? currentFolderDoc?.description
    : scope === 'all'
      ? 'Поиск и навигация по всем разделам базы знаний.'
      : scope === 'favorites'
        ? 'Документы, которые вы отметили звёздочкой.'
        : headerSection?.description ?? '';

  // — навигация —
  const enterScope = (id: ScopeId) => {
    setScope(id);
    setFolderPath([]);
    setSelected(new Set());
    setMobileSheetOpen(false);
  };
  const enterFolder = (folderDocId: string) => {
    setFolderPath((p) => [...p, folderDocId]);
    setSelected(new Set());
  };
  const goUp = () => {
    setFolderPath((p) => p.slice(0, -1));
    setSelected(new Set());
  };

  // — действия —
  const handleCreate = (prefill?: Partial<DocumentItem>) => {
    setFormEditDoc(undefined);
    setFormPrefill({
      section: isSection(scope) ? scope : 'general',
      parentId: currentFolderId,
      ...prefill,
    });
    setFormOpen(true);
  };
  const handleCreateFolder = () => {
    handleCreate({ kind: 'folder', emoji: '📁', title: 'Новая папка' });
  };
  const handleEdit = (d: DocumentItem) => {
    setFormEditDoc(d);
    setFormPrefill(undefined);
    setFormOpen(true);
  };
  const handleDownload = (d: DocumentItem) => {
    toast.success(`«${d.title}» — загрузка началась`);
  };
  const handleShare = async (d: DocumentItem) => {
    const url = `${window.location.origin}/documents#${d.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Ссылка скопирована в буфер обмена');
    } catch {
      toast.error('Не удалось скопировать ссылку');
    }
  };
  const handleDelete = (d: DocumentItem) => {
    deleteDocument(d.id);
    toast.success(`«${d.title}» удалён`);
  };

  // — bulk —
  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((d) => d.id)));
  };
  const handleBulkDelete = () => {
    bulkDelete(Array.from(selected));
    toast.success(`Удалено: ${selected.size}`);
    setSelected(new Set());
    setBulkDeleteOpen(false);
  };
  const handleBulkMove = (target: DocumentSectionId) => {
    bulkMove(Array.from(selected), target);
    const sName = SECTIONS.find((s) => s.id === target)?.title ?? target;
    toast.success(`Перемещено в «${sName}»: ${selected.size}`);
    setSelected(new Set());
    setBulkMoveOpen(false);
  };

  // — drag&drop —
  const handleDragStart = (e: React.DragEvent, doc: DocumentItem) => {
    // Если есть выделение и тащим выделенный — тащим всё выделение
    const ids = selected.has(doc.id) && selected.size > 1 ? Array.from(selected) : [doc.id];
    e.dataTransfer.setData('application/x-doc-ids', JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'move';
  };
  const acceptDrop = (e: React.DragEvent): string[] | null => {
    const raw = e.dataTransfer.getData('application/x-doc-ids');
    if (!raw) return null;
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return null;
    }
  };
  const handleDropOnSection = (e: React.DragEvent, section: DocumentSectionId) => {
    e.preventDefault();
    const ids = acceptDrop(e);
    setDragOverTarget(null);
    if (!ids) return;
    ids.forEach((id) => moveDocument(id, section, undefined));
    const sName = SECTIONS.find((s) => s.id === section)?.title ?? section;
    toast.success(`Перемещено в «${sName}»: ${ids.length}`);
    setSelected(new Set());
  };
  const handleDropOnFolder = (e: React.DragEvent, folder: DocumentItem) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = acceptDrop(e);
    setDragOverTarget(null);
    if (!ids) return;
    ids.forEach((id) => {
      if (id === folder.id) return; // нельзя в саму себя
      moveDocument(id, folder.section, folder.id);
    });
    toast.success(`Перемещено в «${folder.title}»: ${ids.length}`);
    setSelected(new Set());
  };

  // — шаблон —
  const handleApplyTemplate = (t: DocumentTemplate) => {
    setFormEditDoc(undefined);
    setFormPrefill({
      title: t.title,
      emoji: t.emoji,
      kind: t.kind,
      section: t.section,
      tags: t.tags,
      description: t.bodyDescription ?? t.description,
      parentId: t.section === scope ? currentFolderId : undefined,
    });
    setFormOpen(true);
  };

  // — содержимое левого рейла (используется и для desktop, и для Sheet) —
  const renderScopeRail = (onPick: (id: ScopeId) => void) => (
    <div className="space-y-4">
      <div>
        <div className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Обзор
        </div>
        <ul className="space-y-px">
          <ScopeRailItem
            label="Все документы"
            emoji="📚"
            count={counts.all}
            active={scope === 'all' && !inFolder}
            onClick={() => onPick('all')}
          />
          <ScopeRailItem
            label="Избранное"
            emoji="⭐"
            count={counts.favorites}
            active={scope === 'favorites' && !inFolder}
            onClick={() => onPick('favorites')}
          />
        </ul>
      </div>
      <div>
        <div className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Разделы
        </div>
        <ul className="space-y-px">
          {SECTIONS.map((s) => (
            <ScopeRailItem
              key={s.id}
              label={s.title}
              emoji={s.emoji}
              count={counts[s.id] ?? 0}
              active={scope === s.id && !inFolder}
              onClick={() => onPick(s.id)}
              withChevron
              isDropTarget={dragOverTarget === `section:${s.id}`}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('application/x-doc-ids')) {
                  e.preventDefault();
                  setDragOverTarget(`section:${s.id}`);
                }
              }}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={(e) => handleDropOnSection(e, s.id)}
            />
          ))}
        </ul>
      </div>
      <div>
        <div className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Быстрые действия
        </div>
        <ul className="space-y-px">
          <li>
            <button
              type="button"
              onClick={() => handleCreate()}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Новый документ
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={handleCreateFolder}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Новая папка
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setTemplatesOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Из шаблона
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
            >
              <Upload className="h-3.5 w-3.5" />
              Загрузить файл
            </button>
          </li>
        </ul>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      {/* Desktop rail */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r bg-muted/20 px-2 py-4 md:flex">
        {renderScopeRail(enterScope)}
      </aside>

      {/* Mobile sheet */}
      <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
        <SheetContent side="left" className="w-[280px] p-3">
          <SheetHeader>
            <SheetTitle>Разделы</SheetTitle>
          </SheetHeader>
          <div className="mt-3">{renderScopeRail(enterScope)}</div>
        </SheetContent>
      </Sheet>

      {/* Main canvas */}
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-[1400px] px-8 pb-16 pt-10 2xl:px-12">
          {/* Breadcrumb + mobile menu */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileSheetOpen(true)}
              aria-label="Открыть разделы"
            >
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
              <button
                type="button"
                onClick={() => enterScope('all')}
                className="hover:text-foreground"
              >
                Документы
              </button>
              <ChevronRight className="h-3 w-3" />
              <button
                type="button"
                onClick={() => {
                  if (isSection(scope)) {
                    setFolderPath([]);
                    setSelected(new Set());
                  }
                }}
                className={cn(!inFolder && 'text-foreground', 'hover:text-foreground')}
              >
                {isSection(scope)
                  ? headerSection!.title
                  : scope === 'all'
                    ? 'Все документы'
                    : 'Избранное'}
              </button>
              {folderPath.map((fid, i) => {
                const folderDoc = documents.find((d) => d.id === fid);
                const last = i === folderPath.length - 1;
                return (
                  <span key={fid} className="flex items-center gap-1.5">
                    <ChevronRight className="h-3 w-3" />
                    <button
                      type="button"
                      onClick={() => setFolderPath((p) => p.slice(0, i + 1))}
                      className={cn(last && 'text-foreground', 'hover:text-foreground')}
                    >
                      {folderDoc?.title ?? '...'}
                    </button>
                  </span>
                );
              })}
            </div>
          </div>

          {/* Title block */}
          <div className="mt-5 flex items-center gap-2">
            {inFolder && (
              <Button variant="ghost" size="icon" onClick={goUp} className="h-9 w-9">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="text-5xl leading-none">{headerEmoji}</div>
          </div>
          <h1 className="mt-3 text-[40px] font-bold leading-tight tracking-tight">
            {headerTitle}
          </h1>
          {headerDescription && (
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
              {headerDescription}
            </p>
          )}

          {/* Toolbar */}
          <div className="mt-6 space-y-2 border-b pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    globalSearch ? 'Поиск во всех разделах…' : 'Поиск по этому разделу…'
                  }
                  className="h-8 pl-8 text-[13px]"
                />
              </div>
              <Button
                size="sm"
                variant={globalSearch ? 'default' : 'outline'}
                className="h-8 gap-1.5 text-[13px]"
                onClick={() => setGlobalSearch((v) => !v)}
                title={
                  globalSearch
                    ? 'Поиск по всем разделам — кликните, чтобы искать только в текущем'
                    : 'Поиск только в текущем разделе — кликните, чтобы искать везде'
                }
              >
                {globalSearch ? (
                  <>
                    <Globe className="h-3.5 w-3.5" />
                    Везде
                  </>
                ) : (
                  <>
                    <FolderClosed className="h-3.5 w-3.5" />
                    В разделе
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTemplatesOpen(true)}
                className="h-8 gap-1.5 text-[13px]"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Шаблон
              </Button>
              <Button size="sm" onClick={() => handleCreate()} className="h-8 gap-1.5 text-[13px]">
                <Plus className="h-3.5 w-3.5" />
                Добавить
              </Button>
            </div>

            {/* Sort + tags row */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
                <SelectTrigger className="h-7 w-[180px] text-[12px]">
                  <div className="flex items-center gap-1.5">
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                    <SelectValue />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Сначала свежие</SelectItem>
                  <SelectItem value="oldest">Сначала старые</SelectItem>
                  <SelectItem value="title">По названию</SelectItem>
                  <SelectItem value="owner">По владельцу</SelectItem>
                </SelectContent>
              </Select>

              {tagsInScope.length > 0 && (
                <>
                  <div className="mx-1 hidden h-4 w-px bg-border sm:block" />
                  <SlidersHorizontal className="h-3 w-3 text-muted-foreground" />
                  <span className="mr-1 text-[11px] text-muted-foreground">Теги:</span>
                  {tagsInScope.map((t) => {
                    const sel = activeTag === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setActiveTag(sel ? null : t)}
                        className={cn(
                          'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
                          sel
                            ? 'bg-foreground text-background'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80',
                        )}
                      >
                        {t}
                      </button>
                    );
                  })}
                  {activeTag && (
                    <button
                      type="button"
                      onClick={() => setActiveTag(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      сбросить
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div className="sticky top-2 z-10 mt-3 flex items-center gap-2 rounded-md border bg-foreground px-3 py-1.5 text-background shadow-md">
              <Checkbox
                checked={selected.size === items.length && items.length > 0}
                onCheckedChange={selectAll}
                className="border-background/60 data-[state=checked]:bg-background data-[state=checked]:text-foreground"
              />
              <span className="text-[13px] font-medium">Выбрано: {selected.size}</span>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-background hover:bg-background/10 hover:text-background"
                  onClick={() => setBulkMoveOpen(true)}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Переместить
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-background hover:bg-background/10 hover:text-background"
                  onClick={() => {
                    selected.forEach((id) => {
                      const d = documents.find((x) => x.id === id);
                      if (d) handleDownload(d);
                    });
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Скачать
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 text-red-200 hover:bg-red-500/20 hover:text-red-100"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Удалить
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-background hover:bg-background/10 hover:text-background"
                  onClick={() => setSelected(new Set())}
                  aria-label="Снять выделение"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* Documents list */}
          {items.length === 0 ? (
            <div className="mt-12">
              <EmptyState
                title="Ничего не найдено"
                description={
                  query
                    ? 'Попробуйте изменить запрос или включить поиск «Везде».'
                    : inFolder
                      ? 'Папка пуста. Перетащите документы сюда или создайте новый.'
                      : 'В этом разделе пока нет документов. Добавьте первый.'
                }
              />
            </div>
          ) : (
            <div className="mt-3">
              {items.map((d) => {
                const Icon = KIND_ICON[d.kind];
                const fav = favorites.includes(d.id);
                const section = SECTIONS.find((s) => s.id === d.section);
                const sel = selected.has(d.id);
                const isFolder = d.kind === 'folder';
                const isFolderDropOver = dragOverTarget === `folder:${d.id}`;
                return (
                  <div
                    key={d.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, d)}
                    onDragOver={(e) => {
                      if (!isFolder) return;
                      if (e.dataTransfer.types.includes('application/x-doc-ids')) {
                        e.preventDefault();
                        setDragOverTarget(`folder:${d.id}`);
                      }
                    }}
                    onDragLeave={() => isFolder && setDragOverTarget(null)}
                    onDrop={(e) => isFolder && handleDropOnFolder(e, d)}
                    className={cn(
                      'group flex items-center gap-3 rounded-md px-2 py-2 transition-colors',
                      sel ? 'bg-blue-50/60' : 'hover:bg-muted/40',
                      isFolderDropOver && 'ring-2 ring-blue-400 ring-offset-1',
                    )}
                  >
                    {/* Checkbox */}
                    <div
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center transition-opacity',
                        sel || selected.size > 0
                          ? 'opacity-100'
                          : 'opacity-0 group-hover:opacity-100',
                      )}
                    >
                      <Checkbox
                        checked={sel}
                        onCheckedChange={() => toggleSelect(d.id)}
                        aria-label="Выбрать"
                      />
                    </div>

                    <EmojiPicker
                      value={d.emoji}
                      onSelect={(e) => setEmojiInStore(d.id, e)}
                    >
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/50 text-base transition-colors hover:bg-muted"
                        aria-label="Сменить иконку"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {d.emoji}
                      </button>
                    </EmojiPicker>

                    <button
                      type="button"
                      onClick={() => (isFolder ? enterFolder(d.id) : setPreviewDoc(d))}
                      onDoubleClick={() => !isFolder && setPreviewDoc(d)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium">{d.title}</span>
                        {d.tags?.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground"
                          >
                            {t}
                          </span>
                        ))}
                        {(d.versions?.length ?? 0) > 0 && (
                          <span className="tnum flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                            v{d.versions!.length}
                          </span>
                        )}
                        {(d.comments?.length ?? 0) > 0 && (
                          <span className="tnum text-[11px] text-muted-foreground">
                            💬 {d.comments!.length}
                          </span>
                        )}
                      </div>
                      {d.description && (
                        <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
                          {d.description}
                        </div>
                      )}
                      {(globalSearch || scope === 'all' || scope === 'favorites') && section && (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {section.emoji} {section.title}
                        </div>
                      )}
                    </button>

                    <span
                      className={cn(
                        'hidden items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium md:inline-flex',
                        KIND_COLOR[d.kind],
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {KIND_LABEL[d.kind]}
                    </span>

                    <div className="hidden w-32 truncate text-[12px] text-muted-foreground md:block">
                      {d.owner}
                    </div>

                    <div className="tnum hidden w-20 shrink-0 text-right text-[11.5px] text-muted-foreground md:block">
                      {formatRelative(d.updatedAt)}
                    </div>

                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => toggleFavorite(d.id)}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground',
                          fav && 'text-yellow-500 opacity-100',
                        )}
                        aria-label="В избранное"
                      >
                        <Star className={cn('h-3.5 w-3.5', fav && 'fill-current')} />
                      </button>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Действия"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => handleEdit(d)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Переименовать
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setMoveDoc(d)}>
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Переместить
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDownload(d)}>
                            <Download className="mr-2 h-3.5 w-3.5" />
                            Скачать
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleShare(d)}>
                            <Share2 className="mr-2 h-3.5 w-3.5" />
                            Поделиться
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteDoc(d)}
                            className="text-red-600 focus:text-red-700"
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Удалить
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <DocumentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initialSection={(formPrefill?.section as DocumentSectionId | undefined) ??
          (isSection(scope) ? scope : 'general')}
        document={formEditDoc}
        prefill={formPrefill}
        onSubmit={(values) => {
          if (formEditDoc) {
            updateDocument(formEditDoc.id, values);
            toast.success(`«${values.title}» обновлён`);
          } else {
            const created = addDocument({ ...values, parentId: formPrefill?.parentId });
            toast.success(`«${created.title}» создан`);
            if (created.section !== scope) setScope(created.section);
          }
        }}
      />

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        initialSection={isSection(scope) ? scope : 'general'}
        onSubmit={(values) => {
          const created = addDocument({ ...values, parentId: currentFolderId });
          toast.success(`Файл «${created.title}» загружен`);
          if (created.section !== scope) setScope(created.section);
        }}
      />

      <MoveDialog
        open={!!moveDoc}
        onOpenChange={(v) => !v && setMoveDoc(null)}
        currentSection={moveDoc?.section ?? 'general'}
        documentTitle={moveDoc?.title ?? ''}
        onSubmit={(target) => {
          if (moveDoc) {
            moveDocument(moveDoc.id, target, undefined);
            const targetName = SECTIONS.find((s) => s.id === target)?.title ?? target;
            toast.success(`«${moveDoc.title}» → ${targetName}`);
          }
        }}
      />

      {/* Bulk move via MoveDialog */}
      <MoveDialog
        open={bulkMoveOpen}
        onOpenChange={setBulkMoveOpen}
        currentSection={isSection(scope) ? scope : 'general'}
        documentTitle={`${selected.size} док.`}
        onSubmit={handleBulkMove}
      />

      <PreviewDialog
        open={!!previewDoc}
        onOpenChange={(v) => !v && setPreviewDoc(null)}
        document={previewDoc}
        onEdit={() => {
          if (previewDoc) {
            handleEdit(previewDoc);
            setPreviewDoc(null);
          }
        }}
        onDownload={() => previewDoc && handleDownload(previewDoc)}
        onShare={() => previewDoc && handleShare(previewDoc)}
      />

      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onPick={handleApplyTemplate}
      />

      <Dialog open={!!deleteDoc} onOpenChange={(v) => !v && setDeleteDoc(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить документ?</DialogTitle>
            <DialogDescription>
              «{deleteDoc?.title}» будет удалён без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteDoc(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteDoc) handleDelete(deleteDoc);
                setDeleteDoc(null);
              }}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Удалить {selected.size} док.?</DialogTitle>
            <DialogDescription>
              Выделенные документы будут удалены без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBulkDeleteOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// — компонент пункта левого рейла —
function ScopeRailItem({
  label,
  emoji,
  count,
  active,
  onClick,
  withChevron,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  label: string;
  emoji: string;
  count: number;
  active: boolean;
  onClick: () => void;
  withChevron?: boolean;
  isDropTarget?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
}) {
  return (
    <li onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13.5px] transition-colors',
          active
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
          isDropTarget && 'ring-2 ring-blue-400 ring-offset-1',
        )}
      >
        {withChevron ? (
          <ChevronRight
            className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform',
              active && 'rotate-90 text-foreground',
            )}
          />
        ) : (
          <span className="w-3" />
        )}
        <span className="text-base leading-none">{emoji}</span>
        <span className="flex-1 truncate font-medium">{label}</span>
        <span className="tnum text-[11px] text-muted-foreground">{count}</span>
      </button>
    </li>
  );
}
