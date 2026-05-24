import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SECTIONS } from './mocks';
import { EmojiPicker } from './EmojiPicker';
import type { DocumentItem, DocumentKind, DocumentSectionId } from './types';

const KIND_OPTIONS: { value: DocumentKind; label: string }[] = [
  { value: 'doc', label: 'Документ' },
  { value: 'pdf', label: 'PDF' },
  { value: 'xlsx', label: 'Таблица' },
  { value: 'pptx', label: 'Презентация' },
  { value: 'image', label: 'Изображение' },
  { value: 'folder', label: 'Папка' },
  { value: 'note', label: 'Заметка' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection: DocumentSectionId;
  // если передан — режим редактирования
  document?: DocumentItem;
  // префилл для создания (например из шаблона или внутри папки)
  prefill?: Partial<DocumentItem>;
  onSubmit: (values: {
    title: string;
    section: DocumentSectionId;
    kind: DocumentKind;
    emoji: string;
    owner: string;
    description?: string;
    tags?: string[];
  }) => void;
}

export function DocumentFormDialog({ open, onOpenChange, initialSection, document, prefill, onSubmit }: Props) {
  const isEdit = !!document;

  const [title, setTitle] = useState('');
  const [section, setSection] = useState<DocumentSectionId>(initialSection);
  const [kind, setKind] = useState<DocumentKind>('doc');
  const [emoji, setEmoji] = useState('📄');
  const [owner, setOwner] = useState('');
  const [description, setDescription] = useState('');
  const [tagsStr, setTagsStr] = useState('');

  useEffect(() => {
    if (!open) return;
    if (document) {
      setTitle(document.title);
      setSection(document.section);
      setKind(document.kind);
      setEmoji(document.emoji);
      setOwner(document.owner);
      setDescription(document.description ?? '');
      setTagsStr((document.tags ?? []).join(', '));
    } else {
      setTitle(prefill?.title ?? '');
      setSection((prefill?.section as DocumentSectionId) ?? initialSection);
      setKind((prefill?.kind as DocumentKind) ?? 'doc');
      setEmoji(prefill?.emoji ?? '📄');
      setOwner(prefill?.owner ?? '');
      setDescription(prefill?.description ?? '');
      setTagsStr((prefill?.tags ?? []).join(', '));
    }
  }, [open, document, initialSection, prefill]);

  const submit = () => {
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      section,
      kind,
      emoji,
      owner: owner.trim() || 'Я',
      description: description.trim() || undefined,
      tags: tagsStr
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Изменить документ' : 'Новый документ'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Обновите название, теги, владельца или раздел.'
              : 'Заполните основные поля. Файл можно прикрепить позже.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Иконка и название</Label>
            <div className="flex items-stretch gap-2">
              <EmojiPicker value={emoji} onSelect={setEmoji}>
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/30 text-2xl leading-none transition-colors hover:bg-muted"
                  aria-label="Выбрать эмодзи"
                >
                  {emoji}
                </button>
              </EmojiPicker>
              <Input
                id="doc-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Например, договор с ВТБ"
                autoFocus
                className="h-10"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Раздел</Label>
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
            <div className="space-y-1.5">
              <Label className="text-xs">Тип</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-owner" className="text-xs">
              Владелец
            </Label>
            <Input
              id="doc-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Кто отвечает"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-tags" className="text-xs">
              Теги
            </Label>
            <Input
              id="doc-tags"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="через запятую: договор, действующий"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="doc-desc" className="text-xs">
              Описание
            </Label>
            <Textarea
              id="doc-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Короткое описание содержимого"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!title.trim()}>
            {isEdit ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
