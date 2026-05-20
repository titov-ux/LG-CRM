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
import type { CreateContactRequest } from '@/api/types';

const schema = z.object({
  name: z.string().min(2, 'Минимум 2 символа'),
  role: z.string().min(2, 'Укажите должность'),
  email: z.union([z.literal(''), z.string().email('Некорректный email')]),
  phone: z.string(),
  telegram: z.string(),
  birthday: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите корректную дату')]),
});

export type ContactFormValues = z.infer<typeof schema>;

interface Props {
  onSubmit: (values: CreateContactRequest) => void;
  isPending?: boolean;
  submitLabel?: string;
  defaultValues?: Partial<ContactFormValues>;
}

export function ContactForm({ onSubmit, isPending, submitLabel = 'Добавить', defaultValues }: Props) {
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      role: '',
      email: '',
      phone: '',
      telegram: '',
      birthday: '',
      ...defaultValues,
    },
  });

  const handleSubmit = (values: ContactFormValues) => {
    onSubmit({
      name: values.name,
      role: values.role,
      ...(values.email ? { email: values.email } : {}),
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.telegram ? { telegram: values.telegram } : {}),
      ...(values.birthday ? { birthday: values.birthday } : {}),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>ФИО</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Иван Иванов" autoComplete="name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Должность</FormLabel>
              <FormControl>
                <Input {...field} placeholder="HRD, CTO, Project Manager…" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} type="email" placeholder="name@company.ru" autoComplete="email" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Телефон</FormLabel>
              <FormControl>
                <Input {...field} type="tel" placeholder="+7 (495) 000-00-00" autoComplete="tel" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="telegram"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Telegram-аккаунт</FormLabel>
              <FormControl>
                <Input {...field} placeholder="@username" autoComplete="off" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="birthday"
          render={({ field }) => (
            <FormItem>
              <FormLabel>День рождения (необязательно)</FormLabel>
              <FormControl>
                <Input {...field} type="date" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end pt-1">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
