import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Building2,
  Cake,
  Mail,
  Phone,
  Plus,
  Send,
  ToggleRight,
} from 'lucide-react';
import { formatDateRu, telegramUrl } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';
import { useFiltersStore } from '@/stores/filters';
import { useClients } from '@/features/clients/hooks';
import { useContacts } from './hooks';
import { AddContactDialog } from './AddContactDialog';

type ChannelKey = 'hasEmail' | 'hasPhone' | 'hasTelegram' | 'hasBirthday';

const CHANNEL_LABEL: Record<ChannelKey, string> = {
  hasEmail: 'Email',
  hasPhone: 'Телефон',
  hasTelegram: 'Telegram',
  hasBirthday: 'День рождения',
};

const CHANNEL_OPTIONS: ChannelKey[] = [
  'hasEmail',
  'hasPhone',
  'hasTelegram',
  'hasBirthday',
];

function pluralize(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

interface Filters {
  clientId: string | null;
  channels: Record<ChannelKey, boolean>;
}

const EMPTY: Filters = {
  clientId: null,
  channels: { hasEmail: false, hasPhone: false, hasTelegram: false, hasBirthday: false },
};

export function ContactsListPage() {
  const search = useFiltersStore((s) => s.search);
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [addOpen, setAddOpen] = useState(false);

  const queryParams = useMemo(
    () => ({
      search,
      clientId: filters.clientId ?? undefined,
      hasEmail: filters.channels.hasEmail || undefined,
      hasPhone: filters.channels.hasPhone || undefined,
      hasTelegram: filters.channels.hasTelegram || undefined,
      hasBirthday: filters.channels.hasBirthday || undefined,
    }),
    [search, filters],
  );

  const { data, isLoading } = useContacts(queryParams);
  // Список клиентов нужен и для подсказки фильтра, и для отображения в строках.
  const { data: clientsData } = useClients();

  const totalCount = data?.items.length ?? 0;
  const activeChannels = CHANNEL_OPTIONS.filter((k) => filters.channels[k]);
  const hasActiveFilters = !!filters.clientId || activeChannels.length > 0;

  const clientLabel = filters.clientId
    ? clientsData?.items.find((c) => c.id === filters.clientId)?.name ?? '—'
    : null;

  const channelsLabel =
    activeChannels.length === 0
      ? null
      : activeChannels.length === 1
        ? CHANNEL_LABEL[activeChannels[0]]
        : `${activeChannels.length} канала`;

  const toggleChannel = (k: ChannelKey) =>
    setFilters((p) => ({
      ...p,
      channels: { ...p.channels, [k]: !p.channels[k] },
    }));

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
            Добавить контакт
          </Button>
        }
        rightSlot={
          <span className="tnum text-[11.5px] text-muted-foreground/80">
            {totalCount} {pluralize(totalCount, ['контакт', 'контакта', 'контактов'])}
          </span>
        }
      >
        <FilterChip
          active={!!filters.clientId}
          icon={Building2}
          label="Клиент"
          value={clientLabel}
          onClear={() => setFilters((p) => ({ ...p, clientId: null }))}
        >
          <div className="max-h-64 overflow-y-auto">
            <MenuItem
              selected={!filters.clientId}
              onClick={() => setFilters((p) => ({ ...p, clientId: null }))}
            >
              Все клиенты
            </MenuItem>
            {(clientsData?.items ?? []).map((c) => (
              <MenuItem
                key={c.id}
                selected={filters.clientId === c.id}
                onClick={() => setFilters((p) => ({ ...p, clientId: c.id }))}
              >
                {c.name}
              </MenuItem>
            ))}
          </div>
        </FilterChip>

        <FilterChip
          active={activeChannels.length > 0}
          icon={ToggleRight}
          label="Каналы"
          value={channelsLabel}
          onClear={() =>
            setFilters((p) => ({
              ...p,
              channels: { hasEmail: false, hasPhone: false, hasTelegram: false, hasBirthday: false },
            }))
          }
        >
          <div className="p-0.5">
            <div className="px-2 pb-1 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Есть контактные данные
            </div>
            {CHANNEL_OPTIONS.map((k) => (
              <MenuItem
                key={k}
                selected={filters.channels[k]}
                onClick={() => toggleChannel(k)}
              >
                <span className="inline-flex items-center gap-2">
                  {k === 'hasEmail' && <Mail className="h-3.5 w-3.5 text-muted-foreground" />}
                  {k === 'hasPhone' && <Phone className="h-3.5 w-3.5 text-muted-foreground" />}
                  {k === 'hasTelegram' && <Send className="h-3.5 w-3.5 text-muted-foreground" />}
                  {k === 'hasBirthday' && <Cake className="h-3.5 w-3.5 text-muted-foreground" />}
                  {CHANNEL_LABEL[k]}
                </span>
              </MenuItem>
            ))}
          </div>
        </FilterChip>
      </FilterBar>

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
                  По заданным фильтрам контактов не найдено
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
