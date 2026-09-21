import { useState } from 'react';
import { Camera, CameraOff, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DateField } from '@/components/forms/DateField';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LoginSnapshotStatus } from '@/api/loginSnapshots';
import { useUsers } from '@/features/users/hooks';
import { useLoginSnapshots } from './hooks';

const ALL_USERS = '__all__';

const STATUS_LABEL: Record<LoginSnapshotStatus, string> = {
  ok: 'Снимок получен',
  denied: 'Камера отклонена',
  no_camera: 'Нет камеры',
  error: 'Ошибка',
};

const STATUS_VARIANT: Record<
  LoginSnapshotStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  ok: 'default',
  denied: 'secondary',
  no_camera: 'secondary',
  error: 'destructive',
};

function formatDateTimeRu(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function LoginSnapshotsPage() {
  const [userId, setUserId] = useState<string>(ALL_USERS);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: users } = useUsers();
  const { data, isLoading, isError } = useLoginSnapshots({
    userId: userId === ALL_USERS ? undefined : userId,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Camera className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold tracking-tight">Снимки входов</h1>
      </div>
      <p className="max-w-2xl text-[13px] leading-snug text-muted-foreground">
        Кадры веб-камеры, снятые при входе сотрудников в систему. Сбор ведётся в
        целях безопасности с уведомлением сотрудников и на основании письменных
        согласий. Ссылки на изображения временные и обновляются при перезагрузке.
      </p>

      <Card className="flex flex-wrap items-end gap-3 p-3">
        <div className="min-w-52">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            Сотрудник
          </div>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Все сотрудники" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_USERS}>Все сотрудники</SelectItem>
              {users?.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            С даты
          </div>
          <DateField value={dateFrom} onChange={setDateFrom} className="h-8" />
        </div>
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            По дату
          </div>
          <DateField value={dateTo} onChange={setDateTo} className="h-8" />
        </div>
      </Card>

      {isError && (
        <Card className="flex items-center gap-2 p-4 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" />
          Не удалось загрузить журнал снимков.
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3] w-full rounded-lg" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.map((snap) => (
            <Card key={snap.id} className="overflow-hidden">
              <div className="relative aspect-[4/3] w-full bg-slate-100">
                {snap.imageUrl ? (
                  <img
                    src={snap.imageUrl}
                    alt={`Снимок входа ${snap.userFullName ?? ''}`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <CameraOff className="h-6 w-6" />
                    <span className="text-[11px]">{STATUS_LABEL[snap.status]}</span>
                  </div>
                )}
                <div className="absolute right-1.5 top-1.5">
                  <Badge variant={STATUS_VARIANT[snap.status]} className="text-[10px]">
                    {STATUS_LABEL[snap.status]}
                  </Badge>
                </div>
              </div>
              <div className="space-y-0.5 p-2">
                <div className="truncate text-[13px] font-medium">
                  {snap.userFullName ?? '— удалён —'}
                </div>
                {snap.userEmail && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {snap.userEmail}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  {formatDateTimeRu(snap.createdAt)}
                </div>
                {snap.ip && (
                  <div className="truncate text-[10.5px] text-muted-foreground/80">
                    IP: {snap.ip}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Снимков за выбранный период нет.
        </Card>
      )}
    </div>
  );
}
