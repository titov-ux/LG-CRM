import { useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Copy, Edit3, MoreHorizontal, X } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/common/UserAvatar';
import { StackTags } from '@/components/common/StackTags';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { useVacancy } from './hooks';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import { useCandidates } from '@/features/candidates/hooks';
import { vacancyStatuses } from '@/mocks/db/vacancies';
import { formatDateRu, formatMoneyRub } from '@/lib/utils';

export function VacancyCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/vacancies/$id' });
  const { data: vacancy, isLoading } = useVacancy(id);
  const { data: clientsData } = useClients();
  const { data: usersData } = useUsers();
  const { data: candidatesData } = useCandidates();

  const close = () => navigate({ to: '/vacancies' });
  const client = clientsData?.items.find((c) => c.id === vacancy?.clientId);
  const accountManager = usersData?.find((u) => u.id === client?.accountManagerId);
  const status = vacancyStatuses.find((s) => s.id === vacancy?.status);
  const attached = (candidatesData?.items ?? []).filter((c) => vacancy && c.vacancyIds.includes(vacancy.id));

  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent hideClose className="overflow-y-auto p-0 sm:max-w-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={close}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon"><Edit3 className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon"><Copy className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
          </div>
          <Button variant="ghost" size="icon" onClick={close}><X className="h-3.5 w-3.5" /></Button>
        </div>

        {isLoading || !vacancy ? (
          <div className="space-y-4 px-6 py-6">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <div className="space-y-6 px-6 py-6">
            <div className="space-y-2.5 pb-4">
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Вакансия · {client?.name}
              </div>
              <div className="text-[22px] font-bold leading-tight tracking-tight">{vacancy.title}</div>
              <div className="flex flex-wrap items-center gap-2">
                {status && (
                  <span className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-xs font-medium">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.color }} />
                    {status.label}
                  </span>
                )}
                <PriorityBadge priority={vacancy.priority} />
                <span className="text-xs text-muted-foreground">
                  {vacancy.grade} · {vacancy.format}
                </span>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-7 gap-y-3.5 text-sm">
              <Field label="Клиент" value={client?.name} />
              <Field
                label="Аккаунт-менеджер"
                value={
                  accountManager && (
                    <span className="flex items-center gap-1.5">
                      <UserAvatar user={accountManager} size={20} />
                      <span>{accountManager.fullName}</span>
                    </span>
                  )
                }
              />
              <Field label="Ставка для клиента" value={`${formatMoneyRub(vacancy.rateClient)} ₽/час`} />
              <Field label="Бюджет на кандидата" value={`${formatMoneyRub(vacancy.rateMax)} ₽/час`} />
              <Field label="Позиций" value={vacancy.positions} />
              <Field label="Дедлайн" value={formatDateRu(vacancy.deadline)} />
            </div>

            <Section title="Стек технологий">
              <StackTags stack={vacancy.stack} variant="accent" />
            </Section>

            <Section title="Назначенные рекрутеры">
              {vacancy.recruiterIds.length === 0 ? (
                <span className="text-xs text-muted-foreground">Не назначены</span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {vacancy.recruiterIds.map((rid) => {
                    const u = usersData?.find((x) => x.id === rid);
                    if (!u) return null;
                    return (
                      <div key={rid} className="flex items-center gap-1.5 rounded-full bg-muted py-1 pl-1 pr-3">
                        <UserAvatar user={u} size={20} />
                        <span className="text-xs">{u.fullName}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title={`Прикреплённые кандидаты · ${attached.length}`}>
              {attached.length === 0 ? (
                <div className="py-2 text-xs text-muted-foreground">Кандидаты пока не прикреплены.</div>
              ) : (
                <div className="space-y-1.5">
                  {attached.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => navigate({ to: '/candidates/$id', params: { id: c.id } })}
                      className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2.5 text-left hover:bg-muted"
                    >
                      <div className="flex items-center gap-2.5">
                        <UserAvatar
                          user={{ fullName: c.fullName, initials: c.fullName.split(' ').map((p) => p[0]).slice(0, 2).join(''), color: '#475569' }}
                          size={26}
                        />
                        <div>
                          <div className="text-[13px] font-semibold">{c.fullName}</div>
                          <div className="text-[11.5px] text-muted-foreground">{c.role}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tnum text-xs font-semibold">{formatMoneyRub(c.rate)} ₽</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div>{value ?? '—'}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
