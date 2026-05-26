import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, ChevronDown, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { VacancyImportDialog } from './VacancyImportDialog';
import type { ParsedVacancy } from './types';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import { EngagementTypeField } from '@/components/forms/EngagementTypeField';
import { DateField } from '@/components/forms/DateField';
import { cn } from '@/lib/utils';
import type { EngagementType, Grade, Priority, WorkFormat } from '@/api/types';

// Полная форма вакансии. Используется и в quick-create, и в drawer редактирования.

const GRADES: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];
const FORMATS: WorkFormat[] = ['Удалённо', 'Гибрид', 'Офис'];
const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'low', label: 'Низкий' },
  { id: 'medium', label: 'Средний' },
  { id: 'high', label: 'Высокий' },
  { id: 'urgent', label: 'Срочно' },
];

const MAX_CLIENT_RATE = 100_000;
const MAX_SALARY = 10_000_000;

// Пустую строку из number-инпута приводим к undefined, чтобы поле было реально опциональным
// (без этого z.coerce.number() для '' превращается в 0 и роняет .positive()).
const optionalPositiveNumber = z
  .preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().positive('Должно быть больше 0').max(MAX_SALARY).optional(),
  );

const schema = z
  .object({
    title: z.string().min(2, 'Минимум 2 символа'),
    clientId: z.string().min(1, 'Выберите клиента'),
    engagementType: z.enum(['outstaff', 'agency'], {
      required_error: 'Выберите тип сделки',
    }) as z.ZodType<EngagementType>,
    project: z.string().optional(),
    grade: z.enum(['Junior', 'Middle', 'Senior', 'Lead']),
    format: z.enum(['Удалённо', 'Гибрид', 'Офис']),
    priority: z.enum(['low', 'medium', 'high', 'urgent']),
    // rateClient валидируется как «обязательный положительный» только для аутстаффа,
    // см. superRefine ниже. Для агентских вакансий значение не используется.
    rateClient: z.coerce
      .number()
      .max(MAX_CLIENT_RATE, `Не больше ${MAX_CLIENT_RATE.toLocaleString('ru-RU')} ₽/ч`)
      .optional(),
    salaryMax: optionalPositiveNumber,
    positions: z.coerce.number().int().positive(),
    stack: z.string().optional(),
    deadline: z.string().optional(),
    accountManagerId: z.string().min(1, 'Выберите аккаунт-менеджера'),
    recruiterIds: z.array(z.string()).default([]),
    description: z.string().optional(),
    requirements: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.engagementType === 'outstaff') {
      if (!values.rateClient || values.rateClient <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rateClient'],
          message: 'Должно быть больше 0',
        });
      }
    }
  });

export type VacancyFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<VacancyFormValues>;
  onSubmit: (values: VacancyFormValues) => void;
  isPending?: boolean;
  submitLabel?: string;
}

