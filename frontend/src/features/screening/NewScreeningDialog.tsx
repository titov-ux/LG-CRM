import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCandidatesList, useVacanciesList } from '@/features/calendar/pickers';
import { useCreateScreening } from './hooks';

const NONE = '__none__';

/**
 * Создание сессии AI-скрининга. План вопросов генерирует AI по резюме
 * и вакансии на экране подготовки (Этап 3).
 */
export function NewScreeningDialog({
  open,
  onOpenChange,
  defaultCandidateId,
  defaultVacancyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCandidateId?: string;
  defaultVacancyId?: string;
}) {
  const navigate = useNavigate();
  const create = useCreateScreening();
  const { data: candidates } = useCandidatesList(open);
  const { data: vacancies } = useVacanciesList(open);

  const [candidateId, setCandidateId] = useState(defaultCandidateId ?? '');
  const [vacancyId, setVacancyId] = useState(defaultVacancyId ?? NONE);
  const [telemostUrl, setTelemostUrl] = useState('');

  const submit = async () => {
    if (!candidateId) return;
    try {
      const session = await create.mutateAsync({
        candidateId,
        vacancyId: vacancyId === NONE ? undefined : vacancyId,
        telemostUrl: telemostUrl.trim() || undefined,
        generateQuestions: true,
      });
      onOpenChange(false);
      navigate({ to: '/video-interviews/$id', params: { id: session.id } });
      if (session.questions.length === 0) {
        toast.message('Сессия создана', {
          description: 'AI не вернул вопросы — сгенерируйте их на экране подготовки.',
        });
      }
    } catch {
      toast.error('Не удалось создать сессию скрининга');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Новый AI-скрининг</DialogTitle>
        </DialogHeader>
        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label>Кандидат *</Label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите кандидата" />
              </SelectTrigger>
              <SelectContent>
                {(candidates ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Вакансия</Label>
            <Select value={vacancyId} onValueChange={setVacancyId}>
              <SelectTrigger>
                <SelectValue placeholder="Без вакансии" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Без вакансии</SelectItem>
                {(vacancies ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Ссылка на встречу в Телемосте</Label>
            <Input
              placeholder="https://telemost.yandex.ru/j/…"
              value={telemostUrl}
              onChange={(e) => setTelemostUrl(e.target.value)}
            />
          </div>
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
            <Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-amber-600" />
            План вопросов AI составит по резюме кандидата
            {vacancyId !== NONE ? ' и вакансии' : ''}. На экране подготовки их можно
            править и перегенерировать.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!candidateId || create.isPending}>
            {create.isPending ? 'Готовим план…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
