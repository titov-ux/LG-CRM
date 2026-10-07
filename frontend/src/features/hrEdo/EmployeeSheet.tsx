/**
 * Карточка сотрудника КЭДО: статус пошагово (приглашён → согласие → подпись),
 * действия кадровика и документы сотрудника.
 */
import { useState } from 'react';
import {
  Check,
  FilePlus2,
  FileUp,
  KeyRound,
  Loader2,
  Mail,
  Pencil,
  Phone,
  ScrollText,
  Send,
  ShieldOff,
  UserRound,
} from 'lucide-react';
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
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { HrEmployee } from '@/api/hrEdo';
import {
  useChangePhone,
  useHrDocuments,
  useHrEmployee,
  useInviteEmployee,
  useRefuseEdo,
  useRevokeKey,
} from './hooks';
import { ConsentRegisterDialog } from './ConsentRegisterDialog';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { EmployeeFormDialog } from './EmployeeFormDialog';
import { UploadDocumentDialog } from './UploadDocumentDialog';
import { Field, PortalLinkDialog, ReasonDialog } from './dialogs';
import { DOC_STATUS, EDO_STATUS, apiErrorMessage, docLabel, fmtDate, formatPhone, groupFingerprint } from './statuses';

export function EmployeeSheet({
  employeeId,
  onClose,
  onOpenDocument,
}: {
  employeeId: string | null;
  onClose: () => void;
  onOpenDocument: (id: string) => void;
}) {
  const { data: emp, isLoading } = useHrEmployee(employeeId);
  return (
    <Sheet open={!!employeeId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-auto p-0 sm:max-w-xl">
        {isLoading || !emp ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <EmployeeBody emp={emp} onOpenDocument={onOpenDocument} />
        )}
      </SheetContent>
    </Sheet>
  );
}

const STEPS = [
  { key: 'invite', label: 'Приглашён', done: (e: HrEmployee) => e.edoStatus !== 'not_invited' },
  {
    key: 'consent',
    label: 'Согласие',
    done: (e: HrEmployee) => ['consent_signed', 'active', 'key_revoked'].includes(e.edoStatus),
  },
  { key: 'key', label: 'Подпись', done: (e: HrEmployee) => e.edoStatus === 'active' },
];

