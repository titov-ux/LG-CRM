import { useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronsUpDown, FileDown, Loader2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { MoneyInput } from '@/components/forms/MoneyInput';
import { cn } from '@/lib/utils';
import type { Candidate, Vacancy } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { useCandidatesList, useVacanciesList } from '@/features/calendar/pickers';
import { useClients } from '@/features/clients/hooks';
import { buildOfferHtml, downloadOfferPdf } from './generateOfferPdf';
import { emptyOffer, offerNumberForDate, type OfferModel } from './offerModel';

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
  const { data: clientsPage } = useClients({ pageSize: 200 });

  const [candidateId, setCandidateId] = useState('');
  const [vacancyId, setVacancyId] = useState('');
  const [offer, setOffer] = useState<OfferModel>(() => emptyOffer());
  const [signerTouched, setSignerTouched] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clientsPage?.items ?? []) map.set(c.id, c.name);
    return map;
  }, [clientsPage]);

  const patch = (part: Partial<OfferModel>) => setOffer((prev) => ({ ...prev, ...part }));

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

  const applyCandidate = (id: string) => {
    setCandidateId(id);
    const c = candidates.find((x: Candidate) => x.id === id);
    if (!c) return;
    patch({
      fullName: c.fullName,
      firstName: c.fullName.trim().split(/\s+/)[0] ?? '',
      salaryNet: c.rateMonth || undefined,
    });
  };

  const applyVacancy = (id: string) => {
    setVacancyId(id);
    const v = vacancies.find((x: Vacancy) => x.id === id);
    if (!v) return;
    const clientName = clientNameById.get(v.clientId);
    const projectParts = [clientName, v.project].filter(Boolean);
    patch({
      position: v.title,
      workFormat: v.format,
      project: projectParts.join(', '),
    });
  };

  // Подписант: предзаполняем текущим пользователем, пока поле не трогали.
  const effectiveSignerName = signerTouched || offer.signerName ? offer.signerName : (user?.fullName ?? '');
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
        description: 'Проверьте соединение и попробуйте ещё раз.',
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
            Предложение о работе в фирменном стиле — выберите кандидата и вакансию, поправьте
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
                    placeholder="Рафаэль"
                  />
                </Field>
                <Field label="ФИО кандидата">
                  <Input
                    value={offer.fullName}
                    onChange={(e) => patch({ fullName: e.target.value })}
                    placeholder="Рафаэль Саркисян"
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
                <Field label="Подчинение">
                  <Input
                    value={offer.reportsTo}
                    onChange={(e) => patch({ reportsTo: e.target.value })}
                  />
                </Field>
                <Field label="Формат работы">
                  <Input
                    value={offer.workFormat}
                    onChange={(e) => patch({ workFormat: e.target.value })}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Оформление">
                  <Input
                    value={offer.employment}
                    onChange={(e) => patch({ employment: e.target.value })}
                  />
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
                    placeholder="300 000"
                  />
                </Field>
                <Field label="После испытательного, ₽/мес">
                  <MoneyInput
                    value={offer.salaryAfterProbation}
                    onChange={(value) => patch({ salaryAfterProbation: value })}
                    placeholder="330 000"
                  />
                </Field>
              </div>
              <Field label="Премия (свободный текст, опционально)">
                <Textarea
                  value={offer.bonus}
                  onChange={(e) => patch({ bonus: e.target.value })}
                  rows={2}
                  placeholder="% от оборота по new business…"
                />
              </Field>
              <Field label="Соцпакет — по пункту на строку">
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
                <Field label="Номер (из даты, можно править)">
                  <Input
                    value={offer.offerNumber}
                    onChange={(e) => patch({ offerNumber: e.target.value })}
                  />
                </Field>
              </div>
              <Field label="Город">
                <Input value={offer.city} onChange={(e) => patch({ city: e.target.value })} />
              </Field>
              <Field label="Вступительный абзац">
                <Textarea
                  value={offer.intro}
                  onChange={(e) => patch({ intro: e.target.value })}
                  rows={3}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Подписант">
                  <Input
                    value={effectiveSignerName}
                    onChange={(e) => {
                      setSignerTouched(true);
                      patch({ signerName: e.target.value });
                    }}
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
