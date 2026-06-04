import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { DateField } from '@/components/forms/DateField';
import { useUsers } from '@/features/users/hooks';
import type { Priority, TenderLaw } from '@/api/types';
import { TENDER_LAW_OPTIONS, TENDER_PLATFORMS } from './statuses';

const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'low', label: 'Низкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'high', label: 'Высокий' },
  { id: 'urgent', label: 'Срочно' },
];

const MAX_SUM = 100_000_000_000; // 100 млрд — потолок НМЦК

const optionalSum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().nonnegative('Не может быть отрицательным').max(MAX_SUM).optional(),
);

const schema = z.object({
  title: z.string().min(2, 'Минимум 2 символа'),
  customer: z.string().min(2, 'Укажите заказчика'),
  law: z.enum(['fz44', 'fz223', 'commercial']) as z.ZodType<TenderLaw>,
  registryNumber: z.string().optional(),
  platform: z.string().optional(),
  nmck: optionalSum,
  ourPrice: optionalSum,
  securityAmount: optionalSum,
  submissionDeadline: z.string().optional(),
  auctionDate: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  accountManagerId: z.string().optional(),
  url: z.string().url('Некорректная ссылка').optional().or(z.literal('')),
  note: z.string().optional(),
});

export type TenderFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<TenderFormValues>;
  onSubmit: (values: TenderFormValues) => void;
  isPending?: boolean;
  submitLabel?: string;
  onCancel?: () => void;
}

export function TenderForm({
  defaultValues,
  onSubmit,
  isPending,
  submitLabel = 'Сохранить',
  onCancel,
}: Props) {
  const { data: users } = useUsers();
  const accountManagers = (users ?? []).filter(
    (u) => (u.role === 'account_manager' || u.role === 'admin') && u.isActive,
  );

  const form = useForm<TenderFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      customer: '',
      law: 'fz44',
      registryNumber: '',
      platform: '',
      nmck: undefined,
      ourPrice: undefined,
      securityAmount: undefined,
      submissionDeadline: '',
      auctionDate: '',
      priority: 'medium',
      accountManagerId: '',
      url: '',
      note: '',
      ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название закупки</FormLabel>
              <FormControl>
                <Input placeholder="Оказание услуг по подбору ИТ-персонала…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="customer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Заказчик</FormLabel>
              <FormControl>
                <Input placeholder="ПАО «…», ГБУ «…»" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="law"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Закон</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TENDER_LAW_OPTIONS.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Приоритет</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="registryNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Реестровый №</FormLabel>
                <FormControl>
                  <Input placeholder="0173100…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="platform"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Площадка (ЭТП)</FormLabel>
                <FormControl>
                  <Input list="tender-platforms" placeholder="Сбербанк-АСТ…" {...field} />
                </FormControl>
                <datalist id="tender-platforms">
                  {TENDER_PLATFORMS.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField
            control={form.control}
            name="nmck"
            render={({ field }) => (
              <FormItem>
                <FormLabel>НМЦК, ₽</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="0"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ourPrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Наша цена, ₽</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="—"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="securityAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Обеспечение, ₽</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="—"
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="submissionDeadline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Срок подачи</FormLabel>
                <FormControl>
                  <DateField value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="auctionDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дата торгов</FormLabel>
                <FormControl>
                  <DateField value={field.value} onChange={field.onChange} />
                </FormControl>
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
              <FormLabel>Ответственный</FormLabel>
              <Select
                value={field.value || '__none__'}
                onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Без ответственного" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="__none__">Без ответственного</SelectItem>
                  {accountManagers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="url"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ссылка на закупку</FormLabel>
              <FormControl>
                <Input placeholder="https://zakupki.gov.ru/…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Заметки</FormLabel>
              <FormControl>
                <Textarea rows={3} placeholder="Условия, риски, комментарии…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-1">
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isPending}>
              Отмена
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