function EmployeeBody({ emp, onOpenDocument }: { emp: HrEmployee; onOpenDocument: (id: string) => void }) {
  const invite = useInviteEmployee();
  const refuse = useRefuseEdo();
  const revoke = useRevokeKey();
  const changePhone = useChangePhone();
  const { data: docs } = useHrDocuments({ employeeId: emp.id, pageSize: 100 });
  const [editOpen, setEditOpen] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [links, setLinks] = useState<{ name: string; url: string }[]>([]);
  const st = EDO_STATUS[emp.edoStatus];
  const labor = emp.employmentType === 'ТК РФ';

  const doInvite = async () => {
    try {
      const res = await invite.mutateAsync(emp.id);
      if (res.portalUrl) setLinks([{ name: emp.fullName, url: res.portalUrl }]);
      toast.success(res.emailSent ? 'Пакет согласия отправлен на почту' : 'Пакет согласия сформирован');
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось пригласить'));
    }
  };

  return (
    <>
      <SheetHeader className="space-y-1 border-b px-5 py-4 pr-12">
        <div className="flex items-center gap-2">
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', st.className)}>{st.label}</span>
          <span className="text-[11px] text-muted-foreground">{emp.employmentType}</span>
          {emp.status === 'dismissed' && <span className="text-[11px] text-red-600">уволен</span>}
        </div>
        <SheetTitle className="text-[16px]">{emp.fullName}</SheetTitle>
        <SheetDescription className="text-[12px]">{emp.position || 'Должность не указана'}</SheetDescription>
      </SheetHeader>

      <div className="space-y-5 px-5 py-4">
        {labor ? (
          <div>
            <ol className="flex items-center gap-2">
              {STEPS.map((s, i) => {
                const done = s.done(emp);
                return (
                  <li key={s.key} className="flex flex-1 items-center gap-2">
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                        done ? 'border-emerald-600 bg-emerald-600 text-white' : 'text-muted-foreground',
                      )}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className={cn('text-[12px]', done ? 'font-medium' : 'text-muted-foreground')}>{s.label}</span>
                    {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
                  </li>
                );
              })}
            </ol>
            <p className="mt-2 text-[11.5px] text-muted-foreground">{st.hint}</p>
          </div>
        ) : (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-[12px] text-muted-foreground">
            ИП и самозанятые — не КЭДО: договоры ГПХ и акты появятся на Этапе 3.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {labor && ['not_invited', 'notified', 'refused'].includes(emp.edoStatus) && (
            <Button size="sm" onClick={() => void doInvite()} disabled={invite.isPending}>
              {invite.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              {emp.edoStatus === 'notified' ? 'Отправить пакет ещё раз' : 'Пригласить в КЭДО'}
            </Button>
          )}
          {labor && ['notified', 'refused'].includes(emp.edoStatus) && emp.edoConsentDocId && (
            <Button size="sm" variant="outline" onClick={() => setConsentOpen(true)}>
              <ScrollText className="mr-1.5 h-3.5 w-3.5" /> Зарегистрировать согласие
            </Button>
          )}
          {labor && ['not_invited', 'notified'].includes(emp.edoStatus) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void refuse
                  .mutateAsync({ id: emp.id })
                  .then(() => toast.success('Сотрудник переведён в бумажный контур'))
                  .catch(async (e) => toast.error(await apiErrorMessage(e)))
              }
            >
              Бумажный контур
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-1.5 h-3.5 w-3.5" /> Изменить
          </Button>
        </div>

        <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[12.5px]">
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Phone className="h-3.5 w-3.5" /> Телефон
          </dt>
          <dd className="flex items-center gap-2">
            <span className="tnum">{formatPhone(emp.phone)}</span>
            {emp.phoneVerifiedAt && <span className="text-[11px] text-emerald-700 dark:text-emerald-400">подтверждён</span>}
            {emp.phone && (
              <button type="button" className="text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setPhoneOpen(true)}>
                сменить
              </button>
            )}
          </dd>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Mail className="h-3.5 w-3.5" /> Email
          </dt>
          <dd>{emp.email ?? '—'}</dd>
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <UserRound className="h-3.5 w-3.5" /> Аккаунт CRM
          </dt>
          <dd>{emp.userName ?? 'нет — подписывает через портал'}</dd>
          <dt className="text-muted-foreground">Дата приёма</dt>
          <dd>{fmtDate(emp.hiredAt)}</dd>
        </dl>

        {emp.activeKey && (
          <div className="rounded-lg border p-3 text-[12.5px]">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-medium">
                <KeyRound className="h-3.5 w-3.5" /> Ключ УНЭП ЛГ
                {emp.activeKey.isTest && <span className="text-[11px] font-normal text-amber-700 dark:text-amber-400">тестовый</span>}
              </div>
              <Button size="sm" variant="ghost" className="h-7 text-red-600 hover:text-red-700" onClick={() => setRevokeOpen(true)}>
                <ShieldOff className="mr-1 h-3.5 w-3.5" /> Отозвать
              </Button>
            </div>
            <div className="mt-1 break-words font-mono text-[11px] text-muted-foreground">{groupFingerprint(emp.activeKey.fingerprint)}</div>
            <div className="mt-1 text-[11.5px] text-muted-foreground">
              Выпущен {fmtDate(emp.activeKey.issuedAt)} · SMS на {emp.activeKey.phoneMasked}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">Документы</h3>
            <div className="flex gap-1">
              {labor && (
                <Button size="sm" variant="outline" className="h-7" onClick={() => setCreateOpen(true)}>
                  <FilePlus2 className="mr-1 h-3.5 w-3.5" /> Создать
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setUploadOpen(true)}>
                <FileUp className="mr-1 h-3.5 w-3.5" /> Загрузить
              </Button>
            </div>
          </div>
          {(docs?.items ?? []).length === 0 && <p className="text-[12.5px] text-muted-foreground">Документов пока нет.</p>}
          {(docs?.items ?? []).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => onOpenDocument(d.id)}
              className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[12.5px] hover:bg-muted/40"
            >
              <span className="min-w-0 truncate">{docLabel(d)}</span>
              <span className={cn('shrink-0 rounded px-1.5 py-px text-[10.5px] font-medium', DOC_STATUS[d.status].className)}>
                {DOC_STATUS[d.status].label}
              </span>
            </button>
          ))}
        </div>
      </div>

      <EmployeeFormDialog open={editOpen} onOpenChange={setEditOpen} employee={emp} />
      <ConsentRegisterDialog employee={emp} open={consentOpen} onOpenChange={setConsentOpen} />
      <CreateDocumentDialog open={createOpen} onOpenChange={setCreateOpen} initialEmployeeId={emp.id} />
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} initialEmployeeId={emp.id} />
      <ReasonDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        title="Отозвать ключ"
        description="Сотрудник не сможет подписывать, пока не выпустит новый ключ. Уже подписанные документы остаются действительными."
        placeholder="Например: утеря SIM-карты"
        confirmLabel="Отозвать"
        destructive
        onConfirm={(reason) => revoke.mutateAsync({ id: emp.id, reason }).then(() => toast.success('Ключ отозван'))}
      />
      <ChangePhoneDialog
        open={phoneOpen}
        onOpenChange={setPhoneOpen}
        onConfirm={(phone, reason) =>
          changePhone.mutateAsync({ id: emp.id, phone, reason }).then(() => toast.success('Номер изменён'))
        }
      />
      <PortalLinkDialog links={links} onClose={() => setLinks([])} />
    </>
  );
}

function ChangePhoneDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (phone: string, reason: string) => Promise<unknown>;
}) {
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await onConfirm(phone, reason.trim());
      setPhone('');
      setReason('');
      onOpenChange(false);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось сменить номер'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Сменить телефон</DialogTitle>
          <DialogDescription>
            Номер зафиксирован в соглашении об УНЭП: действующий ключ будет отозван, сотрудник выпустит новый по коду на
            новый номер. Основание — заявление работника или допсоглашение (загрузите его отдельным документом).
          </DialogDescription>
        </DialogHeader>
        <Field label="Новый номер">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+7 999 123-45-67" />
        </Field>
        <Field label="Основание">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Заявление работника от 29.09.2026" />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={busy || phone.trim().length < 10 || reason.trim().length < 3}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Сменить номер
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
