import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { Vacancy } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { useCandidatesList, useVacanciesList } from '@/features/calendar/pickers';
import { useCreateScreening } from './hooks';

const NONE = '__none__';

type PickOption = {
  value: string;
  label: string;
  keywords?: string;
  /** Подпись справа, напр. «мой» / «кандидат». */
  hint?: string;
  /** Заголовок группы в списке; опции с одним group идут подряд. */
  group?: string;
};

function SearchablePick({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText = 'Ничего не найдено',
  disabled,
  loading = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText?: string;
  disabled?: boolean;
  /** Справочник ещё грузится — «Ничего не найдено» тут вводит в заблуждение. */
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, PickOption[]>();
    for (const o of options) {
      const key = o.group ?? '';
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(o);
    }
    return order.map((key) => ({ heading: key || undefined, items: map.get(key)! }));
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="h-9 w-full justify-between font-normal"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{loading ? 'Загружаем справочник…' : emptyText}</CommandEmpty>
            {groups.map(({ heading, items }) => (
              <CommandGroup key={heading ?? '__default'} heading={heading}>
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={`${o.label} ${o.keywords ?? ''} ${o.hint ?? ''} ${o.value}`}
                    onSelect={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4 shrink-0',
                        value === o.value ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && (
                      <span className="ml-2 shrink-0 text-[10px] text-muted-foreground">
                        {o.hint}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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
  const meId = useAuthStore((s) => s.user?.id);
  const create = useCreateScreening();
  const { data: candidates, isFetching: candidatesFetching } = useCandidatesList(open);
  const { data: vacancies, isFetching: vacanciesFetching } = useVacanciesList(open);
  // Именно isFetching, а не `!data`: при упавшем запросе данных тоже нет, и
  // «Загружаем справочник…» висело бы вечно вместо «Ничего не найдено».
  const candidatesLoading = candidatesFetching && !candidates;
  const vacanciesLoading = vacanciesFetching && !vacancies;

  const [candidateId, setCandidateId] = useState('');
  const [vacancyId, setVacancyId] = useState(NONE);
  const [telemostUrl, setTelemostUrl] = useState('');
  /**
   * Автоподстановка вакансии срабатывает один раз за открытие. Раньше эффект
   * зависел от `vacancyId` и возвращал первую прикреплённую вакансию сразу
   * после того, как пользователь выбрал «Без вакансии».
   */
  const autoPickedRef = useRef(false);

  // При каждом открытии — чистая форма (иначе остаются поля с прошлого раза).
  useEffect(() => {
    if (!open) return;
    autoPickedRef.current = false;
    setCandidateId(defaultCandidateId ?? '');
    setVacancyId(defaultVacancyId ?? NONE);
    setTelemostUrl('');
  }, [open, defaultCandidateId, defaultVacancyId]);

  // С карточки кандидата: если вакансию не передали — берём первую прикреплённую.
  useEffect(() => {
    if (!open || !defaultCandidateId || defaultVacancyId) return;
    if (autoPickedRef.current) return;
    const cand = (candidates ?? []).find((c) => c.id === defaultCandidateId);
    const linked = cand?.vacancyIds ?? [];
    if (linked.length === 0) return;
    autoPickedRef.current = true;
    setVacancyId(linked[0]);
  }, [open, defaultCandidateId, defaultVacancyId, candidates]);

  const selectedCandidate = useMemo(
    () => (candidates ?? []).find((c) => c.id === candidateId),
    [candidates, candidateId],
  );
  const linkedVacancyIds = selectedCandidate?.vacancyIds ?? [];

  const candidateOptions = useMemo<PickOption[]>(() => {
    const list = [...(candidates ?? [])];
    list.sort((a, b) => {
      const aMine = meId && a.recruiterId === meId ? 0 : 1;
      const bMine = meId && b.recruiterId === meId ? 0 : 1;
      if (aMine !== bMine) return aMine - bMine;
      return a.fullName.localeCompare(b.fullName, 'ru');
    });
    return list.map((c) => ({
      value: c.id,
      label: c.role ? `${c.fullName} · ${c.role}` : c.fullName,
      keywords: [c.fullName, c.role, c.email, c.phone].filter(Boolean).join(' '),
      hint: meId && c.recruiterId === meId ? 'мой' : undefined,
    }));
  }, [candidates, meId]);

  const vacancyOptions = useMemo<PickOption[]>(() => {
    const linked = new Set(linkedVacancyIds);
    /** Прикреплённая к кандидату → где я ответственный → остальные. */
    const rank = (v: Vacancy) => {
      if (linked.has(v.id)) return 0;
      if (meId && (v.recruiterIds?.includes(meId) || v.accountManagerId === meId)) {
        return 1;
      }
      return 2;
    };
    const list = [...(vacancies ?? [])];
    list.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) {
        return linkedVacancyIds.indexOf(a.id) - linkedVacancyIds.indexOf(b.id);
      }
      return a.title.localeCompare(b.title, 'ru');
    });

    return [
      { value: NONE, label: 'Без вакансии' },
      ...list.map((v) => {
        const r = rank(v);
        return {
          value: v.id,
          label: v.title,
          keywords: [v.project, ...(v.stack ?? [])].filter(Boolean).join(' '),
          hint: r === 0 ? 'кандидат' : r === 1 ? 'моя' : undefined,
          group: r === 0 ? 'У кандидата' : r === 1 ? 'Мои' : 'Остальные',
        };
      }),
    ];
  }, [vacancies, linkedVacancyIds, meId]);

  const pickCandidate = (id: string) => {
    setCandidateId(id);
    const cand = (candidates ?? []).find((c) => c.id === id);
    const linked = cand?.vacancyIds ?? [];
    if (linked.length === 0) return;
    if (vacancyId !== NONE && linked.includes(vacancyId)) return;
    setVacancyId(linked[0]);
  };

  const trimmedUrl = telemostUrl.trim();
  const urlInvalid = trimmedUrl.length > 0 && !/^https?:\/\/\S+$/i.test(trimmedUrl);

  const submit = async () => {
    if (!candidateId) return;
    if (urlInvalid) {
      toast.error('Ссылка на Телемост должна начинаться с http:// или https://');
      return;
    }
    try {
      const session = await create.mutateAsync({
        candidateId,
        vacancyId: vacancyId === NONE ? undefined : vacancyId,
        telemostUrl: trimmedUrl || undefined,
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
            <SearchablePick
              value={candidateId}
              onChange={pickCandidate}
              options={candidateOptions}
              placeholder="Выберите кандидата"
              searchPlaceholder="Поиск кандидата…"
              disabled={!!defaultCandidateId}
              loading={candidatesLoading}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Вакансия</Label>
            <SearchablePick
              value={vacancyId}
              onChange={setVacancyId}
              options={vacancyOptions}
              placeholder="Без вакансии"
              searchPlaceholder="Поиск вакансии…"
              loading={vacanciesLoading}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Ссылка на встречу в Телемосте</Label>
            <Input
              placeholder="https://telemost.yandex.ru/j/…"
              value={telemostUrl}
              aria-invalid={urlInvalid}
              className={cn(urlInvalid && 'border-destructive focus-visible:ring-destructive')}
              onChange={(e) => setTelemostUrl(e.target.value)}
            />
            {urlInvalid && (
              <p className="text-[11px] text-destructive">
                Нужна полная ссылка, например https://telemost.yandex.ru/j/12345
              </p>
            )}
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
          <Button onClick={submit} disabled={!candidateId || urlInvalid || create.isPending}>
            {create.isPending ? 'Готовим план…' : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
