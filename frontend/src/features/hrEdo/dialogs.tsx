/**
 * Небольшие диалоги раздела «Кадровые документы»: причина, загрузка файла,
 * ссылка на портал, выбор с поиском.
 */
import { useRef, useState } from 'react';
import { Check, ChevronsUpDown, Copy, FileUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from './statuses';

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  placeholder,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  placeholder?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onOpenChange(false);
    } catch (e) {
      toast.error(await apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={placeholder} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void submit()}
            disabled={reason.trim().length < 3 || busy}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FilePicker({
  file,
  onChange,
  accept,
  hint,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  accept?: string;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="flex w-full items-center gap-3 rounded-md border border-dashed px-3 py-4 text-left text-[12.5px] transition-colors hover:bg-muted/40"
      >
        <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          {file ? (
            <>
              <span className="block truncate font-medium">{file.name}</span>
              <span className="text-muted-foreground">{(file.size / 1024).toFixed(0)} КБ · заменить</span>
            </>
          ) : (
            <>
              <span className="block font-medium">Выберите файл</span>
              {hint && <span className="text-muted-foreground">{hint}</span>}
            </>
          )}
        </span>
      </button>
    </div>
  );
}

export function FileUploadDialog({
  open,
  onOpenChange,
  title,
  description,
  accept,
  hint,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  accept?: string;
  hint?: string;
  confirmLabel: string;
  onConfirm: (file: File) => Promise<unknown>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await onConfirm(file);
      setFile(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось загрузить файл'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        <FilePicker file={file} onChange={setFile} accept={accept} hint={hint} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!file || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Ссылка на портал — когда письмо не ушло (нет email или SMTP). */
export function PortalLinkDialog({ links, onClose }: { links: { name: string; url: string }[]; onClose: () => void }) {
  return (
    <Dialog open={links.length > 0} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Письмо не отправлено</DialogTitle>
          <DialogDescription>
            У сотрудника нет email или почта не настроена. Передайте ссылку на портал подписания сами — вход по ней
            подтверждается кодом из SMS.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {links.map((l) => (
            <div key={l.url} className="space-y-1">
              <div className="text-[12px] font-medium">{l.name}</div>
              <div className="flex gap-2">
                <Input readOnly value={l.url} className="h-8 font-mono text-[11.5px]" onFocus={(e) => e.target.select()} />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => {
                    void navigator.clipboard?.writeText(l.url);
                    toast.success('Ссылка скопирована');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type PickOption = { value: string; label: string; hint?: string; keywords?: string };

/** Комбобокс с поиском (одиночный или множественный выбор) — паттерн OffersPage. */
export function SearchablePick({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = 'Поиск…',
  multiple,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: PickOption[];
  placeholder: string;
  searchPlaceholder?: string;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.filter((o) => value.includes(o.value));
  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0].label
        : `${selected[0].label} и ещё ${selected.length - 1}`;
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="h-9 w-full justify-between font-normal">
          <span className={cn('truncate', selected.length === 0 && 'text-muted-foreground')}>{label}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const isOn = value.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.keywords ?? ''} ${o.value}`}
                    onSelect={() => {
                      if (multiple) {
                        onChange(isOn ? value.filter((v) => v !== o.value) : [...value, o.value]);
                      } else {
                        onChange([o.value]);
                        setOpen(false);
                      }
                    }}
                  >
                    <Check className={cn('mr-2 h-4 w-4 shrink-0', isOn ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
