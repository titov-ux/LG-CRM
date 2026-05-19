import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

const schema = z.object({
  name: z.string().min(2),
  inn: z.string().regex(/^\d{10,12}$/, 'ИНН должен быть из 10 или 12 цифр'),
  industry: z.string().min(2),
});

export type ClientFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<ClientFormValues>;
  onSubmit: (values: ClientFormValues) => void;
}

export function ClientForm({ defaultValues, onSubmit }: Props) {
  const form = useForm<ClientFormValues>({ resolver: zodResolver(schema), defaultValues });
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem>
            <FormLabel>Название</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="inn" render={({ field }) => (
          <FormItem>
            <FormLabel>ИНН</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="industry" render={({ field }) => (
          <FormItem>
            <FormLabel>Отрасль</FormLabel>
            <FormControl><Input {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <Button type="submit">Сохранить</Button>
      </form>
    </Form>
  );
}
