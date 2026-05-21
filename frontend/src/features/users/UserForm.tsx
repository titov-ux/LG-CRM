import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormDescription,
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
import { Switch } from '@/components/ui/switch';
import type { CreateUserRequest, Role } from '@/api/types';

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Администратор',
  account_manager: 'Аккаунт-менеджер',
  recruiter: 'Рекрутер',
  viewer: 'Наблюдатель',
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  admin: 'Полный доступ ко всем разделам, может управлять пользователями.',
  account_manager: 'Ведёт клиентов и вакансии, видит аналитику по своим сделкам.',
  recruiter: 'Работает с кандидатами и вакансиями, ведёт воронку подбора.',
  viewer: 'Только просмотр данных без права редактирования.',
};

const schema = z.object({
  fullName: z.string().min(2, 'Минимум 2 символа').max(120),
  email: z.string().email('Введите корректный email'),
  telegram: z.string(),
  role: z.enum(['admin', 'account_manager', 'recruiter', 'viewer']),
  password: z
    .string()
    .min(8, 'Минимум 8 символов')
    .max(64, 'Максимум 64 символа')
    .regex(/[A-Za-zА-Яа-я]/, 'Должна содержать буквы')
    .regex(/\d/, 'Должна содержать цифры'),
  isActive: z.boolean(),
});

export type UserFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<UserFormValues>;
  onSubmit: (values: CreateUserRequest) => void;
  isPending?: boolean;
  submitLabel?: string;
}

export function UserForm({ defaultValues, onSubmit, isPending, submitLabel = 'Создать' }: Props) {
  const form = useForm<UserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      email: '',
      telegram: '',
      role: 'recruiter',
      password: '',
      isActive: true,
      ...defaultValues,
    } as UserFormValues,
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) =>
          onSubmit({
            ...v,
            ...(v.telegram.trim() ? { telegram: v.telegram.trim() } : {}),
          }),
        )}
        className="space-y-4"
      >
        <FormField
          control={form.control}
          name="fullName"
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
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  placeholder="user@lg-integration.ru"
                  autoComplete="email"
                />
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
              <FormLabel>Telegram</FormLabel>
              <FormControl>
                <Input {...field} placeholder="@username" autoComplete="off" />
              </FormControl>
              <FormDescription>Необязательно. Будет показан в карточке профиля сотрудника.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="role"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Роль</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>{ROLE_DESCRIPTION[field.value as Role]}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Временный пароль</FormLabel>
              <FormControl>
                <Input {...field} type="text" placeholder="Минимум 8 символов" autoComplete="new-password" />
              </FormControl>
              <FormDescription>Пользователь сменит его при первом входе.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-md border p-3">
              <div>
                <FormLabel className="text-sm">Активен</FormLabel>
                <FormDescription className="mt-0.5">
                  Деактивированные пользователи не могут войти в систему.
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
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
