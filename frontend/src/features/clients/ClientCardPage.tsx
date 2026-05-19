import { useNavigate, useParams } from '@tanstack/react-router';
import { ChevronLeft, Copy, Edit3, Mail, MoreHorizontal, Phone, X } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useClient, useClientContacts, useUsers } from './hooks';
import { useVacancies } from '@/features/vacancies/hooks';
import { vacancyStatuses } from '@/mocks/db/vacancies';

const STATUS_LABEL: Record<string, string> = {
  lead: 'Лид', in_progress: 'В работе', active: 'Активный', paused: 'Приостановлен', archived: 'Архив',
};

export function ClientCardPage() {
  const navigate = useNavigate();
  const { id } = useParams({ from: '/_authed/clients/$id' });
  const { data: client, isLoading } = useClient(id);
  const { data: contacts } = useClientContacts(id);
  const { data: usersData } = useUsers();
  const { data: vacanciesData } = useVacancies({ clientId: id });

  const am = usersData?.find((u) => u.id === client?.accountManagerId);
  const close = () => navigate({ to: '/clients' });

  return (
    <Sheet open onOpenChange={(o) => !o && close()}>
      <SheetContent hideClose className="overflow-y-auto p-0 sm:max-w-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={close}><ChevronLeft className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon"><Edit3 className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon"><Copy className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
          </div>
          <Button variant="ghost" size="icon" onClick={close}><X className="h-3.5 w-3.5" /></Button>
        </div>

        {isLoading || !client ? (
          <div className="space-y-3 px-6 py-6"><Skeleton className="h-10 w-3/4" /><Skeleton className="h-32" /></div>
        ) : (
          <div className="space-y-6 px-6 py-6">
            <div className="space-y-2 pb-4">
              <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Клиент · {client.industry}
              </div>
              <div className="text-[22px] font-bold leading-tight tracking-tight">{client.name}</div>
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                <span className="tnum">ИНН {client.inn}</span>
                <span className="text-slate-300">·</span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {STATUS_LABEL[client.status]}
                </span>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-x-7 gap-y-3.5 text-sm">
              <Field
                label="Аккаунт-менеджер"
                value={
                  am && (
                    <span className="flex items-center gap-1.5">
                      <UserAvatar user={am} size={20} />
                      <span>{am.fullName}</span>
                    </span>
                  )
                }
              />
              <Field label="Отрасль" value={client.industry} />
              <Field label="Открытых вакансий" value={<b className="tnum">{vacanciesData?.items.length ?? 0}</b>} />
              <Field label="Контактных лиц" value={client.contactsCount} />
            </div>

            <Section title="Контактные лица">
              <div className="flex flex-col divide-y">
                {(contacts ?? []).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-2.5"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                        {p.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}
                      </div>
                      <div>
                        <div className="text-[13px] font-medium">{p.name}</div>
                        <div className="text-[11.5px] text-muted-foreground">{p.role}</div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {p.email && <Button variant="ghost" size="icon"><Mail className="h-3.5 w-3.5" /></Button>}
                      {p.phone && <Button variant="ghost" size="icon"><Phone className="h-3.5 w-3.5" /></Button>}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section title={`Вакансии · ${vacanciesData?.items.length ?? 0}`}>
              <div className="space-y-1.5">
                {(vacanciesData?.items ?? []).map((v) => {
                  const st = vacancyStatuses.find((s) => s.id === v.status);
                  return (
                    <button
                      type="button"
                      key={v.id}
                      onClick={() => navigate({ to: '/vacancies/$id', params: { id: v.id } })}
                      className="flex w-full items-center justify-between rounded-md border bg-muted/30 px-3 py-2.5 text-left hover:bg-muted"
                    >
                      <div>
                        <div className="text-[13px] font-semibold">{v.title}</div>
                        <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                          {v.grade} · {v.format} · {v.candidatesCount} канд.
                        </div>
                      </div>
                      {st && (
                        <span className="inline-flex items-center gap-1.5 text-[11.5px]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: st.color }} />
                          {st.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
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
