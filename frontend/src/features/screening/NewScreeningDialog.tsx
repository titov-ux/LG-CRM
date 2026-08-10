import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
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
import { Textarea } from '@/components/ui/textarea';
import { useCandidatesList, useVacanciesList } from '@/features/calendar/pickers';
import { useCreateScreening } from './hooks';

const NONE = '__none__';

/**
 * Создание сессии AI-скрининга: кандидат (обязательно), вакансия (опционально),
 * ссылка на Телемост и стартовые вопросы (по одному в строке — на Этапе 3 их
 * будет генерировать AI по резюме и вакансии).
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
  const [questionsRaw, setQuestionsRaw] = useState('');

  const questions = useMemo(
    () =>
      questionsRaw
        .split('\n')
        .map((q) => q.trim())
        .filter(Boolean),
    [questionsRaw],
  );

  const submit = async () => {
    if (!candidateId) return;
    try {
      const session = await create.mutateAsync({
        candidateId,
        vacancyId: vacancyId === NONE ? undefined : vacancyId,
        telemostUrl: telemostUrl.trim() || undefined,
        questions,
      });
      onOpenChange(false);
      navigate({ to: '/video-interviews/$id', params: { id: session.id } });
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
          <div className="space-y-1.5">
            <Label>Стартовые вопросы (по одному в строке)</Label>
            <Textarea
              rows={4}
              placeholder={'Расскажите о вашем опыте…\nПочему ищете новую работу?'}
              value={questionsRaw}
              onChange={(e) => setQuestionsRaw(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Скоро вопросы будет предлагать AI — по резюме кандидата и вакансии.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={!candidateId || create.isPending}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
