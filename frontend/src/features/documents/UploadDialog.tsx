import { useEffect, useRef, useState } from 'react';
import { Upload, File as FileIcon } from 'lucide-react';
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
import { SECTIONS } from './mocks';
import type { DocumentKind, DocumentSectionId } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection: DocumentSectionId;
  onSubmit: (values: {
    title: string;
    section: DocumentSectionId;
    kind: DocumentKind;
    emoji: string;
    owner: string;
  }) => void;
}

function kindFromMime(file: File): { kind: DocumentKind; emoji: string } {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return { kind: 'pdf', emoji: '📕' };
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return { kind: 'xlsx', emoji: '📊' };
  if (name.endsWith('.pptx') || name.endsWith('.ppt')) return { kind: 'pptx', emoji: '🎯' };
  if (file.type.startsWith('image/')) return { kind: 'image', emoji: '🖼️' };
  if (name.endsWith('.doc') || name.endsWith('.docx')) return { kind: 'doc', emoji: '📄' };
  return { kind: 'doc', emoji: '📄' };
}

export function UploadDialog({ open, onOpenChange, initialSection, onSubmit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [section, setSection] = useState<DocumentSectionId>(initialSection);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setTitle('');
      setSection(initialSection);
      setDragOver(false);
    } else {
      setSection(initialSection);
    }
  }, [open, initialSection]);

  const handleFile = (f: File | null) => {
    setFile(f);
    if (f) setTitle(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = () => {
    if (!file) return;
    const { kind, emoji } = kindFromMime(file);
    onSubmit({
      title: title.trim() || file.name,
      section,
      kind,
      emoji,
      owner: 'Я',
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Загрузить файл</DialogTitle>
          <DialogDescription>
            Перетащите файл сюда или выберите с компьютера. Метаданные подставятся автоматически.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed py-8 text-sm transition-colors',
              dragOver ? 'border-foreground/40 bg-muted/50' : 'border-input hover:bg-muted/30',
            )}
          >
            {file ? (
              <>
                <FileIcon className="h-5 w-5 text-muted-foreground" />
                <div className="text-[13px] font-medium">{file.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} КБ
                </div>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 text-muted-foreground" />
                <div className="text-[13px] font-medium">Выбрать или перетащить файл</div>
                <div className="text-[11px] text-muted-foreground">PDF, DOCX, XLSX, PPTX, PNG</div>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </button>

          <div className="space-y-1.5">
            <Label htmlFor="up-title" className="text-xs">
              Название
            </Label>
            <Input
              id="up-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Имя для документа"
              disabled={!file}
            />
          </div>

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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!file}>
            Загрузить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
