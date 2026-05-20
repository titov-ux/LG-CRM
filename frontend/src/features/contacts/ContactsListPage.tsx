import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Mail, Phone, Plus, Send } from 'lucide-react';
import { formatDateRu, telegramUrl } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useFiltersStore } from '@/stores/filters';
import { useContacts } from './hooks';
import { AddContactDialog } from './AddContactDialog';

export function ContactsListPage() {
  const search = useFiltersStore((s) => s.search);
  const navigate = useNavigate();
  const { data, isLoading } = useContacts({ search });
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Всего: <span className="tnum font-medium text-foreground">{data?.total ?? 0}</span>
        </div>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          Добавить контакт
        </Button>
      </div>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>ФИО</TableHead>
              <TableHead>Должность</TableHead>
              <TableHead>Клиент</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Телефон</TableHead>
              <TableHead>Telegram</TableHead>
              <TableHead>День рождения</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}><Skeleton className="h-5" /></TableCell>
                </TableRow>
              ))}
            {!isLoading && (data?.items ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  Контактов не найдено
                </TableCell>
              </TableRow>
            )}
            {(data?.items ?? []).map((c) => (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => navigate({ to: '/contacts/$id', params: { id: c.id } })}
              >
                <TableCell className="font-semibold">{c.name}</TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">{c.role}</TableCell>
                <TableCell>{c.clientName}</TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">{c.email ?? '—'}</TableCell>
                <TableCell className="tnum text-[12.5px] text-muted-foreground">{c.phone ?? '—'}</TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground">{c.telegram ?? '—'}</TableCell>
                <TableCell className="text-[12.5px] text-muted-foreground whitespace-nowrap">
                  {c.birthday ? formatDateRu(c.birthday) : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
                    {c.email && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <a href={`mailto:${c.email}`} aria-label={`Написать ${c.name}`}>
                          <Mail className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    {c.phone && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <a href={`tel:${c.phone.replace(/\s/g, '')}`} aria-label={`Позвонить ${c.name}`}>
                          <Phone className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                    {c.telegram && (
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                        <a
                          href={telegramUrl(c.telegram)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Написать в Telegram ${c.name}`}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <AddContactDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
