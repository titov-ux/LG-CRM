import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown, FileDown, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from '@/components/forms/MoneyInput';
import { cn } from '@/lib/utils';
import type { Candidate, User, Vacancy } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { useCandidatesList, useUsersList, useVacanciesList } from '@/features/calendar/pickers';
import { useClients } from '@/features/clients/hooks';
import { buildOfferHtml, downloadOfferPdf } from './generateOfferPdf';
import {
  DEFAULT_INTRO,
  DEFAULT_INTRO_SERVICES,
  emptyOffer,
  offerNumberForDate,
  type OfferModel,
} from './offerModel';

const OFFER_GRADES = ['Lead', 'Senior', 'Middle+', 'Middle', 'Junior'] as const;
const OFFER_EMPLOYMENTS = ['ТК РФ', 'ИП', 'СМЗ'] as const;
const OFFER_WORK_FORMATS = ['Удаленно', 'В офисе', 'Гибрид'] as const;

/** WorkFormat вакансии → значение формата в оффере. */
const WORK_FORMAT_FROM_VACANCY: Record<string, string> = {
  'Удалённо': 'Удаленно',
  Офис: 'В офисе',
  Гибрид: 'Гибрид',
};

type PickOption = {
  value: string;
  label: string;
  keywords?: string;
  hint?: string;
};

