/**
 * «Оформить сотрудника» в карточке кандидата в статусе `hired`: создаёт
 * карточку в реестре КЭДО (ФИО, контакты, оформление) и ведёт в
 * «Кадровые документы». Видна только с правом hr_edo:manage.
 */
import { useNavigate } from '@tanstack/react-router';
import { Loader2, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/permissions';
import { useCreateFromCandidate } from './hooks';
import { apiErrorCode, apiErrorMessage } from './statuses';

export function HireEmployeeButton({ candidateId, status }: { candidateId: string; status: string }) {
  const canManage = useCan('hr_edo:manage');
  const create = useCreateFromCandidate();
  const navigate = useNavigate();
  if (!canManage || status !== 'hired') return null;

  const handle = async () => {
    try {
      const emp = await create.mutateAsync(candidateId);
      toast.success(`${emp.fullName} добавлен(а) в кадровый ЭДО`, {
        action: { label: 'Открыть', onClick: () => void navigate({ to: '/hr-docs' }) },
      });
    } catch (e) {
      if ((await apiErrorCode(e)) === 'employee_exists') {
        toast.info('Сотрудник уже оформлен', {
          action: { label: 'Кадровые документы', onClick: () => void navigate({ to: '/hr-docs' }) },
        });
        return;
      }
      toast.error(await apiErrorMessage(e, 'Не удалось оформить сотрудника'));
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="ml-1 h-8 gap-1.5 px-2 text-[12px]"
      onClick={() => void handle()}
      disabled={create.isPending}
      title="Завести карточку в реестре кадрового ЭДО"
    >
      {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
      Оформить сотрудника
    </Button>
  );
}
