import { useRef, useState } from 'react';
import { HTTPError } from 'ky';
import { FileDown, FileUp, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type {
  Candidate,
  CandidateCertification,
  CandidateEducation,
  CandidateExperience,
  CandidateLanguage,
  SkillCategory,
} from '@/api/types';
import { candidatesApi } from '@/api/candidates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { extractDocxText, extractPdfText, parsedToFormValues, type ParsedCandidate } from './resumeImport';
import {
  downloadResumePdf,
  generateResumeDocxBlob,
  generateResumeDocxBlobKhronyuk,
  resumeFileName,
  resumeFileNameKhronyuk,
} from './resume';

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function currentMonthIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
}

function splitStack(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFileName(rawName: string): string {
  const noExt = rawName.replace(/\.[^.]+$/, '');
  return noExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isDocxFile(file: File): boolean {
  return (
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx')
  );
}

async function getPdfErrorDescription(error: unknown): Promise<string | null> {
  if (!(error instanceof HTTPError)) return null;
  try {
    const body = (await error.response.clone().json()) as
      | { detail?: { message?: string; details?: { hint?: string; errorMessage?: string } } }
      | undefined;
    const detail = body?.detail;
    const hint = detail?.details?.hint?.trim();
    if (hint) return hint;
    const message = detail?.details?.errorMessage?.trim() || detail?.message?.trim();
    if (message) return message;
    return null;
  } catch {
    return null;
  }
}

async function extractAiErrorMessage(error: unknown): Promise<string> {
  if (error instanceof HTTPError) {
    try {
      const body = (await error.response.clone().json()) as
        | { detail?: { code?: string; message?: string }; message?: string }
        | undefined;
      const detail = body?.detail;
      if (detail?.code === 'ai_unavailable') {
        return detail.message ?? 'Сервис AI-распознавания временно недоступен. Попробуйте позже.';
      }
      if (detail?.message) return detail.message;
      if (body?.message) return body.message;
    } catch {
      // ignore invalid json
    }
  }
  return 'Не удалось распознать файл. Проверьте содержимое или попробуйте другой документ.';
}

function parsedToCandidate(parsed: ParsedCandidate, sourceFileName: string): Candidate {
  const fallbackName = normalizeFileName(sourceFileName) || 'Кандидат';

  const skillCategories: SkillCategory[] =
    parsed.skillCategories?.map((c) => ({
      id: uid('sc'),
      name: c.name,
      items: c.items ?? [],
    })) ?? [];

  const experience: CandidateExperience[] =
    parsed.experience?.map((e) => ({
      id: uid('exp'),
      company: e.company ?? '',
      position: e.position ?? '',
      startMonth: e.startMonth || currentMonthIso(),
      endMonth: e.endMonth ? e.endMonth : null,
      project: e.project || undefined,
      achievements: e.achievements ?? [],
      stack: e.stack ?? [],
    })) ?? [];

  const education: CandidateEducation[] =
    parsed.education?.map((e) => ({
      id: uid('edu'),
      degree: e.degree || 'Высшее',
      institution: e.institution || '',
      city: e.city || undefined,
      graduationYear: Number.isFinite(e.graduationYear) ? e.graduationYear : new Date().getFullYear(),
      specialty: e.specialty || undefined,
    })) ?? [];

  const certifications: CandidateCertification[] =
    parsed.certifications?.map((c) => ({
      id: uid('cert'),
      title: c.title || '',
      issuer: c.issuer || '',
      period: c.period || undefined,
    })) ?? [];

  const languages: CandidateLanguage[] =
    parsed.languages?.map((l) => ({
      language: l.language,
      level: l.level,
    })) ?? [];

  return {
    id: 'resume-formatter',
    fullName: parsed.fullName || fallbackName,
    role: parsed.role || 'Специалист',
    engagementType: 'outstaff',
    grade: parsed.grade || 'Middle',
    experienceYears: parsed.experienceYears ?? 0,
    stack: splitStack(parsed.stack),
    rateMonth: parsed.rateMonth ?? 0,
    employmentType: 'ИП',
    format: parsed.format || 'Удалённо',
    location: parsed.location || '',
    recruiterId: null,
    status: 'new',
    daysInStatus: 0,
    vacancyIds: [],
    telegram: parsed.telegram || undefined,
    phone: parsed.phone || undefined,
    email: parsed.email || undefined,
    birthday: parsed.birthday || undefined,
    kanbanOrder: 0,
    summary: parsed.summary || undefined,
    skillCategories,
    experience,
    education,
    certifications,
    languages,
    archived: false,
  };
}

export function ResumeFormatterPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [sourceFileName, setSourceFileName] = useState<string>('');
  const [parsedCandidate, setParsedCandidate] = useState<Candidate | null>(null);
  const [filledFields, setFilledFields] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [pdfPending, setPdfPending] = useState(false);

  const handleParseFile = async (file: File) => {
    if (!isPdfFile(file) && !isDocxFile(file)) {
      toast.error('Поддерживаются только PDF и DOCX');
      return;
    }

    setParsing(true);
    try {
      const rawText = isPdfFile(file) ? await extractPdfText(file) : await extractDocxText(file);

      if (!rawText.trim()) {
        toast.warning('В файле не найден текст', {
          description: 'Похоже, это скан или пустой документ. Попробуйте другой файл.',
        });
        return;
      }

      let parsedResponse;
      try {
        parsedResponse = await candidatesApi.parseResumeText(rawText);
      } catch (apiError) {
        const message = await extractAiErrorMessage(apiError);
        toast.error('Не удалось распознать резюме', { description: message });
        return;
      }

      const parsed = parsedResponse.parsed;
      const candidateDraft = parsedToCandidate(parsed, file.name);
      const parsedMeta = parsedToFormValues(parsed);

      setSourceFileName(file.name);
      setParsedCandidate(candidateDraft);
      setFilledFields(parsedMeta.filledFields);

      if (parsedMeta.filledFields.length > 0) {
        toast.success(`Распознано: ${parsedMeta.filledFields.join(', ')}`);
      } else {
        toast.success('Файл обработан. Проверьте результат перед выгрузкой.');
      }
    } catch (error) {
      console.error('[resume-formatter] parse failed', error);
      toast.error('Не удалось обработать файл', {
        description: 'Проверьте, что файл не зашифрован и не повреждён.',
      });
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDownloadDocx = async () => {
    if (!parsedCandidate) return;
    try {
      const blob = await generateResumeDocxBlob(parsedCandidate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resumeFileName(parsedCandidate, 'docx');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Резюме DOCX сформировано');
    } catch (error) {
      console.error(error);
      toast.error('Не удалось сформировать DOCX');
    }
  };

  const handleDownloadDocxMB = async () => {
    if (!parsedCandidate) return;
    try {
      const blob = await generateResumeDocxBlobKhronyuk(parsedCandidate);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resumeFileNameKhronyuk(parsedCandidate);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Резюме для МБ сформировано');
    } catch (error) {
      console.error(error);
      toast.error('Не удалось сформировать DOCX для МБ');
    }
  };

  const handleDownloadPdf = async () => {
    if (!parsedCandidate) return;
    setPdfPending(true);
    try {
      await downloadResumePdf(parsedCandidate);
      toast.success('Резюме PDF сформировано');
    } catch (error) {
      console.error(error);
      const description = await getPdfErrorDescription(error);
      toast.error('Не удалось сформировать PDF', description ? { description } : undefined);
    } finally {
      setPdfPending(false);
    }
  };

  return (
    <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
          <FileUp className="h-4.5 w-4.5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Форматтер резюме</h1>
          <p className="text-[11.5px] text-muted-foreground">
            Загрузите исходное резюме в PDF или DOCX. Сервис распознает данные и подготовит выгрузку в
            корпоративном формате.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-[13px]">Загрузка и распознавание</CardTitle>
          <CardDescription className="text-[12px]">
            Поддерживаются файлы `PDF` и `DOCX`. После обработки станут доступны кнопки выгрузки.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={parsing}
              onClick={() => inputRef.current?.click()}
              className="gap-1.5"
            >
              {parsing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
              ) : (
                <Sparkles className="h-3.5 w-3.5 text-violet-500" />
              )}
              {parsing ? 'Распознаём…' : 'Загрузить резюме'}
            </Button>
            {sourceFileName && (
              <span className="text-[12px] text-muted-foreground">
                Файл: <span className="font-medium text-foreground">{sourceFileName}</span>
              </span>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleParseFile(file);
            }}
          />

          {filledFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {filledFields.map((field) => (
                <Badge key={field} variant="secondary" className="text-[11px] font-medium">
                  {field}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-[13px]">Выгрузка в формате LG</CardTitle>
          <CardDescription className="text-[12px]">
            Доступно после распознавания файла. Форматы совпадают с карточкой кандидата.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 p-4 pt-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!parsedCandidate}
            onClick={handleDownloadDocx}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Выгрузить DOCX
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!parsedCandidate || pdfPending}
            onClick={handleDownloadPdf}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            {pdfPending ? 'Генерируем PDF…' : 'Выгрузить PDF'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!parsedCandidate}
            onClick={handleDownloadDocxMB}
          >
            <FileDown className="mr-1.5 h-3.5 w-3.5" />
            Выгрузить для МБ
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