/** Комбобокс с поиском — тот же паттерн, что в формах календаря и скрининга. */
function SearchablePick({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyText = 'Ничего не найдено',
  loading = false,
}: {
  value: string;
  onChange: (value: string) => void;
  options: PickOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyText?: string;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
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
            <CommandGroup>
              {options.map((o) => (
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
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Страница «Офферы» (раздел «Прочее»).
 *
 * Выбираем кандидата и вакансию (проект) — форма предзаполняется, все поля
 * можно поправить руками, справа живой предпросмотр. Кнопка скачивает PDF
 * через серверный рендер (POST /files/render-pdf), как у резюме.
 * Ничего не сохраняем: оффер — одноразовый документ.
 */
export function OffersPage() {
  const user = useAuthStore((s) => s.user);
  const { data: candidates = [], isLoading: candidatesLoading } = useCandidatesList();
  const { data: vacancies = [], isLoading: vacanciesLoading } = useVacanciesList();
  const { data: users = [], isLoading: usersLoading } = useUsersList();
  const { data: clientsPage } = useClients({ pageSize: 200 });

  const [candidateId, setCandidateId] = useState('');
  const [vacancyId, setVacancyId] = useState('');
  const [offer, setOffer] = useState<OfferModel>(() => emptyOffer());
  const [signerId, setSignerId] = useState('');
  const [downloading, setDownloading] = useState(false);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clientsPage?.items ?? []) map.set(c.id, c.name);
    return map;
  }, [clientsPage]);

  const patch = (part: Partial<OfferModel>) => setOffer((prev) => ({ ...prev, ...part }));

  const addExtra = () =>
    setOffer((prev) => ({ ...prev, extras: [...prev.extras, { label: '', value: '' }] }));
  const removeExtra = (index: number) =>
    setOffer((prev) => ({ ...prev, extras: prev.extras.filter((_, i) => i !== index) }));
  const updateExtra = (index: number, part: Partial<OfferModel['extras'][number]>) =>
    setOffer((prev) => ({
      ...prev,
      extras: prev.extras.map((x, i) => (i === index ? { ...x, ...part } : x)),
    }));

  const candidateOptions: PickOption[] = useMemo(
    () =>
      candidates.map((c: Candidate) => ({
        value: c.id,
        label: c.fullName,
        keywords: c.role,
        hint: c.role,
      })),
    [candidates],
  );

  const vacancyOptions: PickOption[] = useMemo(
    () =>
      vacancies.map((v: Vacancy) => ({
        value: v.id,
        label: v.title,
        keywords: `${v.project ?? ''} ${clientNameById.get(v.clientId) ?? ''}`,
        hint: clientNameById.get(v.clientId),
      })),
    [vacancies, clientNameById],
  );

  const signerOptions: PickOption[] = useMemo(
    () =>
      users
        .filter((u: User) => u.isActive !== false)
        .map((u: User) => ({ value: u.id, label: u.fullName, keywords: u.email })),
    [users],
  );

  const applyCandidate = (id: string) => {
    setCandidateId(id);
    const c = candidates.find((x: Candidate) => x.id === id);
    if (!c) return;
    patch({
      fullName: c.fullName,
      firstName: c.fullName.trim().split(/\s+/)[0] ?? '',
      salaryNet: c.rateMonth || undefined,
      grade: c.grade,
    });
    applyEmployment(c.employmentType);
  };

  const applyVacancy = (id: string) => {
    setVacancyId(id);
    const v = vacancies.find((x: Vacancy) => x.id === id);
    if (!v) return;
    const clientName = clientNameById.get(v.clientId);
    const projectParts = [clientName, v.project].filter(Boolean);
    patch({
      position: v.title,
      workFormat: WORK_FORMAT_FROM_VACANCY[v.format] ?? v.format,
      project: projectParts.join(', '),
    });
  };

  /**
   * ИП и СМЗ - не трудовые отношения: документ становится «Приглашением
   * к исполнению услуг», а трудовые поля (испытательный срок, отпуск по ТК)
   * при переключении вычищаются из дефолтов.
   */
  const applyEmployment = (value: string) => {
    const services = value === 'ИП' || value === 'СМЗ';
    setOffer((prev) => ({
      ...prev,
      employment: value,
      probation: services ? '' : prev.probation || '3 месяца',
      // Вступление меняем только если пользователь его не редактировал.
      intro:
        services && prev.intro === DEFAULT_INTRO
          ? DEFAULT_INTRO_SERVICES
          : !services && prev.intro === DEFAULT_INTRO_SERVICES
            ? DEFAULT_INTRO
            : prev.intro,
      benefits:
        services && prev.benefits.join('\n') === 'Отпуск 28 календарных дней'
          ? []
          : !services && prev.benefits.length === 0
            ? ['Отпуск 28 календарных дней']
            : prev.benefits,
    }));
  };

  // Подписант: по умолчанию — текущий пользователь, пока не выбран другой.
  const effectiveSignerId = signerId || user?.id || '';
  const effectiveSignerName =
    offer.signerName || users.find((u: User) => u.id === effectiveSignerId)?.fullName || (user?.fullName ?? '');

  const applySigner = (id: string) => {
    setSignerId(id);
    const u = users.find((x: User) => x.id === id);
    if (u) patch({ signerName: u.fullName });
  };
  const model: OfferModel = useMemo(
    () => ({ ...offer, signerName: effectiveSignerName }),
    [offer, effectiveSignerName],
  );

  const previewHtml = useMemo(() => buildOfferHtml(model), [model]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadOfferPdf(model);
    } catch (error) {
      console.error('offer pdf failed', error);
      toast.error('Не удалось сгенерировать PDF', {
        description: 'Проверьте соединение и попробуйте еще раз.',
      });
    } finally {
      setDownloading(false);
    }
  };

  const canDownload = Boolean(model.fullName && model.position && model.salaryNet);

  return (
    <div className="flex-1 space-y-4 overflow-auto px-4 pb-8 pt-5 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Офферы</h1>
          <p className="text-sm text-muted-foreground">
            Предложение о работе (для ИП и СМЗ - приглашение к исполнению услуг): выберите кандидата и вакансию, поправьте
            условия и скачайте PDF.
          </p>
        </div>
        <Button onClick={handleDownload} disabled={!canDownload || downloading}>
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="mr-2 h-4 w-4" />
          )}
          Скачать PDF
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Кандидат и вакансия</CardTitle>
              <CardDescription>
                Поля ниже предзаполняются из карточек, но их можно править вручную.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field label="Кандидат">
                <SearchablePick
                  value={candidateId}
                  onChange={applyCandidate}
                  options={candidateOptions}
                  placeholder="Выберите кандидата"
                  searchPlaceholder="Поиск по имени или роли…"
                  loading={candidatesLoading}
                />
              </Field>
              <Field label="Вакансия (проект)">
                <SearchablePick
                  value={vacancyId}
                  onChange={applyVacancy}
                  options={vacancyOptions}
                  placeholder="Выберите вакансию"
                  searchPlaceholder="Поиск по вакансии, проекту, клиенту…"
                  loading={vacanciesLoading}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Имя (обращение)">
                  <Input
                    value={offer.firstName}
                    onChange={(e) => patch({ firstName: e.target.value })}
                    placeholder="Иван"
                  />
                </Field>
                <Field label="ФИО кандидата">
                  <Input
                    value={offer.fullName}
                    onChange={(e) => patch({ fullName: e.target.value })}
                    placeholder="Иван Иванов"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Условия</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field label="Должность">
                <Input
                  value={offer.position}
                  onChange={(e) => patch({ position: e.target.value })}
                  placeholder="Руководитель отдела продаж"
                />
              </Field>
              <Field label="Проект (опционально, строка в условиях)">
                <Input
                  value={offer.project}
                  onChange={(e) => patch({ project: e.target.value })}
                  placeholder="Клиент, проект"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Грейд">
                  <Select value={offer.grade} onValueChange={(value) => patch({ grade: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите грейд" />
                    </SelectTrigger>
                    <SelectContent>
                      {OFFER_GRADES.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Формат работы">
                  <Select
                    value={offer.workFormat}
                    onValueChange={(value) => patch({ workFormat: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите формат" />
                    </SelectTrigger>
                    <SelectContent>
                      {OFFER_WORK_FORMATS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Оформление">
                  <Select value={offer.employment} onValueChange={applyEmployment}>
                    <SelectTrigger>
                      <SelectValue placeholder="Выберите оформление" />
                    </SelectTrigger>
                    <SelectContent>
                      {OFFER_EMPLOYMENTS.map((e) => (
                        <SelectItem key={e} value={e}>
                          {e}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Испытательный срок">
                  <Input
                    value={offer.probation}
                    onChange={(e) => patch({ probation: e.target.value })}
                    placeholder="3 месяца"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата выхода">
                  <Input
                    type="date"
                    value={offer.startDate}
                    onChange={(e) => patch({ startDate: e.target.value })}
                  />
                </Field>
                <Field label="Оффер действителен до">
                  <Input
                    type="date"
                    value={offer.validUntil}
                    onChange={(e) => patch({ validUntil: e.target.value })}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Вознаграждение</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Оклад на руки, ₽/мес">
                  <MoneyInput
                    value={offer.salaryNet}
                    onChange={(value) => patch({ salaryNet: value })}
                    placeholder="100 000"
                  />
                </Field>
                <Field label="После испытательного, ₽/мес">
                  <MoneyInput
                    value={offer.salaryAfterProbation}
                    onChange={(value) => patch({ salaryAfterProbation: value })}
                    placeholder="110 000"
                  />
                </Field>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Дополнительные строки (название + значение, пустые не печатаются)
                </Label>
                <div className="space-y-2">
                  {offer.extras.map((extra, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1.6fr_auto] items-start gap-2">
                      <Input
                        value={extra.label}
                        onChange={(e) => updateExtra(i, { label: e.target.value })}
                        placeholder="Премия"
                      />
                      <Textarea
                        value={extra.value}
                        onChange={(e) => updateExtra(i, { value: e.target.value })}
                        rows={1}
                        placeholder="% от оборота по new business…"
                        className="min-h-9"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0 text-muted-foreground"
                        onClick={() => removeExtra(i)}
                        aria-label="Удалить строку"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addExtra}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Добавить строку
                </Button>
              </div>
              <Field label="Соцпакет (по пункту на строку)">
                <Textarea
                  value={offer.benefits.join('\n')}
                  onChange={(e) => patch({ benefits: e.target.value.split('\n') })}
                  rows={3}
                  placeholder={'Отпуск 28 календарных дней\nДМС после испытательного срока'}
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Документ и подпись</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Дата оффера">
                  <Input
                    type="date"
                    value={offer.date}
                    onChange={(e) =>
                      patch({ date: e.target.value, offerNumber: offerNumberForDate(e.target.value) })
                    }
                  />
                </Field>
                <Field label="Город">
                  <Input value={offer.city} onChange={(e) => patch({ city: e.target.value })} />
                </Field>
              </div>
              <Field label="Вступительный абзац">
                <Textarea
                  value={offer.intro}
                  onChange={(e) => patch({ intro: e.target.value })}
                  rows={3}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Подписант">
                  <SearchablePick
                    value={effectiveSignerId}
                    onChange={applySigner}
                    options={signerOptions}
                    placeholder="Выберите сотрудника"
                    searchPlaceholder="Поиск по имени или email…"
                    loading={usersLoading}
                  />
                </Field>
                <Field label="Роль подписанта">
                  <Input
                    value={offer.signerRole}
                    onChange={(e) => patch({ signerRole: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Email для связи">
                  <Input
                    value={offer.contactEmail}
                    onChange={(e) => patch({ contactEmail: e.target.value })}
                  />
                </Field>
                <Field label="Телефон">
                  <Input
                    value={offer.contactPhone}
                    onChange={(e) => patch({ contactPhone: e.target.value })}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="hidden xl:block">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Предпросмотр</CardTitle>
            <CardDescription>Так будет выглядеть PDF (A4).</CardDescription>
          </CardHeader>
          <CardContent>
            <iframe
              title="Предпросмотр оффера"
              srcDoc={previewHtml}
              sandbox=""
              className="h-[1100px] w-full rounded-md border bg-white"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
