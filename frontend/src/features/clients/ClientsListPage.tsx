import { useNavigate } from '@tanstack/react-router';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Skeleton } from '@/components/ui/skeleton';
import type { ClientStatus } from '@/api/types';
import { useClients, useUsers } from './hooks';
import { useFiltersStore } from '@/stores/filters';

const STATUS_LABEL: Record<ClientStatus, string> = {
  lead: 'Лид',
  in_progress: 'В работе',
  active: 'Активный',
  paused: 'Приостановлен',
  archived: 'Архив',
};
const STATUS_COLOR: Record<ClientStatus, string> = {
  lead: '#94a3b8',
  in_progress: '#3b82f6',
  active: '#10b981',
  paused: '#eab308',
  archived: '#cbd5e1',
};

export function ClientsListPage() {
  const search = useFiltersStore((s) => s.search);
  const navigate = useNavigate();
  const { data, isLoading } = useClients({ search });
  const { data: usersData } = useUsers();

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Название</TableHead>
              <TableHead>Юр. лица</TableHead>
              <TableHead>Отрасль</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Менеджер</TableHead>
              <TableHead className="text-right">Вакансии</TableHead>
              <TableHead className="text-right">Контакты</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}><Skeleton className="h-5" /></TableCell>
                </TableRow>
              ))}
            {(data?.items ?? []).map((c) => {
              const am = usersData?.find((u) => u.id === c.accountManagerId);
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate({ to: '/clients/$id', params: { id: c.id } })}>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell className="text-[12.5px] text-muted-foreground">
                    {c.legalEntities.length === 1
                      ? c.legalEntities[0].name
                      : `${c.legalEntities.length} юр. лиц`}
                  </TableCell>
                  <TableCell>{c.industry}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[c.status] }} />
                      {STATUS_LABEL[c.status]}
                    </span>
                  </TableCell>
                  <TableCell>
                    {am && (
                      <span className="flex items-center gap-2">
                        <UserAvatar user={am} size={22} />
                        <span className="text-[12.5px]">{am.fullName}</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tnum text-right font-semibold">{c.vacanciesCount}</TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">{c.contactsCount}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
