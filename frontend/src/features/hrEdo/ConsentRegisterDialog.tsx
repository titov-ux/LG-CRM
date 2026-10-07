/**
 * Регистрация подписанного пакета согласия на КЭДО.
 *
 * Согласие собирается НЕ в самой CRM (суд в Краснодаре, 2024): бумага, Госключ
 * или УКЭП сотрудника. Кадровик загружает скан или файл подписи — после этого
 * сотрудник может выпустить себе УНЭП ЛГ по SMS.
 */
import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { HrEmployee, HrSigType } from '@/api/hrEdo';
import { useRegisterConsent } from './hooks';
import { Field, FilePicker } from './dialogs';
import { apiErrorMessage } from './statuses';

const METHODS: { value: HrSigType; label: string; hint: string; accept: string }[] = [
  {
    value: 'paper',
    label: 'Бумага',
    hint: 'Скан подписанного оригинала (PDF, JPG, PNG). Оригинал храните у себя.',
    accept: 'application/pdf,image/jpeg,image/png',
  },
  {
    value: 'gosklyuch',
    label: 'Госключ',
    hint: 'Файл подписи .sig, созданный в приложении Госключ для этого PDF.',
    accept: '.sig,.p7s,application/pkcs7-signature,application/octet-stream',
  },
  {
    value: 'ukep',
    label: 'УКЭП сотрудника',
    hint: 'Отсоединённая подпись .sig / .p7s к PDF пакета.',
    accept: '.sig,.p7s,application/pkcs7-signature,application/octet-stream',
  },
];

export function ConsentRegisterDialog({
  employee,
  open,
  onOpenChange,
}: {
  employee: HrEmployee;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const register = useRegisterConsent();
  const [method, setMethod] = useState<HrSigType>('paper');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const current = METHODS.find((m) => m.value === method) ?? METHODS[0];

  const submit = async () => {
    if (!file) return;
    try {
      await register.mutateAsync({ id: employee.id, sigType: method, file, note: note.trim() || undefined });
      toast.success('Согласие зарегистрировано — сотруднику отправлено письмо «Получите подпись»');
      setFile(null);
      setNote('');
      onOpenChange(false);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось зарегистрировать согласие'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Зарегистрировать согласие</DialogTitle>
          <DialogDescription>
            {employee.fullName}: пакет согласия на КЭДО и соглашение об электронной подписи, подписанные вне системы.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={method}
          onValueChange={(v) => {
            setMethod(v as HrSigType);
            setFile(null);
          }}
          className="grid grid-cols-3 gap-2"
        >
          {METHODS.map((m) => (
            <Label
              key={m.value}
              className="flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-2 text-[12.5px] font-normal has-[[data-state=checked]]:border-foreground/40 has-[[data-state=checked]]:bg-muted/50"
            >
              <RadioGroupItem value={m.value} />
              {m.label}
            </Label>
          ))}
        </RadioGroup>
        <FilePicker file={file} onChange={setFile} accept={current.accept} hint={current.hint} />
        <Field label="Комментарий (необязательно)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: оригинал получен курьером 29.09" />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={!file || register.isPending}>
            {register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Зарегистрировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
