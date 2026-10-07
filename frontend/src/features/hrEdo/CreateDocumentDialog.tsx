/**
 * Создание кадрового документа по шаблону: тип + сотрудники → поля (с
 * предзаполнением из карточки) + живой предпросмотр (паттерн OffersPage).
 * На нескольких сотрудников создаётся по документу на каждого.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from '@/components/forms/MoneyInput';
import { hrEdoApi, type HrDocType, type HrDocTypeField, type HrEmployee } from '@/api/hrEdo';
import { useCreateHrDocuments, useDocTypes, useHrEmployees } from './hooks';
import { Field, SearchablePick } from './dialogs';
import { apiErrorMessage } from './statuses';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function defaultValue(f: HrDocTypeField, emp?: HrEmployee): string {
  if (f.defaultFrom === 'employee.position' && emp?.position) return emp.position;
  if (f.defaultFrom === 'employee.hired_at' && emp?.hiredAt) return emp.hiredAt;
  if (f.defaultFrom === 'today') return todayIso();
  return f.default ?? '';
}

export function CreateDocumentDialog({
  open,
  onOpenChange,
  initialEmployeeId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialEmployeeId?: string | null;
  onCreated?: (ids: string[]) => void;
}) {
  const { data: types = [] } = useDocTypes();
  const { data: employeesPage } = useHrEmployees({ status: 'active', pageSize: 500 }, open);
  const employees = useMemo(() => employeesPage?.items ?? [], [employeesPage]);
  const create = useCreateHrDocuments();

  const templateTypes = useMemo(
    () => types.filter((t) => !t.uploadOnly && t.stage === 1 && t.code !== 'edo_consent_package'),
    [types],
  );
  const [typeCode, setTypeCode] = useState('');
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [docDate, setDocDate] = useState(todayIso());
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState(false);

  const type: HrDocType | undefined = templateTypes.find((t) => t.code === typeCode);
  const firstEmployee = employees.find((e) => e.id === employeeIds[0]);
  const notReady = employees.filter((e) => employeeIds.includes(e.id) && e.edoStatus !== 'active');

  useEffect(() => {
    if (!open) return;
    setEmployeeIds(initialEmployeeId ? [initialEmployeeId] : []);
    setDocDate(todayIso());
    setPreview('');
  }, [open, initialEmployeeId]);

  useEffect(() => {
    if (!typeCode && templateTypes.length) setTypeCode(templateTypes[0].code);
  }, [templateTypes, typeCode]);

  // Смена типа или первого сотрудника → заполняем пустые поля дефолтами.
  useEffect(() => {
    if (!type) return;
    setFields((prev) => {
      const next: Record<string, string> = {};
      for (const f of type.fields) next[f.key] = prev[f.key] || defaultValue(f, firstEmployee);
      return next;
    });
  }, [type, firstEmployee]);

  // Живой предпросмотр с дебаунсом.
  useEffect(() => {
    if (!open || !type) return;
    const t = setTimeout(() => {
      hrEdoApi
        .preview({ typeCode: type.code, employeeId: employeeIds[0] ?? null, fields, docDate })
        .then((html) => {
          setPreview(html);
          setPreviewError(false);
        })
        .catch(() => setPreviewError(true));
    }, 400);
    return () => clearTimeout(t);
  }, [open, type, employeeIds, fields, docDate]);

  const employeeOptions = useMemo(
    () =>
      employees
        .filter((e) => e.employmentType === 'ТК РФ')
        .map((e) => ({ value: e.id, label: e.fullName, hint: e.position, keywords: e.email ?? '' })),
    [employees],
  );

  const missing = type?.fields.filter((f) => f.required && !String(fields[f.key] ?? '').trim()) ?? [];

  const submit = async (freeze: boolean) => {
    if (!type) return;
    try {
      const docs = await create.mutateAsync({ typeCode: type.code, employeeIds, fields, docDate, freeze });
      toast.success(
        freeze
          ? `Сформировано: ${docs.length}. ${type.employerSig === 'ukep' ? 'Дальше — подпись директора.' : 'Можно отправлять.'}`
          : 'Черновик сохранён',
      );
      onCreated?.(docs.map((d) => d.id));
      onOpenChange(false);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось создать документ'));
    }
  };

  const setField = (key: string, value: string) => setFields((f) => ({ ...f, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] max-w-6xl flex-col gap-3 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Новый кадровый документ</DialogTitle>
          <DialogDescription>
            Поля предзаполняются из карточки сотрудника. После «Сформировать» PDF замораживается — правки только через
            новый документ.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-5 pb-2 lg:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-3">
            <Field label="Тип документа">
              <Select value={typeCode} onValueChange={setTypeCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите тип" />
                </SelectTrigger>
                <SelectContent>
                  {templateTypes.map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Сотрудники">
              <SearchablePick
                multiple
                value={employeeIds}
                onChange={setEmployeeIds}
                options={employeeOptions}
                placeholder="Выберите сотрудников"
                searchPlaceholder="Поиск по имени или должности…"
              />
            </Field>
            {notReady.length > 0 && (
              <Alert className="border-amber-500/40 bg-amber-500/5">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-[12px]">
                  {notReady.map((e) => e.fullName).join(', ')}{' '}
                  {notReady.length > 1 ? 'ещё не получили' : 'ещё не получил(а)'} электронную подпись: сначала согласие на
                  КЭДО. Документ можно подготовить, но отправить — только после выпуска подписи.
                </AlertDescription>
              </Alert>
            )}
            <Field label="Дата документа">
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </Field>
            {type?.fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                <DocField field={f} value={fields[f.key] ?? ''} onChange={(v) => setField(f.key, v)} />
              </Field>
            ))}
          </div>
          <div className="hidden min-h-[480px] flex-col lg:flex">
            <div className="mb-1.5 text-xs text-muted-foreground">Предпросмотр (A4)</div>
            {previewError ? (
              <div className="flex flex-1 items-center justify-center rounded-md border text-[12.5px] text-muted-foreground">
                Не удалось построить предпросмотр
              </div>
            ) : (
              <iframe title="Предпросмотр документа" srcDoc={preview} sandbox="" className="h-full min-h-[640px] w-full flex-1 rounded-md border bg-white" />
            )}
          </div>
        </div>
        <DialogFooter className="border-t px-5 py-3">
          {missing.length > 0 && (
            <span className="mr-auto self-center text-[11.5px] text-muted-foreground">
              Для формирования заполните: {missing.map((f) => f.label).join(', ')}
            </span>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button variant="outline" onClick={() => void submit(false)} disabled={!type || employeeIds.length === 0 || create.isPending}>
            Сохранить черновик
          </Button>
          <Button
            onClick={() => void submit(true)}
            disabled={!type || employeeIds.length === 0 || missing.length > 0 || create.isPending}
          >
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Сформировать{employeeIds.length > 1 ? ` (${employeeIds.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocField({ field, value, onChange }: { field: HrDocTypeField; value: string; onChange: (v: string) => void }) {
  switch (field.type) {
    case 'textarea':
      return <Textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? undefined} />;
    case 'date':
      return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <Input inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))} />;
    case 'money':
      return (
        <MoneyInput
          value={value ? Number(value) : undefined}
          onChange={(v) => onChange(v == null ? '' : String(v))}
          placeholder={field.placeholder ?? undefined}
        />
      );
    case 'select':
      return (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    default:
      return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder ?? undefined} />;
  }
}
