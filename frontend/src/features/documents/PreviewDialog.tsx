import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileText,
  History,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Send,
  Share2,
  Upload,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentsStore } from '@/stores/documents';
import { filesApi, uploadFile } from '@/api/files';
import { toast } from 'sonner';
import { SECTIONS } from './mocks';
import type { DocumentItem } from './types';
import {
  formatBytes,
  getCachedBlobUrl,
  readAsDataUrl,
  rememberBlobUrl,
} from './fileBlob';
import { NoteViewer } from './NoteEditor';

const KIND_LABEL: Record<string, string> = {
  doc: 'Документ',
  pdf: 'PDF',
  xlsx: 'Таблица',
  pptx: 'Презентация',
  image: 'Изображение',
  folder: 'Папка',
  note: 'Заметка',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentItem | null;
  onEdit: () => void;
  onDownload: () => void;
  onShare: () => void;
}

/** Выбираем URL для просмотра: blob из памяти > dataURL из persist */
function resolvePreviewUrl(doc: DocumentItem): string | undefined {
  return getCachedBlobUrl(doc.id) ?? doc.file?.dataUrl ?? undefined;
}

function isTextLike(mime?: string, fileName?: string): boolean {
  if (mime?.startsWith('text/')) return true;
  const ext = fileName?.toLowerCase().split('.').pop();
  return ext === 'md' || ext === 'csv' || ext === 'txt' || ext === 'log';
}

