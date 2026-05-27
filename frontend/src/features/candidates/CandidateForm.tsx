import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { HTTPError, TimeoutError } from 'ky';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  detectResumeFormat,
  extractResumeText,
  parsedToFormValues,
  RESUME_ACCEPT,
  RESUME_FORMATS_LABEL,
} from './resumeImport';
import { candidatesApi } from '@/api/candidates';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUsers } from '@/features/users/hooks';
import { EngagementTypeField } from '@/components/forms/EngagementTypeField';
import { DateField } from '@/components/forms/DateField';
import type {
  EmploymentType,
  EngagementType,
  Grade,
  LanguageLevel,
  WorkFormat,
} from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { formatMoneyRub } from '@/lib/utils';

const GRADES: Grade[] = ['Junior', 'Middle', 'Senior', 'Lead'];
const FORMATS: WorkFormat[] = ['Удалённо', 'Гибрид', 'Офис'];
const EMPLOYMENT_TYPES: EmploymentType[] = ['ИП', 'СМЗ', 'ТК РФ'];
const LANGUAGE_LEVELS: LanguageLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'родной'];

/**
 * Маленький локальный uid: useFieldArray требует стабильные id для строк,
 * но при сабмите мы их отбрасываем — серверу/моку id не нужны.
 */
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Делает первую букву каждого слова в ФИО заглавной — чтобы рекрутер не ловил
 * «иванов иван» при быстром вводе. Капитализируем после пробела и после дефиса
 * (для составных фамилий: «петров-водкин» → «Петров-Водкин»). Остальные буквы
 * не трогаем — рекрутер мог осознанно написать «де Фриз» или «МакЛейн».
 */
function capitalizeFullName(value: string): string {
  return value.replace(/(^|[\s\-])(\p{L})/gu, (_, sep: string, letter: string) =>
    sep + letter.toLocaleUpperCase('ru-RU'),
  );
}

/** Извлекает человекочитаемый текст ошибки из ApiError-конверта `{ code, message }`. */
async function extractAiErrorMessage(e: unknown): Promise<string> {
  // ky-овский таймаут — не HTTPError. До этого фикса попадал в общий fallback
  // и пользователь видел невнятное «Не удалось распознать резюме».
  if (e instanceof TimeoutError) {
    return (
      'Запрос к AI занял слишком много времени и был прерван. ' +
      'Попробуйте резюме покороче либо повторите попытку.'
    );
  }
  if (e instanceof HTTPError) {
    try {
      const body = (await e.response.clone().json()) as
        | { detail?: { code?: string; message?: string }; message?: string }
        | undefined;
      const detail = body?.detail;
      if (detail?.code === 'resume_too_long') {
        return (
          detail.message ??
          'Резюме слишком большое для AI-распознавания. Сократите текст или заполните карточку вручную.'
        );
      }
      if (detail?.code === 'ai_unavailable') {
        return (
          detail.message ??
          'Сервис AI-распознавания временно недоступен. Заполните карточку вручную.'
        );
      }
      if (detail?.message) return detail.message;
      if (body?.message) return body.message;
    } catch {
      // не JSON — fallthrough
    }
    if (e.response.status === 413) {
      return 'Резюме слишком большое для AI-распознавания. Сократите текст или заполните карточку вручную.';
    }
    if (e.response.status === 503) {
      return 'Сервис AI-распознавания временно недоступен. Заполните карточку вручную.';
    }
    if (e.response.status === 502) {
      return 'Не удалось распознать резюме. Попробуйте другой файл или заполните вручную.';
    }
  }
  return 'Не удалось распознать резюме. Попробуйте другой файл или заполните вручную.';
}

const skillCategorySchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Название категории обязательно'),
  // Внутри формы храним строкой, парсим в массив на сабмите.
  itemsText: z.string().default(''),
});

