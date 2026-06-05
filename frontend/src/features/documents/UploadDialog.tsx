import { useEffect, useRef, useState } from 'react';
import { File as FileIcon, Upload, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SECTIONS } from './mocks';
import type { DocumentFileMeta, DocumentKind, DocumentSectionId } from './types';
import {
  ACCEPTED_MIME_HINT,
  detectKind,
  fileMetaFromFile,
  formatBytes,
  MAX_UPLOAD_BYTES,
  readAsDataUrl,
} from './fileBlob';

export interface UploadResult {
  title: string;
  section: DocumentSectionId;
  kind: DocumentKind;
  emoji: string;
  owner: string;
  file: DocumentFileMeta;
  /** временный blob URL — будет привязан к id созданного документа извне */
  blobUrl: string;
  /** исходный File — для реальной загрузки в S3 (/files/presign → confirm) */
  rawFile: File;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection: DocumentSectionId;
  /** опциональный набор файлов с OS-drop — диалог откроется уже с ними */
  initialFiles?: File[] | null;
  onSubmit: (results: UploadResult[]) => void;
}

interface QueueItem {
  id: string;
  file: File;
  title: string;
  error?: string;
}

const PERSIST_LIMIT = 2 * 1024 * 1024;

function validateFile(f: File): string | undefined {
  if (f.size === 0) return 'Пустой файл';
  if (f.size > MAX_UPLOAD_BYTES) return `Больше ${formatBytes(MAX_UPLOAD_BYTES)}`;
  return undefined;
}

export function UploadDialog({
  open,
  onOpenChange,
  initialSection,
  initialFiles,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [section, setSection] = useState<DocumentSectionId>(initialSection);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setQueue([]);
      setDragOver(false);
      setBusy(false);
      return;
    }
    setSection(initialSection);
    if (initialFiles && initialFiles.length > 0) {
      addFiles(initialFiles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialSection]);

  const addFiles = (files: File[] | FileList) => {
    const list = Array.from(files);
    setQueue((prev) => {
      const next = [...prev];
      for (const f of list) {
        const error = validateFile(f);
        next.push({
          id: `q-${Math.random().toString(36).slice(2, 9)}`,
          file: f,
          title: f.name.replace(/\.[^.]+$/, ''),
          error,
        });
      }
      return next;
    });
  };

  const removeFromQueue = (id: string) => setQueue((p) => p.filter((q) => q.id !== id));
  const updateTitle = (id: string, title: string) =>
    setQueue((p) => p.map((q) => (q.id === id ? { ...q, title } : q)));

  const validQueue = queue.filter((q) => !q.error);

  const submit = async () => {
    if (validQueue.length === 0) return;
    setBusy(true);
    try {
      const results: UploadResult[] = [];
      for (const q of validQueue) {
        const { kind, emoji } = detectKind(q.file);
        const blobUrl = URL.createObjectURL(q.file);
        const meta = fileMetaFromFile(q.file);
        // маленькие — сразу в dataURL для оффлайн-просмотра
        let file: DocumentFileMeta = meta;
        if (q.file.size <= PERSIST_LIMIT) {
          try {
            const dataUrl = await readAsDataUrl(q.file);
            file = { ...meta, dataUrl };
          } catch {
            /* fallback: остаётся blobUrl в памяти */
          }
        }
        results.push({
          title: q.title.trim() || q.file.name,
          section,
          kind,
          emoji,
          owner: 'Я',
          file,
          blobUrl,
          rawFile: q.file,
        });
      }
      onSubmit(results);
      onOpenChange(false);
    } catch (e) {
      toast.error('Не удалось загрузить файлы');
    } finally {
      setBusy(false);
    }
  };

  const invalidCount = queue.length - validQueue.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Загрузить файлы</DialogTitle>
          <DialogDescription>
            Перетащите файлы сюда или выберите с компьютера. Можно загрузить сразу несколько.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = e.dataTransfer.files;
              if (files?.length) addFiles(files);
            }}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed py-6 text-sm transition-colors',
              dragOver ? 'border-foreground/40 bg-muted/50' : 'border-input hover:bg-muted/30',
            )}
          >
            <Upload className="h-5 w-5 text-muted-foreground" />
            <div className="text-[13px] font-medium">Выбрать или перетащить файлы</div>
            <div className="text-[11px] text-muted-foreground">
              {ACCEPTED_MIME_HINT} · до {formatBytes(MAX_UPLOAD_BYTES)} каждый
            </div>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </button>

          {queue.length > 0 && (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-md border bg-muted/10 p-1.5">
              {queue.map((q) => (
                <div
                  key={q.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md border bg-background px-2 py-1.5',
                    q.error && 'border-red-300 bg-red-50/50',
                  )}
                >
                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <Input
                      value={q.title}
                      onChange={(e) => updateTitle(q.id, e.target.value)}
                      className="h-7 border-0 bg-transparent px-1 text-[12.5px] font-medium shadow-none focus-visible:ring-1"
                    />
                    <div
                      className={cn(
                        'tnum px-1 text-[10.5px]',
                        q.error ? 'text-red-600' : 'text-muted-foreground',
                      )}
                    >
                      {q.file.name} · {formatBytes(q.file.size)}
                      {q.error && ` · ${q.error}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(q.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Убрать из очереди"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Раздел для всех файлов</Label>
            <Select value={section} onValueChange={(v) => setSection(v as DocumentSectionId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECTIONS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="mr-1.5">{s.emoji}</span>
                    {s.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {invalidCount > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50/60 px-2.5 py-1.5 text-[11.5px] text-red-700">
              Пропущено файлов: {invalidCount}. Уберите их из списка или проверьте размер.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={validQueue.length === 0 || busy}>
            {busy
              ? 'Загрузка…'
              : `Загрузить${validQueue.length > 0 ? ` · ${validQueue.length}` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