export function PreviewDialog({
  open,
  onOpenChange,
  document,
  onEdit,
  onDownload,
  onShare,
}: Props) {
  const addVersion = useDocumentsStore((s) => s.addVersion);
  const addComment = useDocumentsStore((s) => s.addComment);
  const attachUploadedFile = useDocumentsStore((s) => s.attachUploadedFile);
  const loadDocumentExtras = useDocumentsStore((s) => s.loadDocumentExtras);
  const documents = useDocumentsStore((s) => s.documents);

  const [tab, setTab] = useState('overview');
  const [versionLabel, setVersionLabel] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [commentText, setCommentText] = useState('');
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | undefined>(undefined);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // подхватываем последние данные из стора (на случай новых комментариев/версий/файла)
  const fresh = document ? documents.find((d) => d.id === document.id) ?? document : null;
  const section = fresh ? SECTIONS.find((s) => s.id === fresh.section) : undefined;
  const localUrl = useMemo(() => (fresh ? resolvePreviewUrl(fresh) : undefined), [fresh]);
  const previewUrl = localUrl ?? remoteUrl;

  useEffect(() => {
    if (!open || !fresh) return;
    void loadDocumentExtras(fresh.id);
  }, [open, fresh?.id, loadDocumentExtras]);

  // Нет локального blob, но файл есть в S3 (по fileId) — берём временную ссылку.
  useEffect(() => {
    setRemoteUrl(undefined);
    if (!open || !fresh || localUrl || !fresh.fileId) return;
    let cancelled = false;
    filesApi
      .download(fresh.fileId)
      .then((res) => {
        if (!cancelled) setRemoteUrl(res.url);
      })
      .catch(() => {
        if (!cancelled) setRemoteUrl(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fresh?.id, fresh?.fileId, localUrl]);

  // подгружаем текстовые форматы
  useEffect(() => {
    setTextPreview(null);
    if (!open || !fresh || !previewUrl) return;
    if (!isTextLike(fresh.file?.mime, fresh.file?.fileName)) return;
    let cancelled = false;
    fetch(previewUrl)
      .then((r) => r.text())
      .then((text) => {
        if (!cancelled) setTextPreview(text.slice(0, 50_000)); // защитный лимит
      })
      .catch(() => {
        if (!cancelled) setTextPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, previewUrl, fresh]);

  if (!document || !fresh) return null;

  const handleAddVersion = async () => {
    if (!versionLabel.trim()) return;
    await addVersion(fresh.id, {
      label: versionLabel.trim(),
      author: 'Я',
      note: versionNote.trim() || undefined,
    });
    setVersionLabel('');
    setVersionNote('');
  };

  const handleAddComment = async () => {
    if (!commentText.trim()) return;
    await addComment(fresh.id, { author: 'Я', text: commentText.trim() });
    setCommentText('');
  };

  const handleAttach = async (file: File) => {
    const blobUrl = URL.createObjectURL(file);
    rememberBlobUrl(fresh.id, blobUrl);
    // для маленьких файлов сразу читаем dataURL — мгновенное превью без S3
    const PERSIST_LIMIT = 2 * 1024 * 1024;
    let dataUrl: string | undefined;
    if (file.size <= PERSIST_LIMIT) {
      try {
        dataUrl = await readAsDataUrl(file);
      } catch {
        /* ignore */
      }
    }
    // Реальная загрузка в S3 + привязка fileId, чтобы файл пережил reload.
    setUploading(true);
    try {
      const rec = await uploadFile({
        entityType: 'document',
        entityId: fresh.id,
        file,
      });
      await attachUploadedFile(fresh.id, rec.id, {
        fileName: rec.originalName,
        mime: rec.mime,
        size: rec.size,
        dataUrl,
      });
    } catch {
      toast.error('Не удалось загрузить файл на сервер');
    } finally {
      setUploading(false);
    }
  };

  const renderPreviewBody = () => {
    if (fresh.kind === 'note') {
      return (
        <div className="max-h-[420px] overflow-auto rounded-md border bg-background p-4">
          <NoteViewer html={fresh.body ?? ''} />
        </div>
      );
    }
    if (!fresh.file || !previewUrl) {
      // Файл есть в S3 (fileId), но ссылка ещё грузится — показываем загрузку.
      const loadingRemote = !!fresh.file && !!fresh.fileId;
      return (
        <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-md border border-dashed bg-muted/20 text-center">
          <Paperclip className="h-5 w-5 text-muted-foreground" />
          <div className="text-[12.5px] text-muted-foreground">
            {uploading
              ? 'Загрузка файла на сервер…'
              : loadingRemote
                ? 'Загружаем файл из хранилища…'
                : fresh.file
                  ? 'Файл не доступен в текущей сессии. Перезагрузите его, чтобы открыть превью.'
                  : 'Файл ещё не прикреплён. Загрузите его, чтобы появился предпросмотр.'}
          </div>
          {!loadingRemote && !uploading && (
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              {fresh.file ? 'Загрузить заново' : 'Прикрепить файл'}
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleAttach(f);
              e.target.value = '';
            }}
          />
        </div>
      );
    }

    const { mime, fileName } = fresh.file;
    // изображения
    if (mime.startsWith('image/') || fresh.kind === 'image') {
      return (
        <div className="flex h-[420px] items-center justify-center overflow-hidden rounded-md border bg-muted/10">
          <img
            src={previewUrl}
            alt={fresh.title}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      );
    }
    // PDF
    if (mime === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')) {
      return (
        <iframe
          src={previewUrl}
          title={fresh.title}
          className="h-[480px] w-full rounded-md border bg-white"
        />
      );
    }
    // текст / md / csv
    if (textPreview !== null) {
      return (
        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/10 p-3 font-mono text-[12px] leading-relaxed">
          {textPreview || '(пустой файл)'}
        </pre>
      );
    }
    // офисные форматы — пока нет нативного рендера в браузере
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-md border bg-muted/10 text-center">
        <FileText className="h-6 w-6 text-muted-foreground" />
        <div className="text-[12.5px] text-foreground/80">
          {fileName}
          <span className="ml-2 text-muted-foreground">· {formatBytes(fresh.file.size)}</span>
        </div>
        <div className="max-w-sm text-[12px] text-muted-foreground">
          Просмотр {KIND_LABEL[fresh.kind] ?? 'этого формата'} в браузере недоступен — откройте в
          новой вкладке или скачайте.
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Открыть
            </a>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={previewUrl} download={fileName}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Скачать
            </a>
          </Button>
        </div>
      </div>
    );
  };

  const hasFile = !!fresh.file && !!previewUrl;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none">{fresh.emoji}</span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[22px]">{fresh.title}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
                {section && (
                  <>
                    <span>
                      {section.emoji} {section.title}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>{KIND_LABEL[fresh.kind] ?? fresh.kind}</span>
                <span>·</span>
                <span>Владелец: {fresh.owner}</span>
                {fresh.file && (
                  <>
                    <span>·</span>
                    <span className="tnum">{formatBytes(fresh.file.size)}</span>
                  </>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Обзор</TabsTrigger>
            <TabsTrigger value="versions" className="gap-1.5">
              <History className="h-3.5 w-3.5" />
              Версии
              {(fresh.versions?.length ?? 0) > 0 && (
                <span className="tnum rounded bg-muted px-1 text-[10px]">
                  {fresh.versions!.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" />
              Комменты
              {(fresh.comments?.length ?? 0) > 0 && (
                <span className="tnum rounded bg-muted px-1 text-[10px]">
                  {fresh.comments!.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            {fresh.description && (
              <div className="rounded-md border bg-muted/30 p-3 text-[13px] leading-relaxed text-foreground/90">
                {fresh.description}
              </div>
            )}

            {!!fresh.tags?.length && (
              <div className="flex flex-wrap gap-1.5">
                {fresh.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}

            {renderPreviewBody()}
          </TabsContent>

          <TabsContent value="versions" className="space-y-3">
            {(fresh.versions ?? []).length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground">
                История версий пуста. Сохраните первую снизу.
              </div>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {fresh.versions!.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-semibold">
                      <History className="h-3 w-3" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold">{v.label}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(v.createdAt).toLocaleString('ru-RU')}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-muted-foreground">{v.author}</div>
                      {v.note && (
                        <div className="mt-1 text-[12px] text-foreground/90">{v.note}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-md border bg-muted/10 p-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Сохранить новую версию
              </div>
              <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-[140px_1fr_auto]">
                <Input
                  value={versionLabel}
                  onChange={(e) => setVersionLabel(e.target.value)}
                  placeholder="Метка (v2, draft)"
                  className="h-8"
                />
                <Input
                  value={versionNote}
                  onChange={(e) => setVersionNote(e.target.value)}
                  placeholder="Что изменилось (необязательно)"
                  className="h-8"
                />
                <Button
                  size="sm"
                  onClick={handleAddVersion}
                  disabled={!versionLabel.trim()}
                  className="h-8 gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Сохранить
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="comments" className="space-y-3">
            {(fresh.comments ?? []).length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground">
                Комментариев пока нет.
              </div>
            ) : (
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {fresh.comments!.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-start gap-2 rounded-md border bg-muted/20 px-3 py-2"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background">
                      {c.author.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold">{c.author}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(c.createdAt).toLocaleString('ru-RU')}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[13px] text-foreground/90">{c.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-start gap-2">
              <Textarea
                rows={2}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Написать комментарий…"
                className="resize-none"
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleAddComment();
                }}
              />
              <Button
                size="sm"
                onClick={handleAddComment}
                disabled={!commentText.trim()}
                className="h-9 gap-1.5"
              >
                <Send className="h-3.5 w-3.5" />
                Отпр.
              </Button>
            </div>
            <div className="text-[10.5px] text-muted-foreground/80">
              Подсказка: ⌘/Ctrl + Enter — быстро отправить.
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex items-center justify-between border-t pt-3">
          <div className="text-[11px] text-muted-foreground">
            Обновлён {new Date(fresh.updatedAt).toLocaleString('ru-RU')}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onShare} className="gap-1.5">
              <Share2 className="h-3.5 w-3.5" />
              Поделиться
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit} className="gap-1.5">
              <Pencil className="h-3.5 w-3.5" />
              Изменить
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onDownload}
              className="gap-1.5"
              disabled={!hasFile}
            >
              <Download className="h-3.5 w-3.5" />
              Скачать
            </Button>
            {hasFile ? (
              <Button size="sm" className="gap-1.5" asChild>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Открыть
                </a>
              </Button>
            ) : (
              <Button size="sm" className="gap-1.5" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                Прикрепить
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleAttach(f);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