const experienceSchema = z.object({
  id: z.string(),
  company: z.string().min(1, 'Компания обязательна'),
  position: z.string().min(1, 'Должность обязательна'),
  startMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Формат: ГГГГ-ММ'),
  endMonth: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Формат: ГГГГ-ММ')
    .or(z.literal('')),
  project: z.string().optional(),
  achievementsText: z.string().default(''),
  stackText: z.string().default(''),
});

const educationSchema = z.object({
  id: z.string(),
  degree: z.string().min(1, 'Например: Магистр'),
  institution: z.string().min(1, 'Вуз обязателен'),
  city: z.string().optional(),
  graduationYear: z.coerce.number().int().min(1950).max(2100),
  specialty: z.string().optional(),
});

const certificationSchema = z.object({
  id: z.string(),
  title: z.string().min(1, 'Название обязательно'),
  issuer: z.string().min(1, 'Организация обязательна'),
  period: z.string().optional(),
});

const languageSchema = z.object({
  language: z.string().min(1, 'Язык обязателен'),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'родной']),
});

const schema = z.object({
  fullName: z.string().min(2, 'Введите ФИО'),
  role: z.string().min(2, 'Укажите позицию'),
  engagementType: z.enum(['outstaff', 'agency'], {
    required_error: 'Выберите тип',
  }) as z.ZodType<EngagementType>,
  grade: z.enum(['Junior', 'Middle', 'Senior', 'Lead']),
  experienceYears: z.coerce.number().int().min(0).max(60),
  format: z.enum(['Удалённо', 'Гибрид', 'Офис']),
  rateMonth: z.coerce.number().nonnegative(),
  employmentType: z.enum(['ИП', 'СМЗ', 'ТК РФ']),
  recruiterId: z.string().min(1, 'Выберите рекрутера'),
  location: z.string().optional(),
  birthday: z.string().optional(),
  telegram: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Некорректный email').optional().or(z.literal('')),
  stack: z.string().optional(),
  summary: z.string().optional(),
  skillCategories: z.array(skillCategorySchema),
  experience: z.array(experienceSchema),
  education: z.array(educationSchema),
  certifications: z.array(certificationSchema),
  languages: z.array(languageSchema),
});

export type CandidateFormValues = z.infer<typeof schema>;

interface Props {
  defaultValues?: Partial<CandidateFormValues>;
  onSubmit: (values: CandidateFormValues) => void;
  isPending?: boolean;
  submitLabel?: string;
  /**
   * Показывать ли кнопку «Распознать из файла» в шапке формы. По умолчанию
   * true — нужна при быстром добавлении кандидата. В режиме редактирования
   * существующего кандидата (когда поля уже заполнены) её отключают.
   */
  enableResumeImport?: boolean;
}