export function VacancyForm({
  defaultValues,
  onSubmit,
  isPending,
  submitLabel = 'Сохранить',
}: Props) {
  const { data: clientsData } = useClients();
  const { data: users } = useUsers();
  // В качестве «ответственных рекрутеров» можно назначать и админов — они тоже ведут вакансии.
  const recruiters = (users ?? []).filter((u) => u.role === 'recruiter' || u.role === 'admin');
  // В поле «Ответственный менеджер» можно выбирать как аккаунт-менеджеров, так и админов.
  const accountManagers = (users ?? []).filter(
    (u) => (u.role === 'account_manager' || u.role === 'admin') && u.isActive,
  );
  const [importOpen, setImportOpen] = useState(false);

  const form = useForm<VacancyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      clientId: '',
      engagementType: 'outstaff',
      project: '',
      grade: 'Senior',
      format: 'Удалённо',
      priority: 'medium',
      positions: 1,
      // Оставляем поле пустым — пользователь видит плейсхолдер «0», а не реальный ноль.
      rateClient: undefined,
      salaryMax: undefined,
      stack: '',
      deadline: '',
      accountManagerId: '',
      recruiterIds: [],
      description: '',
      requirements: '',
      ...defaultValues,
    } as VacancyFormValues,
  });

  // Если у формы уже есть АМ в defaultValues (режим редактирования), не перезаписываем его.
  const shouldAutofillAm = !defaultValues?.accountManagerId;
  const watchedClientId = useWatch({ control: form.control, name: 'clientId' });
  const watchedEngagement = useWatch({ control: form.control, name: 'engagementType' });
  const isAgency = watchedEngagement === 'agency';
  useEffect(() => {
    if (!shouldAutofillAm) return;

    if (!watchedClientId) {
      if (form.getValues('accountManagerId')) {
        form.setValue('accountManagerId', '', { shouldDirty: false, shouldValidate: false });
      }
      return;
    }

    const client = clientsData?.items.find((c) => c.id === watchedClientId);
    const nextAccountManagerId = client?.accountManagerId ?? '';
    if (nextAccountManagerId && form.getValues('accountManagerId') !== nextAccountManagerId) {
      form.setValue('accountManagerId', nextAccountManagerId, { shouldDirty: false, shouldValidate: false });
    }
  }, [watchedClientId, clientsData, form, shouldAutofillAm]);

  const applyParsed = (parsed: ParsedVacancy) => {
    const setIf = (key: keyof VacancyFormValues, value: unknown) => {
      if (value !== undefined && value !== '' && value !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        form.setValue(key, value as any, { shouldDirty: true, shouldValidate: false });
      }
    };
    setIf('title', parsed.title);
    setIf('project', parsed.project);
    setIf('grade', parsed.grade);
    setIf('format', parsed.format);
    setIf('priority', parsed.priority);
    setIf('deadline', parsed.deadline);
    setIf('rateClient', parsed.rateClient);
    setIf('stack', parsed.stack);
    setIf('description', parsed.description);
    setIf('requirements', parsed.requirements);
  };

  return (
    <Form {...form}>
      <div className="mb-3 flex justify-start">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setImportOpen(true)}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          Распознать из текста
        </Button>
      </div>

      <VacancyImportDialog open={importOpen} onOpenChange={setImportOpen} onApply={applyParsed} />

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="engagementType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Тип сделки</FormLabel>
              <FormControl>
                <EngagementTypeField value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Название</FormLabel>
              <FormControl><Input {...field} placeholder="Senior Backend (Java)" /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="clientId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Клиент</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger><SelectValue placeholder="Выберите клиента" /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  {(clientsData?.items ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="project"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Проект</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Например, Биллинг или Mobile Banking" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="grade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Грейд</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="format"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Формат</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {isAgency ? (
            <FormField
              control={form.control}
              name="salaryMax"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Оклад до (₽/мес)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={MAX_SALARY}
                      placeholder="0"
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      {...field}
                      // 0/undefined/null трактуем одинаково — поле выглядит пустым, виден плейсхолдер.
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name="rateClient"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ставка клиента (₽/ч)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={MAX_CLIENT_RATE}
                      placeholder="0"
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      {...field}
                      value={field.value || ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="positions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Позиций</FormLabel>
                <FormControl><Input type="number" min={1} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Приоритет</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="deadline"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Дедлайн</FormLabel>
                <FormControl>
                  <DateField value={field.value} onChange={field.onChange} onBlur={field.onBlur} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="accountManagerId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ответственный менеджер</FormLabel>
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                >
                  <FormControl><SelectTrigger><SelectValue placeholder="Не назначен" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {accountManagers.map((u) => (
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
            name="recruiterIds"
            render={({ field }) => {
              const selected = field.value ?? [];
              const toggle = (id: string) => {
                if (selected.includes(id)) {
                  field.onChange(selected.filter((x) => x !== id));
                } else {
                  field.onChange([...selected, id]);
                }
              };
              const selectedUsers = selected
                .map((id) => recruiters.find((r) => r.id === id))
                .filter(Boolean) as typeof recruiters;
              return (
                <FormItem>
                  <FormLabel>Ответственные рекрутеры</FormLabel>
                  <Popover>
                    <FormControl>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background',
                            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
                          )}
                        >
                          <div className="flex flex-1 flex-wrap items-center gap-1">
                            {selectedUsers.length === 0 ? (
                              <span className="text-muted-foreground">Не назначены</span>
                            ) : (
                              selectedUsers.map((u) => (
                                <span
                                  key={u.id}
                                  className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pl-2 pr-1 text-xs"
                                >
                                  {u.fullName}
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Убрать ${u.fullName}`}
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      toggle(u.id);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        toggle(u.id);
                                      }
                                    }}
                                    className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                                  >
                                    <X className="h-3 w-3" />
                                  </span>
                                </span>
                              ))
                            )}
                          </div>
                          <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                        </button>
                      </PopoverTrigger>
                    </FormControl>
                    <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
                      <Command>
                        <CommandInput placeholder="Поиск рекрутера…" />
                        <CommandList>
                          <CommandEmpty>Ничего не найдено</CommandEmpty>
                          <CommandGroup>
                            {recruiters.map((r) => {
                              const isSelected = selected.includes(r.id);
                              return (
                                <CommandItem
                                  key={r.id}
                                  value={r.fullName}
                                  onSelect={() => toggle(r.id)}
                                >
                                  <div
                                    className={cn(
                                      'mr-2 flex h-4 w-4 items-center justify-center rounded-sm border',
                                      isSelected
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-input',
                                    )}
                                  >
                                    {isSelected && <Check className="h-3 w-3" />}
                                  </div>
                                  <span>{r.fullName}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        </div>

        <FormField
          control={form.control}
          name="stack"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Стек</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Java, Spring, Kafka, PostgreSQL" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Описание</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={5}
                  placeholder="Чем занимается команда, что за проект, особенности работы…"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="requirements"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Требования</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={6}
                  placeholder={'Обязательно:\n— …\n\nЖелательно:\n— …'}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
