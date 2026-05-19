import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

// Скелет формы создания/редактирования вакансии. В прототипе это был только drawer;
// здесь оставляем отдельный компонент — он переиспользуется и из drawer, и со страницы.

const schema = z.object({
  title: z.string().min(2),
  clientId: z.string().min(1),
  grade: z.enum(['Junior', 'Middle', 'Senior', 'Lead']),
  rateClient: z.coerce.number().positive(),
  rateMax: z.coerce.number().positive(),
  positions: z.coerce.number().int().positive(),
});

export type VacancyFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<VacancyFormValues>;
  onSubmit: (values: VacancyFormValues) => void;
  isPending?: boolean;
}

export function VacancyForm({ defaultValues, onSubmit, isPending }: Props) {
  const form = useForm<VacancyFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { positions: 1, rateClient: 0, rateMax: 0, ...defaultValues } as VacancyFormValues,
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
          name="positions"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Позиций</FormLabel>
              <FormControl><Input type="number" min={1} {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={isPending}>Сохранить</Button>
      </form>
    </Form>
  );
}
