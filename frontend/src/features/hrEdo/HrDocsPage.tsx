/**
 * Раздел «Кадровые документы» (группа «Кадры» в сайдбаре).
 *
 * Доступ — право `hr_edo:manage`: по умолчанию администратор и бухгалтер.
 * Вкладки: «Документы» (реестр, очередь подписи директора, массовая
 * отправка), «Сотрудники» (реестр со статусом КЭДО), «Журнал» (неизменяемый
 * протокол с хеш-цепочкой).
 */
import { useMemo, useState } from 'react';
import {
  Briefcase,
  CircleDot,
  FilePlus2,
  FileText,
  FileUp,
  MessageSquareText,
  Send,
  ShieldAlert,
  ShieldCheck,
  Stamp,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar, FilterChip, MenuItem } from '@/components/common/FilterChip';
import { useCan } from '@/lib/permissions';
import { APP_ENV, USE_MOCKS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useFiltersStore } from '@/stores/filters';
import { useQuery } from '@tanstack/react-query';
import { hrEdoApi, type EmploymentType, type HrDocStatus, type HrEdoStatus } from '@/api/hrEdo';
import { useChainCheck, useDocTypes, useHrDocuments, useHrEmployees, useHrEvents, useSendDocuments } from './hooks';
import { CreateDocumentDialog } from './CreateDocumentDialog';
import { DocumentSheet } from './DocumentSheet';
import { EmployeeFormDialog } from './EmployeeFormDialog';
import { EmployeeSheet } from './EmployeeSheet';
import { UploadDocumentDialog } from './UploadDocumentDialog';
import { PortalLinkDialog } from './dialogs';
import {
  DOC_STATUS,
  EDO_STATUS,
  EVENT_LABEL,
  apiErrorMessage,
  fmtDate,
  fmtDateTime,
  formatPhone,
  pluralRu,
} from './statuses';

type Tab = 'documents' | 'employees' | 'journal';

