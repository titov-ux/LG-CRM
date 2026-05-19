import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import type { ClientStatus } from '@/api/types';

const STATUSES: { id: ClientStatus; label: string }[] = [
  { id: 'lead', label: 'Лид' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'active', label: 'Активный' },
  { id: 'paused', label: 'Приостановлен' },
  { id: 'archived', label: 'Архив' },
];

const schema = z.object({
  name: z.string().min(2, 'Минимум 2 символа'),
  inn: z.string().regex(/^\d{10,12}$/, 'ИНН должен быть из 10 или 12 цифр'),
  industry: z.string().min(2),
  accountManagerId: z.string().min(1, 'Выберите менеджера'),
  status: z.enum(['lead', 'in_progress', 'active', 'paused', 'archived']),
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
  const managers = (users ?? []).filter((u) => u.role === 'account_manager' || u.role === 'admin');

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      inn: '',
      industry: '',
      accountManagerId: '',
      status: 'lead',
      ...defaultValues,
    } as ClientFormValues,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название</FormLabel>
              <FormControl><Input {...field} placeholder="ООО «Ромашка»" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="inn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ИНН</FormLabel>
                <FormControl><Input {...field} placeholder="7728029110" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
        </div>
        <FormField
          control={form.control}
          name="accountManagerId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Аккаунт-менеджер</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl><SelectTrigger><SelectValue placeholder="Выберите менеджера" /></SelectTrigger></FormControl>
                <SelectContent>
                  {managers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.fullName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
