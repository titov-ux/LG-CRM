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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EmploymentType, HrEmployee } from '@/api/hrEdo';
import { useUsersList } from '@/features/calendar/pickers';
import { useCreateHrEmployee, useUpdateHrEmployee } from './hooks';
import { Field, SearchablePick } from './dialogs';
import { apiErrorMessage } from './statuses';

const EMPLOYMENT: { value: EmploymentType; label: string }[] = [
  { value: 'ТК РФ', label: 'Трудовой договор (ТК РФ)' },
  { value: 'ИП', label: 'ИП — ГПХ (Этап 3)' },
  { value: 'СМЗ', label: 'Самозанятый — ГПХ (Этап 3)' },
];

const PHONE_LOCKED = new Set(['notified', 'consent_signed', 'active', 'key_revoked']);

export function EmployeeFormDialog({
  open,
  onOpenChange,
  employee,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  employee?: HrEmployee | null;
  onSaved?: (e: HrEmployee) => void;
}) {
  const create = useCreateHrEmployee();
  const update = useUpdateHrEmployee();
  const { data: users = [] } = useUsersList(open);
  const [form, setForm] = useState({
    fullName: '',
    position: '',
    employmentType: 'ТК РФ' as EmploymentType,
    phone: '',
    email: '',
    hiredAt: '',
    userId: '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      fullName: employee?.fullName ?? '',
      position: employee?.position ?? '',
      employmentType: employee?.employmentType ?? 'ТК РФ',
      phone: employee?.phone ?? '',
      email: employee?.email ?? '',
      hiredAt: employee?.hiredAt ?? '',
      userId: employee?.userId ?? '',
    });
  }, [open, employee]);

  const phoneLocked = !!employee && PHONE_LOCKED.has(employee.edoStatus);
  const userOptions = useMemo(
    () => users.filter((u) => u.isActive !== false).map((u) => ({ value: u.id, label: u.fullName, keywords: u.email })),
    [users],
  );
  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    const payload = {
      fullName: form.fullName.trim(),
      position: form.position.trim(),
      employmentType: form.employmentType,
      phone: phoneLocked ? undefined : form.phone.trim() || null,
      email: form.email.trim() || null,
      hiredAt: form.hiredAt || null,
      userId: form.userId || null,
    };
    try {
      const saved = employee
        ? await update.mutateAsync({ id: employee.id, patch: payload })
        : await create.mutateAsync(payload);
      toast.success(employee ? 'Карточка сохранена' : 'Сотрудник заведён');
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось сохранить'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{employee ? 'Карточка сотрудника' : 'Новый сотрудник'}</DialogTitle>
          <DialogDescription>
            Паспортные данные не храним. Номер телефона войдёт в соглашение об электронной подписи — на него приходят
            коды.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="ФИО полностью">
            <Input value={form.fullName} onChange={(e) => patch({ fullName: e.target.value })} placeholder="Иванов Иван Иванович" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Должность">
              <Input value={form.position} onChange={(e) => patch({ position: e.target.value })} />
            </Field>
            <Field label="Оформление">
              <Select value={form.employmentType} onValueChange={(v) => patch({ employmentType: v as EmploymentType })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYMENT.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={phoneLocked ? 'Мобильный (зафиксирован в соглашении)' : 'Мобильный телефон'}>
              <Input
                value={form.phone}
                disabled={phoneLocked}
                inputMode="tel"
                onChange={(e) => patch({ phone: e.target.value })}
                placeholder="+7 999 123-45-67"
              />
            </Field>
            <Field label="Email (для ссылок на подпись)">
              <Input value={form.email} type="email" onChange={(e) => patch({ email: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Дата приёма">
              <Input type="date" value={form.hiredAt} onChange={(e) => patch({ hiredAt: e.target.value })} />
            </Field>
            <Field label="Аккаунт в CRM (для «Моих документов»)">
              <SearchablePick
                value={form.userId ? [form.userId] : []}
                onChange={(v) => patch({ userId: v[0] === form.userId ? '' : (v[0] ?? '') })}
                options={userOptions}
                placeholder="Без аккаунта — через портал"
              />
            </Field>
          </div>
          {phoneLocked && (
            <p className="text-[11.5px] text-muted-foreground">
              Сменить номер можно в карточке: «Сменить телефон» — прежний ключ будет отозван.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={busy || form.fullName.trim().length < 2}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