export function CandidateForm({
  defaultValues,
  onSubmit,
  isPending,
  submitLabel = 'Сохранить',
  enableResumeImport = true,
}: Props) {
  const { data: users } = useUsers();
  const currentUser = useAuthStore((s) => s.user);
  // В качестве «ответственных рекрутеров» можно назначать и админов — они тоже ведут кандидатов.
  const recruiters = useMemo(
    () => (users ?? []).filter((u) => u.role === 'recruiter' || u.role === 'admin'),
    [users],
  );

  const form = useForm<CandidateFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      role: '',
      engagementType: 'outstaff',
      grade: 'Senior',
      experienceYears: 0,
      format: 'Удалённо',
      rateMonth: 0,
      employmentType: 'ИП',
      recruiterId: '',
      location: '',
      birthday: '',
      telegram: '',
      phone: '',
      email: '',
      stack: '',
      summary: '',
      skillCategories: [],
      experience: [],
      education: [],
      certifications: [],
      languages: [],
      ...defaultValues,
    } as CandidateFormValues,
  });
  const watchedRecruiterId = useWatch({ control: form.control, name: 'recruiterId' });

  useEffect(() => {
    // Для формы создания по умолчанию ставим «Ответственного рекрутера» равным
    // текущему пользователю, если он recruiter/admin и присутствует в справочнике.
    if (defaultValues?.recruiterId) return;
    if (watchedRecruiterId) return;
    if (!currentUser) return;
    if (currentUser.role !== 'recruiter' && currentUser.role !== 'admin') return;
    const exists = recruiters.some((r) => r.id === currentUser.id);
    if (!exists) return;
    form.setValue('recruiterId', currentUser.id, { shouldDirty: false, shouldValidate: true });
  }, [defaultValues?.recruiterId, watchedRecruiterId, currentUser, recruiters, form]);

  // ──────────────────────────────────────────────────────────────────────────
  // Импорт резюме («Распознать из файла»)
  //
  // Поддерживаются те же форматы, что и в форматтере: PDF/DOCX/DOC/RTF/TXT/HTML.
  // Логика: detect → extract (через resumeImport) → AI-парсинг → мерж в форму.
  // ──────────────────────────────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const handleResumeFile = async (file: File) => {
    const format = detectResumeFormat(file);
    if (!format) {
      toast.error(`Поддерживаются ${RESUME_FORMATS_LABEL}`);
      return;
    }

    setImporting(true);
    try {
      // 1) Файл → сплошной текст. Для .doc извлечение идёт через бэкенд
      //    (antiword) — у него осмысленные коды ошибок, поэтому ловим отдельно.
      let rawText: string;
      try {
        rawText = await extractResumeText(file, format);
      } catch (extractErr) {
        if (format === 'doc') {
          const msg = await extractAiErrorMessage(extractErr);
          toast.error('Не удалось обработать .doc', { description: msg });
          return;
        }
        throw extractErr;
      }

      if (!rawText.trim()) {
        toast.warning('В файле не найден текст', {
          description:
            'Похоже, это скан или пустой документ. Попробуйте другой файл или заполните карточку вручную.',
        });
        return;
      }

      // 2) Текст → структурированные поля через AI-эндпоинт.
      //    Ошибки 503 (нет ключа) / 502 (битый ответ) показываем дружелюбно.
      let parsedResponse;
      try {
        parsedResponse = await candidatesApi.parseResumeText(rawText);
      } catch (apiErr) {
        // Логируем сырую ошибку — иначе непонятно, был ли TimeoutError,
        // 5xx или сетевая. Тост — для пользователя, console — для дебага.
        console.error('[candidate-form] parseResumeText failed', apiErr);
        const msg = await extractAiErrorMessage(apiErr);
        toast.error('Не удалось распознать резюме', { description: msg });
        return;
      }

      const { values, filledFields } = parsedToFormValues(parsedResponse.parsed);

      if (filledFields.length === 0) {
        toast.warning('Не удалось распознать данные из файла', {
          description: 'Заполните карточку вручную или попробуйте другой файл.',
        });
        return;
      }

      // 3) Сливаем распознанные значения поверх текущих: то, что пользователь
      //    уже ввёл руками, не затираем (за исключением массивов — их перезаписываем,
      //    т.к. в исходной форме они пустые при «Создать»).
      const current = form.getValues();
      const merged: CandidateFormValues = {
        ...current,
        ...Object.fromEntries(
          Object.entries(values).filter(([key, v]) => {
            if (v === undefined || v === null || v === '') return false;
            const cur = (current as Record<string, unknown>)[key];
            // Скаляры: оставляем существующее, если пользователь уже что-то ввёл.
            if (typeof v === 'string' || typeof v === 'number') {
              return cur === '' || cur === 0 || cur === undefined || cur === null;
            }
            // Массивы: перезаписываем, если в текущей форме пусто.
            if (Array.isArray(v)) {
              return Array.isArray(cur) ? cur.length === 0 : true;
            }
            return true;
          }),
        ),
      } as CandidateFormValues;

      form.reset(merged, { keepDefaultValues: true });
      toast.success(`Распознано: ${filledFields.join(', ')}`);
    } catch (err) {
      console.error('[resume-import] failed', err);
      toast.error('Не удалось обработать файл', {
        description: 'Проверьте, что файл не зашифрован и не повреждён.',
      });
    } finally {
      setImporting(false);
      // Сбрасываем input, чтобы можно было загрузить тот же файл повторно.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {enableResumeImport && (
          <>
            <div className="-mt-2 flex justify-start">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={importing}
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                )}
                {importing ? 'Распознаём…' : 'Распознать из файла'}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={RESUME_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleResumeFile(file);
              }}
            />
          </>
        )}

        {/* === Базовая информация === */}
        <FormSection title="Основное">
          <FormField
            control={form.control}
            name="engagementType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Тип</FormLabel>
                <FormControl>
                  <EngagementTypeField value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>ФИО</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Иванов Иван Иванович"
                    autoCapitalize="words"
                    onChange={(e) => field.onChange(capitalizeFullName(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Позиция / специализация</FormLabel>
                  <FormControl><Input {...field} placeholder="Backend Developer" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="grade"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Грейд</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="experienceYears"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Опыт, лет</FormLabel>
                  <FormControl>
                    <Input
                      // type=text + inputMode=numeric — печатаются только цифры
                      // (исключаем «2.5» при ручном вводе). Если дробное прилетит
                      // извне (AI-парсинг резюме), округлим вверх в value.
                      // Схема: z.coerce.number().int().min(0).max(60).
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ? String(Math.min(60, Math.ceil(field.value))) : ''}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '');
                        field.onChange(digits ? Math.min(60, Number(digits)) : 0);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="format"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Формат</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="rateMonth"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ожидаемая ставка (₽/мес)</FormLabel>
                  <FormControl>
                    <Input
                      // type=text, чтобы можно было показывать «1 000» с разделителями;
                      // inputMode=numeric — мобильная клавиатура с цифрами.
                      // В стор/БД уходит чистое число — onChange приводит к Number.
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={field.value ? formatMoneyRub(field.value) : ''}
                      onChange={(e) => {
                        const digits = e.target.value.replace(/\D/g, '');
                        field.onChange(digits ? Number(digits) : 0);
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="employmentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Тип оформления</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {EMPLOYMENT_TYPES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="recruiterId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ответственный рекрутер</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {recruiters.map((r) => <SelectItem key={r.id} value={r.id}>{r.fullName}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        {/* === Контакты и личное === */}
        <FormSection title="Контакты и личное">
          <div className="grid grid-cols-2 gap-3">
            <FormField
              control={form.control}
              name="birthday"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Дата рождения</FormLabel>
                  <FormControl>
                    <DateField
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      maxDate={new Date()}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Локация</FormLabel>
                  <FormControl><Input {...field} placeholder="Москва" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField
              control={form.control}
              name="telegram"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telegram</FormLabel>
                  <FormControl><Input {...field} placeholder="@ivan_ivanov" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Телефон</FormLabel>
                  <FormControl><Input {...field} placeholder="+7 (999) 000-00-00" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input {...field} placeholder="name@example.com" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </FormSection>

        {/* === Сопроводительное письмо === */}
        <FormSection title="Сопроводительное письмо">
          <FormField
            control={form.control}
            name="summary"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sr-only">Сопроводительное письмо</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={5}
                    placeholder="Краткая самопрезентация кандидата: чем занимался, ключевой опыт, мотивация."
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        {/* === Сводный стек (для канбана и поиска) === */}
        <FormSection
          title="Сводный стек"
          hint="Через запятую — отображается на канбан-карточке и используется в поиске."
        >
          <FormField
            control={form.control}
            name="stack"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="sr-only">Стек</FormLabel>
                <FormControl><Input {...field} placeholder="Java, Spring, PostgreSQL" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormSection>

        {/* === Ключевые навыки === */}
        <SkillCategoriesSection control={form.control} />

        {/* === Опыт работы === */}
        <ExperienceSection control={form.control} />

        {/* === Образование === */}
        <EducationSection control={form.control} />

        {/* === Курсы / повышение квалификации === */}
        <CertificationsSection control={form.control} />

        {/* === Языки === */}
        <LanguagesSection control={form.control} />

        <div className="sticky bottom-0 -mx-6 flex justify-end border-t bg-background/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Сохранение…' : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Подсекции с повторяющимися строками
// ────────────────────────────────────────────────────────────────────────────

function SkillCategoriesSection({ control }: { control: Control<CandidateFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'skillCategories' });
  return (
    <FormSection
      title="Ключевые навыки"
      hint="Укажите навыки через запятую."
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() => append({ id: uid('sc'), name: 'Ключевые навыки', itemsText: '' })}
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить навыки
        </Button>
      }
    >
      {fields.length === 0 && (
        <EmptyHint text="Пока пусто. Добавьте ключевые навыки кандидата." />
      )}
      <div className="space-y-3">
        {fields.map((field, index) => (
          <div key={field.id} className="relative space-y-2 rounded-lg border bg-muted/20 p-3 pr-12">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => remove(index)}
              aria-label="Удалить"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <FormField
              control={control}
              name={`skillCategories.${index}.itemsText`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Навыки (через запятую)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...f}
                      rows={1}
                      className="!min-h-[52px]"
                      placeholder="C#, JavaScript, Groovy, PowerShell"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ))}
      </div>
    </FormSection>
  );
}

function ExperienceSection({ control }: { control: Control<CandidateFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'experience' });
  return (
    <FormSection
      title="Профессиональный опыт"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() =>
            append({
              id: uid('exp'),
              company: '',
              position: '',
              startMonth: '',
              endMonth: '',
              project: '',
              achievementsText: '',
              stackText: '',
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить место работы
        </Button>
      }
    >
      {fields.length === 0 && <EmptyHint text="Добавьте предыдущие места работы — компания, период, ключевые достижения." />}
      <div className="space-y-3">
        {fields.map((field, index) => (
          <RowFrame key={field.id} onRemove={() => remove(index)} title={`Место работы ${index + 1}`}>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={control}
                name={`experience.${index}.company`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Компания</FormLabel>
                    <FormControl><Input {...f} placeholder="АО Финтех" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`experience.${index}.position`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Должность</FormLabel>
                    <FormControl><Input {...f} placeholder="Ведущий инженер-разработчик" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={control}
                name={`experience.${index}.startMonth`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Начало</FormLabel>
                    <FormControl>
                      <DateField
                        value={f.value}
                        onChange={f.onChange}
                        onBlur={f.onBlur}
                        granularity="month"
                        placeholder="2025-07"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`experience.${index}.endMonth`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Окончание</FormLabel>
                    <FormControl>
                      <DateField
                        value={f.value}
                        onChange={f.onChange}
                        onBlur={f.onBlur}
                        granularity="month"
                        placeholder="2026-02"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={control}
              name={`experience.${index}.project`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Проект / контекст</FormLabel>
                  <FormControl>
                    <Textarea
                      {...f}
                      rows={2}
                      placeholder="Инфраструктура: Confluence и Jira на 500+ пользователей, SharePoint-ферма…"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`experience.${index}.achievementsText`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Ключевые задачи и достижения (каждый пункт с новой строки)</FormLabel>
                  <FormControl>
                    <Textarea
                      {...f}
                      rows={5}
                      placeholder={'Администрирование Confluence и Jira\nИнтеграция с Active Directory\nМиграция SharePoint Server'}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`experience.${index}.stackText`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Стек проекта (через запятую)</FormLabel>
                  <FormControl>
                    <Textarea {...f} rows={2} placeholder="Confluence, Jira, SharePoint, C#, JavaScript" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </RowFrame>
        ))}
      </div>
    </FormSection>
  );
}

function EducationSection({ control }: { control: Control<CandidateFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'education' });
  return (
    <FormSection
      title="Образование"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() =>
            append({
              id: uid('edu'),
              degree: '',
              institution: '',
              city: '',
              graduationYear: new Date().getFullYear(),
              specialty: '',
            })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить
        </Button>
      }
    >
      {fields.length === 0 && <EmptyHint text="Например: Магистр, МИФИ, 2016." />}
      <div className="space-y-3">
        {fields.map((field, index) => (
          <RowFrame key={field.id} onRemove={() => remove(index)} title={`Образование ${index + 1}`}>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={control}
                name={`education.${index}.degree`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Степень</FormLabel>
                    <FormControl><Input {...f} placeholder="Магистр" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`education.${index}.graduationYear`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Год окончания</FormLabel>
                    <FormControl><Input type="number" min={1950} max={2100} {...f} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={control}
              name={`education.${index}.institution`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Учебное заведение</FormLabel>
                  <FormControl><Input {...f} placeholder="Национальный исследовательский ядерный университет «МИФИ»" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={control}
                name={`education.${index}.city`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Город</FormLabel>
                    <FormControl><Input {...f} placeholder="Москва" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`education.${index}.specialty`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Факультет / специальность</FormLabel>
                    <FormControl><Input {...f} placeholder="Автоматики и электроники, Ядерные физика и технологии" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </RowFrame>
        ))}
      </div>
    </FormSection>
  );
}

function CertificationsSection({ control }: { control: Control<CandidateFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'certifications' });
  return (
    <FormSection
      title="Повышение квалификации"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() =>
            append({ id: uid('cert'), title: '', issuer: '', period: '' })
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить курс
        </Button>
      }
    >
      {fields.length === 0 && <EmptyHint text="Сертификаты, курсы, тренинги." />}
      <div className="space-y-3">
        {fields.map((field, index) => (
          <RowFrame key={field.id} onRemove={() => remove(index)} title={`Курс ${index + 1}`}>
            <FormField
              control={control}
              name={`certifications.${index}.title`}
              render={({ field: f }) => (
                <FormItem>
                  <FormLabel>Название</FormLabel>
                  <FormControl><Input {...f} placeholder="Консультант/администратор OpenText Content Server 25.3" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={control}
                name={`certifications.${index}.issuer`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Кем выдан</FormLabel>
                    <FormControl><Input {...f} placeholder="Terralink Technologies" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={control}
                name={`certifications.${index}.period`}
                render={({ field: f }) => (
                  <FormItem>
                    <FormLabel>Период</FormLabel>
                    <FormControl><Input {...f} placeholder="2017-2025" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </RowFrame>
        ))}
      </div>
    </FormSection>
  );
}

function LanguagesSection({ control }: { control: Control<CandidateFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'languages' });
  return (
    <FormSection
      title="Знание языков"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          onClick={() => append({ language: '', level: 'B2' })}
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить язык
        </Button>
      }
    >
      {fields.length === 0 && <EmptyHint text="Например: Русский — родной, Английский — B2." />}
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={field.id} className="flex items-end gap-2 rounded-lg border bg-muted/20 p-3">
            <FormField
              control={control}
              name={`languages.${index}.language`}
              render={({ field: f }) => (
                <FormItem className="flex-1">
                  <FormLabel>Язык</FormLabel>
                  <FormControl><Input {...f} placeholder="Английский" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`languages.${index}.level`}
              render={({ field: f }) => (
                <FormItem className="w-36">
                  <FormLabel>Уровень</FormLabel>
                  <Select value={f.value} onValueChange={f.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {LANGUAGE_LEVELS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mb-0.5 text-muted-foreground hover:text-destructive"
              onClick={() => remove(index)}
              aria-label="Удалить"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </FormSection>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Презентационные обёртки
// ────────────────────────────────────────────────────────────────────────────

function FormSection({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          {hint && <div className="mt-0.5 text-[11.5px] text-muted-foreground/80">{hint}</div>}
        </div>
        {action}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function RowFrame({
  title,
  onRemove,
  children,
}: {
  title?: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{title ?? ' '}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label="Удалить"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/10 px-3 py-2 text-[12px] text-muted-foreground">
      {text}
    </div>
  );
}