export function HrDocsPage() {
  const canManage = useCan('hr_edo:manage');
  const [tab, setTab] = useState<Tab>('documents');
  const [docId, setDocId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  if (!canManage) {
    return (
      <div className="flex-1 overflow-auto px-6 pb-8 pt-5">
        <Card>
          <CardContent className="p-4">
            <EmptyState
              icon={ShieldAlert}
              title="Раздел недоступен"
              description="«Кадровые документы» ведут бухгалтер и администратор. Свои документы вы найдёте в разделе «Мои документы»."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto px-4 pb-8 pt-5 md:px-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
          <Stamp className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold tracking-tight">Кадровые документы</h1>
          <p className="text-[11.5px] text-muted-foreground">
            Кадровый ЭДО: согласие сотрудника → электронная подпись по SMS → трудовой договор, приказы, заявления.
          </p>
        </div>
        {APP_ENV === 'dev' && !USE_MOCKS && <DevSmsButton />}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-3">
          <TabsTrigger value="documents">Документы</TabsTrigger>
          <TabsTrigger value="employees">Сотрудники</TabsTrigger>
          <TabsTrigger value="journal">Журнал</TabsTrigger>
        </TabsList>
        <TabsContent value="documents" className="mt-0">
          <DocumentsTab onOpen={setDocId} />
        </TabsContent>
        <TabsContent value="employees" className="mt-0">
          <EmployeesTab onOpen={setEmployeeId} />
        </TabsContent>
        <TabsContent value="journal" className="mt-0">
          <JournalTab onOpenDocument={setDocId} />
        </TabsContent>
      </Tabs>

      <EmployeeSheet employeeId={employeeId} onClose={() => setEmployeeId(null)} onOpenDocument={setDocId} />
      <DocumentSheet documentId={docId} onClose={() => setDocId(null)} />
    </div>
  );
}

// ── Документы ───────────────────────────────────────────────────────────────

const STATUS_FILTERS: HrDocStatus[] = [
  'draft',
  'awaiting_employer',
  'frozen',
  'sent',
  'viewed',
  'signed',
  'rejected',
  'expired',
  'cancelled',
  'archived_paper',
];

function DocumentsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const search = useFiltersStore((s) => s.search);
  const [status, setStatus] = useState<HrDocStatus | null>(null);
  const [typeCode, setTypeCode] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [links, setLinks] = useState<{ name: string; url: string }[]>([]);
  const { data: types = [] } = useDocTypes();
  const typeTitle = useMemo(() => new Map(types.map((t) => [t.code, t.title])), [types]);
  const { data, isLoading } = useHrDocuments({
    q: search || undefined,
    status: status ?? undefined,
    typeCode: typeCode ?? undefined,
    pageSize: 200,
  });
  const { data: queue } = useHrDocuments({ status: 'awaiting_employer', pageSize: 1 });
  const canSignEmployer = useCan('hr_edo:sign_employer');
  const send = useSendDocuments();
  const items = data?.items ?? [];
  const sendable = items.filter((d) => selected.has(d.id) && d.status === 'frozen');

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulkSend = async () => {
    try {
      const res = await send.mutateAsync(sendable.map((d) => d.id));
      toast.success(`Отправлено: ${res.items.length}`);
      const byEmp = new Map(res.items.map((d) => [d.employeeId, d.employeeName]));
      setLinks(Object.entries(res.portalLinks).map(([id, url]) => ({ name: byEmp.get(id) ?? '', url })));
      setSelected(new Set());
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось отправить'));
    }
  };

  return (
    <>
      {(queue?.total ?? 0) > 0 && status !== 'awaiting_employer' && (
        <button
          type="button"
          onClick={() => setStatus('awaiting_employer')}
          className="mb-3 flex w-full items-center gap-2 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-left text-[12.5px] hover:bg-violet-500/10"
        >
          <Stamp className="h-4 w-4 text-violet-600" />
          <span className="flex-1">
            {canSignEmployer ? 'Ждут вашей подписи' : 'Ждут подписи директора'}:{' '}
            <b className="tnum">{queue?.total}</b> {pluralRu(queue?.total ?? 0, ['документ', 'документа', 'документов'])}
          </span>
          <span className="text-muted-foreground">показать</span>
        </button>
      )}
      <FilterBar
        globalSearch
        searchPlaceholder="Поиск по документам…"
        hasActiveFilters={!!status || !!typeCode}
        onReset={() => {
          setStatus(null);
          setTypeCode(null);
        }}
        leftSlot={
          <div className="flex gap-1">
            <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setCreateOpen(true)}>
              <FilePlus2 className="h-3.5 w-3.5" /> Создать документ
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={() => setUploadOpen(true)}>
              <FileUp className="h-3.5 w-3.5" /> Загрузить
            </Button>
          </div>
        }
        rightSlot={
          <>
            {sendable.length > 0 && (
              <Button size="sm" className="h-7 gap-1.5" onClick={() => void bulkSend()} disabled={send.isPending}>
                <Send className="h-3.5 w-3.5" /> Отправить {sendable.length}
              </Button>
            )}
            <span className="tnum text-[11.5px] text-muted-foreground/80">
              {data?.total ?? 0} {pluralRu(data?.total ?? 0, ['документ', 'документа', 'документов'])}
            </span>
          </>
        }
      >
        <FilterChip
          active={!!status}
          icon={CircleDot}
          label="Статус"
          value={status ? DOC_STATUS[status].label : null}
          onClear={() => setStatus(null)}
        >
          {STATUS_FILTERS.map((s) => (
            <MenuItem key={s} selected={status === s} onClick={() => setStatus(s)}>
              {DOC_STATUS[s].label}
            </MenuItem>
          ))}
        </FilterChip>
        <FilterChip
          active={!!typeCode}
          icon={FileText}
          label="Тип"
          value={typeCode ? typeTitle.get(typeCode) : null}
          onClear={() => setTypeCode(null)}
          contentClassName="w-72"
        >
          <div className="max-h-72 overflow-y-auto">
            {types
              .filter((t) => t.stage === 1)
              .map((t) => (
                <MenuItem key={t.code} selected={typeCode === t.code} onClick={() => setTypeCode(t.code)}>
                  {t.title}
                </MenuItem>
              ))}
          </div>
        </FilterChip>
      </FilterBar>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-8" />
              <TableHead>Документ</TableHead>
              <TableHead>Сотрудник</TableHead>
              <TableHead className="hidden md:table-cell">Дата</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="hidden lg:table-cell">Обновлён</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Документов нет. Начните с вкладки «Сотрудники»: заведите сотрудника и пригласите его в КЭДО.
                </TableCell>
              </TableRow>
            )}
            {items.map((d) => (
              <TableRow key={d.id} className="cursor-pointer" onClick={() => onOpen(d.id)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  {d.status === 'frozen' && (
                    <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} aria-label="Выбрать" />
                  )}
                </TableCell>
                <TableCell>
                  <div className="font-medium">{d.title}</div>
                  <div className="tnum text-[11.5px] text-muted-foreground">{d.number ?? 'черновик'}</div>
                </TableCell>
                <TableCell className="text-[12.5px]">{d.employeeName}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-[12.5px] text-muted-foreground md:table-cell">
                  {fmtDate(d.docDate)}
                </TableCell>
                <TableCell>
                  <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', DOC_STATUS[d.status].className)}>
                    {DOC_STATUS[d.status].label}
                  </span>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-[12px] text-muted-foreground lg:table-cell">
                  {fmtDateTime(d.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CreateDocumentDialog open={createOpen} onOpenChange={setCreateOpen} />
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <PortalLinkDialog links={links} onClose={() => setLinks([])} />
    </>
  );
}

// ── Сотрудники ──────────────────────────────────────────────────────────────

const EDO_FILTERS: HrEdoStatus[] = ['not_invited', 'notified', 'consent_signed', 'active', 'refused', 'key_revoked'];
const EMPLOYMENT_FILTERS: EmploymentType[] = ['ТК РФ', 'ИП', 'СМЗ'];

function EmployeesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const search = useFiltersStore((s) => s.search);
  const [edoStatus, setEdoStatus] = useState<HrEdoStatus | null>(null);
  const [employment, setEmployment] = useState<EmploymentType | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading } = useHrEmployees({
    q: search || undefined,
    edoStatus: edoStatus ?? undefined,
    employmentType: employment ?? undefined,
    pageSize: 500,
  });
  const items = data?.items ?? [];

  return (
    <>
      <FilterBar
        globalSearch
        searchPlaceholder="Поиск сотрудников…"
        hasActiveFilters={!!edoStatus || !!employment}
        onReset={() => {
          setEdoStatus(null);
          setEmployment(null);
        }}
        leftSlot={
          <Button size="sm" variant="outline" className="h-7 gap-1.5" onClick={() => setCreateOpen(true)}>
            <UserPlus className="h-3.5 w-3.5" /> Добавить сотрудника
          </Button>
        }
        rightSlot={
          <span className="tnum text-[11.5px] text-muted-foreground/80">
            {data?.total ?? 0} {pluralRu(data?.total ?? 0, ['сотрудник', 'сотрудника', 'сотрудников'])}
          </span>
        }
      >
        <FilterChip
          active={!!edoStatus}
          icon={ShieldCheck}
          label="Статус КЭДО"
          value={edoStatus ? EDO_STATUS[edoStatus].label : null}
          onClear={() => setEdoStatus(null)}
        >
          {EDO_FILTERS.map((s) => (
            <MenuItem key={s} selected={edoStatus === s} onClick={() => setEdoStatus(s)}>
              {EDO_STATUS[s].label}
            </MenuItem>
          ))}
        </FilterChip>
        <FilterChip active={!!employment} icon={Briefcase} label="Оформление" value={employment} onClear={() => setEmployment(null)}>
          {EMPLOYMENT_FILTERS.map((s) => (
            <MenuItem key={s} selected={employment === s} onClick={() => setEmployment(s)}>
              {s}
            </MenuItem>
          ))}
        </FilterChip>
      </FilterBar>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>ФИО</TableHead>
              <TableHead className="hidden md:table-cell">Должность</TableHead>
              <TableHead className="hidden sm:table-cell">Оформление</TableHead>
              <TableHead className="hidden lg:table-cell">Телефон</TableHead>
              <TableHead>Статус КЭДО</TableHead>
              <TableHead className="text-right">Ждут подписи</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  Сотрудников нет. Добавьте вручную или оформите из кандидата в статусе «Вышел на работу».
                </TableCell>
              </TableRow>
            )}
            {items.map((e) => (
              <TableRow key={e.id} className="cursor-pointer" onClick={() => onOpen(e.id)}>
                <TableCell>
                  <div className="font-medium">{e.fullName}</div>
                  {e.userName && <div className="text-[11px] text-muted-foreground">в CRM: {e.userName}</div>}
                </TableCell>
                <TableCell className="hidden text-[12.5px] text-muted-foreground md:table-cell">{e.position || '—'}</TableCell>
                <TableCell className="hidden text-[12.5px] sm:table-cell">{e.employmentType}</TableCell>
                <TableCell className="tnum hidden text-[12.5px] text-muted-foreground lg:table-cell">{formatPhone(e.phone)}</TableCell>
                <TableCell>
                  <span
                    title={EDO_STATUS[e.edoStatus].hint}
                    className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', EDO_STATUS[e.edoStatus].className)}
                  >
                    {EDO_STATUS[e.edoStatus].label}
                  </span>
                </TableCell>
                <TableCell className="tnum text-right text-[12.5px]">{e.pendingDocuments || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <EmployeeFormDialog open={createOpen} onOpenChange={setCreateOpen} onSaved={(e) => onOpen(e.id)} />
    </>
  );
}

// ── Журнал ──────────────────────────────────────────────────────────────────

function JournalTab({ onOpenDocument }: { onOpenDocument: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useHrEvents({ page, pageSize: 50 });
  const { data: chain } = useChainCheck();
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / 50));

  return (
    <div className="space-y-3">
      {chain && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px]',
            chain.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5 text-red-700',
          )}
        >
          {chain.ok ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <ShieldAlert className="h-4 w-4" />}
          {chain.ok
            ? `Протокол целостен: проверено ${chain.checked} ${pluralRu(chain.checked, ['событие', 'события', 'событий'])}, хеш-цепочка не нарушена.`
            : `Нарушена целостность протокола на событии #${chain.brokenAtId} (${chain.reason}). Сообщите администратору.`}
        </div>
      )}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-16">#</TableHead>
              <TableHead>Событие</TableHead>
              <TableHead>Документ / сотрудник</TableHead>
              <TableHead className="hidden md:table-cell">Кто</TableHead>
              <TableHead className="hidden lg:table-cell">Хеш</TableHead>
              <TableHead>Когда</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-5" />
                </TableCell>
              </TableRow>
            )}
            {(data?.items ?? []).map((e) => (
              <TableRow
                key={e.id}
                className={cn(e.documentId && 'cursor-pointer')}
                onClick={() => e.documentId && onOpenDocument(e.documentId)}
              >
                <TableCell className="tnum text-[12px] text-muted-foreground">{e.id}</TableCell>
                <TableCell className="text-[12.5px] font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</TableCell>
                <TableCell className="text-[12.5px]">
                  <div className="truncate">{e.documentTitle ?? '—'}</div>
                  <div className="text-[11.5px] text-muted-foreground">{e.employeeName}</div>
                </TableCell>
                <TableCell className="hidden text-[12.5px] md:table-cell">
                  {e.actorName}
                  {e.ip && <div className="text-[11px] text-muted-foreground">{e.ip}</div>}
                </TableCell>
                <TableCell className="hidden font-mono text-[10.5px] text-muted-foreground lg:table-cell">
                  {e.hash.slice(0, 12)}…
                </TableCell>
                <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">{fmtDateTime(e.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <Button size="sm" variant="outline" className="h-7" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Назад
          </Button>
          <span className="tnum text-muted-foreground">
            {page} / {pages}
          </span>
          <Button size="sm" variant="outline" className="h-7" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Дальше
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Dev: SMS-outbox ─────────────────────────────────────────────────────────

function DevSmsButton() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: ['hr-edo', 'dev-sms'],
    queryFn: hrEdoApi.devSmsOutbox,
    enabled: open,
    refetchInterval: open ? 3000 : false,
    retry: false,
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 border-dashed text-[12px]">
          <MessageSquareText className="h-3.5 w-3.5" /> SMS (dev)
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <div className="px-1 pb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          SMS_PROVIDER=log — последние сообщения
        </div>
        {(data ?? []).length === 0 && <div className="px-1 py-2 text-[12px] text-muted-foreground">Пусто</div>}
        <div className="max-h-80 space-y-1.5 overflow-auto">
          {(data ?? []).map((m, i) => (
            <div key={i} className="rounded-md border px-2 py-1.5 text-[12px]">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span className="tnum">{m.phone}</span>
                <span>{fmtDateTime(m.sentAt)}</span>
              </div>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}


