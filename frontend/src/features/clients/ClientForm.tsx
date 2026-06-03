import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUsers } from '@/features/users/hooks';
import { useAuthStore } from '@/stores/auth';
import type { ClientKind, ClientStatus } from '@/api/types';

const STATUSES: { id: ClientStatus; label: string }[] = [
  { id: 'lead', label: 'Лид' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'active', label: 'Активный' },
  { id: 'paused', label: 'Приостановлен' },
  { id: 'archived', label: 'Архив' },
];

const CLIENT_KINDS: { id: ClientKind; label: string }[] = [
  { id: 'direct', label: 'Прямой' },
  { id: 'intermediary', label: 'Посредник' },
];

const legalEntitySchema = z.object({
  name: z.string().min(2, 'Минимум 2 символа'),
  inn: z.string().regex(/^\d{10,12}$/, 'ИНН должен быть из 10 или 12 цифр'),
});

const schema = z.object({
  name: z.string().min(2, 'Минимум 2 символа'),
  legalEntities: z.array(legalEntitySchema).min(1, 'Добавьте хотя бы одно юр. лицо'),
  industry: z.string().min(2),
  accountManagerId: z.string().min(1, 'Выберите менеджера'),
  status: z.enum(['lead', 'in_progress', 'active', 'paused', 'archived']),
  clientKind: z.enum(['direct', 'intermediary']),
  telegramChat: z.string(),
});

export type ClientFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<ClientFormValues>;
  onSubmit: (values: ClientFormValues) => void;
  isPending?: boolean;
  submitLabel?: string;
}

export function ClientForm({ defaultValues, onSubmit, isPending, submitLabel = 'Сохранить' }: Props) {
  const { data: users } = useUsers();
  const currentUser = useAuthStore((s) => s.user);
  const isAccountManager = currentUser?.role === 'account_manager';
  const managers = (users ?? []).filter((u) => u.role === 'account_manager' || u.role === 'admin');

  // Аккаунт-менеджер по правам может заводить клиента только на себя и не может
  // менять ответственного (см. backend create_client/update_client). Поэтому для
  // этой роли подставляем его самого по умолчанию и блокируем выбор менеджера —
  // иначе он выберет «не себя» и получит молчаливый 403.
  const lockedManagerId = isAccountManager
    ? defaultValues?.accountManagerId ?? currentUser?.id ?? ''
    : undefined;

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      legalEntities: [{ name: '', inn: '' }],
      industry: '',
      accountManagerId: lockedManagerId ?? '',
      status: 'lead',
      clientKind: 'direct',
      telegramChat: '',
      ...defaultValues,
      ...(lockedManagerId ? { accountManagerId: lockedManagerId } : {}),
    } as ClientFormValues,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'legalEntities',
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название клиента</FormLabel>
              <FormControl>
                <Input {...field} placeholder="X5 Retail Group, Альфа-Банк…" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <FormLabel className="text-sm font-medium">Юридические лица</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => append({ name: '', inn: '' })}
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить
            </Button>
          </div>
          {fields.map((field, index) => (
            <div key={field.id} className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {fields.length > 1 ? `Юр. лицо ${index + 1}` : 'Юр. лицо'}
                </span>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <FormField
                control={form.control}
                name={`legalEntities.${index}.name`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Наименование</FormLabel>
                    <FormControl>
                      <Input {...f} placeholder="ООО «Ромашка»" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`legalEntities.${index}.inn`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>ИНН</FormLabel>
                    <FormControl>
                      <Input {...f} placeholder="7728029110" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          ))}
          {form.formState.errors.legalEntities?.root && (
            <p className="text-sm font-medium text-destructive">
              {form.formState.errors.legalEntities.root.message}
            </p>
          )}
        </div>

        <FormField
          control={form.control}
          name="industry"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Отрасль</FormLabel>
              <FormControl><Input {...field} placeholder="IT, Финансы…" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="clientKind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Тип клиента</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue placeholder="Выберите тип" /></SelectTrigger></FormControl>
                <SelectContent>
                  {CLIENT_KINDS.map((k) => (
                    <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="telegramChat"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telegram-чат (необязательно)</FormLabel>
              <FormControl>
                <Input {...field} placeholder="@group или https://t.me/+invite" autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="accountManagerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Аккаунт-менеджер</FormLabel>
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isAccountManager}
              >
                <FormControl><SelectTrigger><SelectValue placeholder="Выберите менеджера" /></SelectTrigger></FormControl>
                <SelectContent>
                  {managers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAccountManager && (
                <p className="text-[11.5px] text-muted-foreground">
                  Клиент закрепляется за вами. Сменить ответственного может только администратор.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Статус</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
