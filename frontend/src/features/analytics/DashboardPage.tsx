import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useFunnel, useRecruiterLoad, useSummary } from './hooks';
import { useClients } from '@/features/clients/hooks';
import { useUsers } from '@/features/users/hooks';
import { vacancyStatuses } from '@/mocks/db/vacancies';

export function DashboardPage() {
  const { data: summary, isLoading } = useSummary();
  const { data: funnel } = useFunnel();
  const { data: load } = useRecruiterLoad();
  const { data: users } = useUsers();
  const { data: clients } = useClients();

  const metrics = summary
    ? [
        { label: 'Открытых вакансий', value: summary.openVacancies, delta: summary.delta.openVacancies, accent: 'text-foreground' },
        { label: 'Активных кандидатов', value: summary.activeCandidates, delta: summary.delta.activeCandidates, accent: 'text-foreground' },
        { label: 'Закрыто в этом месяце', value: summary.closedThisMonth, delta: summary.delta.closedThisMonth, accent: 'text-emerald-600' },
        { label: 'Трудоустроено', value: summary.hiredThisMonth, delta: summary.delta.hiredThisMonth, accent: 'text-emerald-600' },
      ]
    : [];
  const maxFunnel = Math.max(1, ...((funnel ?? []).map((f) => f.count)));

  return (
    <div className="flex-1 space-y-3 overflow-auto px-6 pb-6 pt-5">
      <div className="grid grid-cols-4 gap-3">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          : metrics.map((m) => (
              <Card key={m.label}>
                <CardContent className="p-4">
                  <div className="mb-2 text-[11.5px] font-medium text-muted-foreground">{m.label}</div>
                  <div className="flex items-baseline gap-2">
                    <div className={`tnum text-[26px] font-bold leading-none tracking-tight ${m.accent}`}>{m.value}</div>
                    <div className="tnum text-xs font-semibold text-emerald-600">+{m.delta}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      <div className="grid grid-cols-[1.4fr_1fr] gap-3">
        <Card>
          <CardHeader><CardTitle>Воронка вакансий</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {vacancyStatuses.map((s) => {
              const count = funnel?.find((f) => f.status === s.id)?.count ?? 0;
              return (
                <div key={s.id} className="grid grid-cols-[180px_1fr_28px] items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5 text-slate-600">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full transition-all" style={{ background: s.color, width: `${(count / maxFunnel) * 100}%` }} />
                  </div>
                  <div className="tnum text-right font-semibold">{count}</div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Нагрузка рекрутеров</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(users ?? [])
              .filter((u) => u.role === 'recruiter')
              .map((r) => {
                const count = load?.find((l) => l.recruiterId === r.id)?.activeCount ?? 0;
                const pct = Math.min(count / 6, 1);
                return (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <UserAvatar user={r} size={26} />
                    <div className="flex-1">
                      <div className="mb-1 flex justify-between">
                        <span className="text-[12.5px] font-medium">{r.fullName}</span>
                        <span className="tnum text-xs font-semibold text-muted-foreground">{count}</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full transition-all" style={{ background: r.color, width: `${pct * 100}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Топ-клиенты по вакансиям</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {(clients?.items ?? []).slice(0, 5).map((c, i) => (
            <div key={c.id} className="grid grid-cols-[24px_1fr_100px_80px] items-center gap-3 py-2 text-[13px]">
              <div className="tnum text-xs font-semibold text-muted-foreground">{i + 1}</div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs text-muted-foreground">{c.industry}</div>
              <div className="tnum text-right font-bold">{c.vacanciesCount}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
