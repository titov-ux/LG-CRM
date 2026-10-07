/**
 * Документ готовым файлом: PDF для подписи (типы без шаблона) или скан
 * бумажного документа (ч. 3 ст. 22.1 ТК — увольнение, трудовые книжки, Н-1,
 * инструктажи: только бумага, в системе — для учёта).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDocTypes, useHrEmployees, useUploadHrDocument } from './hooks';
import { Field, FilePicker, SearchablePick } from './dialogs';
import { apiErrorMessage } from './statuses';

export function UploadDocumentDialog({
  open,
  onOpenChange,
  initialEmployeeId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialEmployeeId?: string | null;
}) {
  const { data: types = [] } = useDocTypes();
  const { data: employeesPage } = useHrEmployees({ pageSize: 500 }, open);
  const upload = useUploadHrDocument();
  const uploadTypes = useMemo(() => types.filter((t) => t.uploadOnly && t.stage === 1), [types]);
  const [typeCode, setTypeCode] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [title, setTitle] = useState('');
  const [docDate, setDocDate] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const type = uploadTypes.find((t) => t.code === typeCode);

  useEffect(() => {
    if (!open) return;
    setEmployeeId(initialEmployeeId ?? '');
    setFile(null);
    setTitle('');
  }, [open, initialEmployeeId]);

  const submit = async () => {
    if (!file || !type || !employeeId) return;
    try {
      await upload.mutateAsync({
        employeeId,
        typeCode: type.code,
        title: title.trim() || undefined,
        docDate: docDate || undefined,
        file,
      });
      toast.success(type.paperOnly ? 'Скан добавлен в архив' : 'Документ загружен и заморожен');
      onOpenChange(false);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось загрузить документ'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Загрузить документ</DialogTitle>
          <DialogDescription>Готовый PDF на подпись или скан бумажного документа для учёта.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Тип">
            <Select value={typeCode} onValueChange={setTypeCode}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите тип" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Электронные (PDF на подпись)</SelectLabel>
                  {uploadTypes.filter((t) => !t.paperOnly).map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>Только бумага (скан для учёта)</SelectLabel>
                  {uploadTypes.filter((t) => t.paperOnly).map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {type?.description && <p className="text-[11.5px] text-muted-foreground">{type.description}</p>}
          <Field label="Сотрудник">
            <SearchablePick
              value={employeeId ? [employeeId] : []}
              onChange={(v) => setEmployeeId(v[0] ?? '')}
              options={(employeesPage?.items ?? []).map((e) => ({ value: e.id, label: e.fullName, hint: e.position }))}
              placeholder="Выберите сотрудника"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Название (необязательно)">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type?.title} />
            </Field>
            <Field label="Дата документа">
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </Field>
          </div>
          <FilePicker
            file={file}
            onChange={setFile}
            accept={type?.paperOnly ? 'application/pdf,image/jpeg,image/png' : 'application/pdf'}
            hint={type?.paperOnly ? 'PDF, JPG или PNG до 20 МБ' : 'PDF до 20 МБ'}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!file || !type || !employeeId || upload.isPending}>
            {upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Загрузить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
