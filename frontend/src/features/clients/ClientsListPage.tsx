import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Briefcase, Building2, CircleDot, Handshake, Plus, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';
import type { ClientKind, ClientStatus } from '@/api/types';
import { ClientForm, type ClientFormValues } from './ClientForm';
import { useClients, useCreateClient, useUsers } from './hooks';
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

const STATUS_OPTIONS: ClientStatus[] = [
  'lead',
  'in_progress',
  'active',
  'paused',
  'archived',
];

const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  direct: 'Прямой',
  intermediary: 'Посредник',
};
const CLIENT_KIND_OPTIONS: ClientKind[] = ['direct', 'intermediary'];

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

interface Filters {
  status: ClientStatus | null;
  industry: string | null;
  accountManagerId: string | null;
  clientKind: ClientKind | null;
}

const EMPTY: Filters = { status: null, industry: null, accountManagerId: null, clientKind: null };

export function ClientsListPage() {
  const search = useFiltersStore((s) => s.search);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [addOpen, setAddOpen] = useState(false);
  const createClient = useCreateClient();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setFilters((p) => ({ ...p, [k]: v }));

  const handleCreate = (values: ClientFormValues) => {
    createClient.mutate(
      {
        name: values.name,
        legalEntities: values.legalEntities.map((le, i) => ({
          id: `le-${Date.now()}-${i}`,
          name: le.name,
          inn: le.inn,
        })),
        industry: values.industry,
        accountManagerId: values.accountManagerId,
        status: values.status,
        clientKind: values.clientKind,
        ...(values.telegramChat.trim() ? { telegramChat: values.telegramChat.trim() } : {}),
      },
      {
        onSuccess: (c) => {
          toast.success(`Клиент «${c.name}» создан`);
          setAddOpen(false);
          navigate({ to: '/clients/$id', params: { id: c.id } });
        },
        onError: () => toast.error('Не удалось создать клиента'),
      },
    );
  };

  const queryParams = useMemo(
    () => ({
      search,
      status: filters.status ?? undefined,
      industry: filters.industry ?? undefined,
      accountManagerId: filters.accountManagerId ?? undefined,
      clientKind: filters.clientKind ?? undefined,
    }),
    [search, filters],
  );

  const { data, isLoading } = useClients(queryParams);
  const { data: usersData } = useUsers();

  // Уникальный список отраслей — собираем из загруженных клиентов (исходим из того,
  // что в моках это разумное конечное множество; на боевом backend будет отдельный
  // endpoint /clients/industries).
  const industries = useMemo(() => {
    const set = new Set<string>();
    (data?.items ?? []).forEach((c) => c.industry && set.add(c.industry));
    return Array.from(set).sort();
  }, [data]);

  const totalCount = data?.items.length ?? 0;
  const hasActiveFilters =
    !!filters.status || !!filters.industry || !!filters.accountManagerId || !!filters.clientKind;

  const managerLabel = filters.accountManagerId
    ? usersData?.find((u) => u.id === filters.accountManagerId)?.fullName ?? '—'
    : null;

  return (
    <div className="flex-1 overflow-auto px-6 pb-6 pt-5">
      <FilterBar
        hasActiveFilters={hasActiveFilters}
        onReset={() => setFilters(EMPTY)}
        leftSlot={
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5"
            onClick={() => setAddOpen(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить клиента
          </Button>
        }
        rightSlot={
          <span className="tnum text-[11.5px] text-muted-foreground/80">
            {totalCount} {pluralize(totalCount, ['клиент', 'клиента', 'клиентов'])}
          </span>
        }
      >
        <FilterChip
          active={!!filters.status}
          icon={CircleDot}
          label="Статус"
          value={filters.status ? STATUS_LABEL[filters.status] : null}
          onClear={() => set('status', null)}
        >
          <MenuItem
            selected={!filters.status}
            onClick={() => set('status', null)}
          >
            Все статусы
          </MenuItem>
          {STATUS_OPTIONS.map((s) => (
            <MenuItem
              key={s}
              selected={filters.status === s}
              onClick={() => set('status', s)}
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: STATUS_COLOR[s] }}
                />
                {STATUS_LABEL[s]}
              </span>
            </MenuItem>
          ))}
        </FilterChip>

        <FilterChip
          active={!!filters.industry}
          icon={Briefcase}
          label="Отрасль"
          value={filters.industry}
          onClear={() => set('industry', null)}
        >
          <div className="max-h-64 overflow-y-auto">
            <MenuItem
              selected={!filters.industry}
              onClick={() => set('industry', null)}
            >
              Все отрасли
            </MenuItem>
            {industries.map((ind) => (
              <MenuItem
                key={ind}
                selected={filters.industry === ind}
                onClick={() => set('industry', ind)}
              >
                {ind}
              </MenuItem>
            ))}
          </div>
        </FilterChip>

        <FilterChip
          active={!!filters.accountManagerId}
          icon={UserIcon}
          label="Менеджер"
          value={managerLabel}
          onClear={() => set('accountManagerId', null)}
        >
          <div className="max-h-64 overflow-y-auto">
            <MenuItem
              selected={!filters.accountManagerId}
              onClick={() => set('accountManagerId', null)}
            >
              Все менеджеры
            </MenuItem>
            {(usersData ?? [])
              .filter((u) => u.role === 'account_manager' || u.role === 'admin')
              .map((u) => (
                <MenuItem
                  key={u.id}
                  selected={filters.accountManagerId === u.id}
                  onClick={() => set('accountManagerId', u.id)}
                >
                  {u.fullName}
                </MenuItem>
              ))}
          </div>
        </FilterChip>

        <FilterChip
          active={!!filters.clientKind}
          icon={Handshake}
          label="Тип"
          value={filters.clientKind ? CLIENT_KIND_LABEL[filters.clientKind] : null}
          onClear={() => set('clientKind', null)}
        >
          <MenuItem
            selected={!filters.clientKind}
            onClick={() => set('clientKind', null)}
          >
            Все типы
          </MenuItem>
          {CLIENT_KIND_OPTIONS.map((k) => (
            <MenuItem
              key={k}
              selected={filters.clientKind === k}
              onClick={() => set('clientKind', k)}
            >
              {CLIENT_KIND_LABEL[k]}
            </MenuItem>
          ))}
        </FilterChip>
      </FilterBar>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Название</TableHead>
              <TableHead>Юр. лица</TableHead>
              <TableHead>Отрасль</TableHead>
              <TableHead>Тип</TableHead>
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
                  <TableCell colSpan={8}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && (data?.items ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    По заданным фильтрам клиентов не найдено
                  </span>
                </TableCell>
              </TableRow>
            )}
            {(data?.items ?? []).map((c) => {
              const am = usersData?.find((u) => u.id === c.accountManagerId);
              return (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: '/clients/$id', params: { id: c.id } })}
                >
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell className="text-[12.5px] text-muted-foreground">
                    {c.legalEntities.length === 1
                      ? c.legalEntities[0].name
                      : `${c.legalEntities.length} юр. лиц`}
                  </TableCell>
                  <TableCell>{c.industry}</TableCell>
                  <TableCell>
                    <span
                      className={
                        c.clientKind === 'intermediary'
                          ? 'inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                          : 'inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                      }
                    >
                      {CLIENT_KIND_LABEL[c.clientKind]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: STATUS_COLOR[c.status] }}
                      />
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
                  <TableCell className="tnum text-right font-semibold">
                    {c.vacanciesCount}
                  </TableCell>
                  <TableCell className="tnum text-right text-muted-foreground">
                    {c.contactsCount}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4">
            <SheetTitle>Новый клиент</SheetTitle>
            <SheetDescription>
              Заполните основные поля. Контакты можно добавить позже из карточки клиента.
            </SheetDescription>
          </SheetHeader>
          <ClientForm
            onSubmit={handleCreate}
            isPending={createClient.isPending}
            submitLabel="Создать"
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
