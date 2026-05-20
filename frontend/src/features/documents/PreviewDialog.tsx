import { useState } from 'react';
import { Download, ExternalLink, History, MessageSquare, Pencil, Plus, Send, Share2 } from 'lucide-react';
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
import { SECTIONS } from './mocks';
import type { DocumentItem } from './types';

const KIND_LABEL: Record<string, string> = {
  doc: 'Документ',
  pdf: 'PDF',
  xlsx: 'Таблица',
  pptx: 'Презентация',
  image: 'Изображение',
  folder: 'Папка',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: DocumentItem | null;
  onEdit: () => void;
  onDownload: () => void;
  onShare: () => void;
}

export function PreviewDialog({ open, onOpenChange, document, onEdit, onDownload, onShare }: Props) {
  const addVersion = useDocumentsStore((s) => s.addVersion);
  const addComment = useDocumentsStore((s) => s.addComment);
  const documents = useDocumentsStore((s) => s.documents);

  const [tab, setTab] = useState('overview');
  const [versionLabel, setVersionLabel] = useState('');
  const [versionNote, setVersionNote] = useState('');
  const [commentText, setCommentText] = useState('');

  if (!document) return null;
  // подхватываем последние данные из стора (на случай новых комментариев/версий)
  const fresh = documents.find((d) => d.id === document.id) ?? document;
  const section = SECTIONS.find((s) => s.id === fresh.section);

  const handleAddVersion = () => {
    if (!versionLabel.trim()) return;
    addVersion(fresh.id, {
      label: versionLabel.trim(),
      author: 'Я',
      note: versionNote.trim() || undefined,
    });
    setVersionLabel('');
    setVersionNote('');
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    addComment(fresh.id, { author: 'Я', text: commentText.trim() });
    setCommentText('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="text-3xl leading-none">{fresh.emoji}</span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-[22px]">{fresh.title}</DialogTitle>
              <DialogDescription className="mt-1 flex items-center gap-2 text-[12px]">
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

            <div className="flex h-44 items-center justify-center rounded-md border border-dashed bg-muted/20 text-[12px] text-muted-foreground">
              Предпросмотр содержимого появится после подключения файлового хранилища.
            </div>
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
            <Button variant="outline" size="sm" onClick={onDownload} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Скачать
            </Button>
            <Button size="sm" className="gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              Открыть
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
