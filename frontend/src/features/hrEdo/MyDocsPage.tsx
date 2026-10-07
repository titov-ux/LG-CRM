import { useQueryClient } from '@tanstack/react-query';
import { FileCheck2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { myDocsApi } from '@/api/hrEdo';
import { hrKeys, useMyHr } from './hooks';
import { EmployeeDocsView } from './SigningFlow';
import { EDO_STATUS } from './statuses';
import { cn } from '@/lib/utils';

/**
 * «Мои документы» — кадровые документы сотрудника-пользователя CRM.
 * Тот же сценарий, что на публичном портале, но без SMS-входа: сотрудник уже
 * авторизован в CRM. Код из SMS по-прежнему нужен для выпуска подписи и для
 * каждой подписи.
 */
export function MyDocsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useMyHr();
  const employee = data?.employee ?? null;

  return (
    <div className="flex-1 overflow-auto px-4 pb-8 pt-5 md:px-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
            <FileCheck2 className="h-4 w-4" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold tracking-tight">Мои документы</h1>
            <p className="text-[11.5px] text-muted-foreground">
              Кадровые документы на подпись: трудовой договор, приказы, заявления, ознакомление с ЛНА.
            </p>
          </div>
          {employee && (
            <span
              className={cn(
                'shrink-0 rounded px-2 py-0.5 text-[11px] font-medium',
                EDO_STATUS[employee.edoStatus].className,
              )}
            >
              {EDO_STATUS[employee.edoStatus].label}
            </span>
          )}
        </div>

        {isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
        {!isLoading && (isError || !employee) && (
          <Card>
            <CardContent className="p-4">
              <EmptyState
                icon={FileCheck2}
                title="Кадровых документов пока нет"
                description="Ваш аккаунт не привязан к карточке сотрудника в кадровом ЭДО. Если вы оформлены в компании — попросите бухгалтера привязать аккаунт."
              />
            </CardContent>
          </Card>
        )}
        {employee && (
          <EmployeeDocsView
            api={myDocsApi}
            employee={employee}
            queryKey={hrKeys.myDocs()}
            onEmployeeChanged={() => void qc.invalidateQueries({ queryKey: hrKeys.my() })}
          />
        )}
      </div>
    </div>
  );
}
