import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAudit } from './hooks';
import { useUsers } from '@/features/users/hooks';

export function AuditPage() {
  const { data } = useAudit();
  const { data: users } = useUsers();

  return (
    <div className="flex-1 overflow-auto px-6 pb-6">
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead>Когда</TableHead>
              <TableHead>Кто</TableHead>
              <TableHead>Сущность</TableHead>
              <TableHead>Поле</TableHead>
              <TableHead>Было</TableHead>
              <TableHead>Стало</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((row) => {
              const user = users?.find((u) => u.id === row.actorId);
              return (
                <TableRow key={row.id}>
                  <TableCell className="tnum text-xs text-muted-foreground">{new Date(row.createdAt).toLocaleString('ru-RU')}</TableCell>
                  <TableCell>{user?.fullName ?? '—'}</TableCell>
                  <TableCell>{row.entityType} · {row.entityId}</TableCell>
                  <TableCell className="font-mono text-xs">{row.field}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.before ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{row.after ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
