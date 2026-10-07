/**
 * Документы сотрудника и подписание кодом из SMS — общий экран портала
 * (`/sign/$token`) и «Моих документов» (`/my-docs`).
 *
 * Правила подписи (plan-hr-edo.md, сценарий B):
 * — «Подписать» доступна после прокрутки документа до конца и отметки
 *   «Я ознакомлен(а)»;
 * — несколько прочитанных документов можно подписать одним кодом;
 * — отказ — только с причиной.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FileSignature,
  FileText,
  Loader2,
  PenLine,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { EmployeeDocsApi, HrChallenge, HrEmployeeSelf, HrPortalDocument } from '@/api/hrEdo';
import { CodeStep } from './CodeStep';
import { DevSmsHint } from './DevSmsHint';
import { KeyIssueFlow } from './KeyIssueFlow';
import { PdfViewer } from './PdfViewer';
import { DOC_STATUS, apiErrorMessage, docLabel, fmtDate, fmtDateTime, groupFingerprint, pluralRu, saveBlob } from './statuses';

const PENDING = new Set(['sent', 'viewed']);

export function EmployeeDocsView({
  api,
  employee,
  queryKey,
  onEmployeeChanged,
}: {
  api: EmployeeDocsApi;
  employee: HrEmployeeSelf;
  queryKey: readonly unknown[];
  onEmployeeChanged: () => void;
}) {
  const qc = useQueryClient();
  const { data: docs, isLoading } = useQuery({ queryKey, queryFn: api.documents });
  const [openId, setOpenId] = useState<string | null>(null);
  const [readToEnd, setReadToEnd] = useState<Set<string>>(new Set());
  const [bulkChallenge, setBulkChallenge] = useState<HrChallenge | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const pending = useMemo(() => (docs ?? []).filter((d) => PENDING.has(d.status)), [docs]);
  const archive = useMemo(() => (docs ?? []).filter((d) => !PENDING.has(d.status)), [docs]);
  const readyForBulk = pending.filter((d) => d.canSign && readToEnd.has(d.id));
  const openDoc = (docs ?? []).find((d) => d.id === openId) ?? null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey });
    onEmployeeChanged();
  };

  const needsKey = employee.edoStatus === 'consent_signed' || employee.edoStatus === 'key_revoked';

  const startBulk = async () => {
    setBulkBusy(true);
    try {
      setBulkChallenge(await api.challenge(readyForBulk.map((d) => d.id)));
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось отправить код'));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {employee.edoStatus === 'notified' && <ConsentInstructions company={employee.companyName} />}
      {employee.edoStatus === 'refused' && (
        <Card>
          <CardContent className="p-4 text-[13px] text-muted-foreground">
            Вы работаете в бумажном контуре: документы оформляются на бумаге. Если захотите перейти на электронный
            документооборот — сообщите кадровику.
          </CardContent>
        </Card>
      )}
      {needsKey && (
        <KeyIssueFlow api={api} revoked={employee.edoStatus === 'key_revoked'} onIssued={refresh} />
      )}
      {employee.key && employee.edoStatus === 'active' && (
        <div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <div className="min-w-0">
            Подпись выпущена {fmtDate(employee.key.issuedAt)}. Отпечаток ключа:{' '}
            <span className="tnum break-words font-mono text-foreground">{groupFingerprint(employee.key.fingerprint)}</span>
            {employee.key.isTest && <span className="ml-1 text-amber-700 dark:text-amber-400">(тестовая)</span>}
          </div>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold">
            Ждут подписи{' '}
            {pending.length > 0 && <span className="tnum text-muted-foreground">· {pending.length}</span>}
          </h2>
          {readyForBulk.length > 1 && (
            <Button size="sm" onClick={() => void startBulk()} disabled={bulkBusy}>
              {bulkBusy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PenLine className="mr-1.5 h-3.5 w-3.5" />}
              Подписать {readyForBulk.length} {pluralRu(readyForBulk.length, ['документ', 'документа', 'документов'])}
            </Button>
          )}
        </div>
        {isLoading && <Skeleton className="h-16 w-full rounded-lg" />}
        {!isLoading && pending.length === 0 && (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-[13px] text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Нет документов, которые ждут вашей подписи.
            </CardContent>
          </Card>
        )}
        {pending.map((d) => (
          <DocRow key={d.id} doc={d} read={readToEnd.has(d.id)} onOpen={() => setOpenId(d.id)} />
        ))}
      </section>

      {archive.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[13px] font-semibold text-muted-foreground">Архив</h2>
          {archive.map((d) => (
            <DocRow key={d.id} doc={d} onOpen={() => setOpenId(d.id)} />
          ))}
        </section>
      )}

      {openDoc && (
        <DocumentReader
          key={openDoc.id}
          api={api}
          doc={openDoc}
          alreadyRead={readToEnd.has(openDoc.id)}
          onReadToEnd={() => setReadToEnd((s) => new Set(s).add(openDoc.id))}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      )}

      <Dialog open={!!bulkChallenge} onOpenChange={(o) => !o && setBulkChallenge(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Подписание документов</DialogTitle>
            <DialogDescription>
              Один код — отдельная подпись на каждый документ:
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-[12.5px]">
            {readyForBulk.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> {docLabel(d)}
              </li>
            ))}
          </ul>
          {bulkChallenge && (
            <CodeStep
              challenge={bulkChallenge}
              submitLabel="Подписать"
              onResend={() => api.challenge(bulkChallenge.documentIds)}
              onSubmit={async (code) => {
                const res = await api.confirm(bulkChallenge.challengeId, code);
                toast.success(`Подписано: ${res.signed.length}`);
                setBulkChallenge(null);
                refresh();
              }}
            />
          )}
          <DevSmsHint />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocRow({ doc, read, onOpen }: { doc: HrPortalDocument; read?: boolean; onOpen: () => void }) {
  const st = DOC_STATUS[doc.status];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <FileSignature className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">{docLabel(doc)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
          <span className={cn('rounded px-1.5 py-px text-[10.5px] font-medium', st.className)}>{st.label}</span>
          <span>от {fmtDate(doc.docDate)}</span>
          {doc.dueAt && PENDING.has(doc.status) && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" /> до {fmtDate(doc.dueAt)}
            </span>
          )}
          {read && <span className="text-emerald-700 dark:text-emerald-400">прочитан</span>}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function DocumentReader({
  api,
  doc,
  alreadyRead,
  onReadToEnd,
  onClose,
  onChanged,
}: {
  api: EmployeeDocsApi;
  doc: HrPortalDocument;
  alreadyRead: boolean;
  onReadToEnd: () => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [reachedEnd, setReachedEnd] = useState(alreadyRead);
  const [agreed, setAgreed] = useState(false);
  const [challenge, setChallenge] = useState<HrChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [viewedSent, setViewedSent] = useState(false);
  const pending = PENDING.has(doc.status);
  const action = doc.employeeAction === 'acknowledge' ? 'Ознакомиться и подписать' : 'Подписать';

  // Отметку «прочитан до конца» бэкенд проверяет перед выдачей кода —
  // запрос кода ждёт, пока она дойдёт.
  const viewedToEnd = useRef<Promise<unknown> | null>(null);
  const markViewed = (toEnd: boolean) => {
    if (!pending) return;
    const p = api.viewed(doc.id, toEnd).catch(() => undefined);
    if (toEnd) viewedToEnd.current = p;
  };

  const requestCode = async () => {
    setBusy(true);
    try {
      await (viewedToEnd.current ?? api.viewed(doc.id, true));
      setChallenge(await api.challenge([doc.id]));
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось отправить код'));
    } finally {
      setBusy(false);
    }
  };

  const doReject = async () => {
    setBusy(true);
    try {
      await api.reject(doc.id, reason.trim());
      toast.success('Отказ отправлен кадровику');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось отправить отказ'));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    try {
      saveBlob(await api.fileBlob(doc.id), `${docLabel(doc)}.pdf`);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось скачать'));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[100dvh] max-w-3xl flex-col gap-3 p-3 sm:h-[92vh] sm:p-5">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle className="text-[15px]">{docLabel(doc)}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {DOC_STATUS[doc.status].label} · от {fmtDate(doc.docDate)}
            {doc.signedAt && ` · подписан ${fmtDateTime(doc.signedAt)}`}
          </DialogDescription>
        </DialogHeader>

        <PdfViewer
          className="min-h-0 flex-1"
          load={() => {
            if (!viewedSent) {
              setViewedSent(true);
              markViewed(false);
            }
            return api.fileBlob(doc.id);
          }}
          onReachEnd={() => {
            setReachedEnd(true);
            onReadToEnd();
            markViewed(true);
          }}
        />

        {doc.signMethod === 'external' && pending && (
          <p className="rounded-md border bg-muted/30 p-3 text-[12px] text-muted-foreground">
            Этот пакет подписывается вне системы: распечатайте и подпишите его или подпишите Госключом / своей
            УКЭП, затем передайте кадровику.
          </p>
        )}

        {challenge ? (
          <div className="mx-auto w-full max-w-sm">
            <CodeStep
              challenge={challenge}
              submitLabel="Подписать"
              hint={`Подписание «${docLabel(doc)}»`}
              onResend={() => api.challenge([doc.id])}
              onSubmit={async (code) => {
                await api.confirm(challenge.challengeId, code);
                toast.success('Документ подписан');
                onChanged();
                onClose();
              }}
            />
            <DevSmsHint />
          </div>
        ) : (
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
            {doc.canSign ? (
              <Label className="flex items-start gap-2 text-[12.5px] font-normal leading-snug">
                <Checkbox
                  checked={agreed}
                  disabled={!reachedEnd}
                  onCheckedChange={(v) => setAgreed(v === true)}
                  className="mt-0.5"
                />
                <span className={cn(!reachedEnd && 'text-muted-foreground')}>
                  Я ознакомлен(а) с документом
                  {!reachedEnd && <span className="block text-[11px]">Прокрутите документ до конца</span>}
                </span>
              </Label>
            ) : (
              <Button variant="outline" size="sm" onClick={() => void download()}>
                Скачать PDF
              </Button>
            )}
            <div className="flex gap-2">
              {pending && doc.signMethod === 'unep_lg' && (
                <Button variant="ghost" onClick={() => setRejectOpen(true)} disabled={busy}>
                  <XCircle className="mr-1.5 h-4 w-4" /> Отказаться
                </Button>
              )}
              {doc.canSign && (
                <Button onClick={() => void requestCode()} disabled={!agreed || busy}>
                  {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PenLine className="mr-1.5 h-4 w-4" />}
                  {action}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}

        <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Отказаться от подписи</DialogTitle>
              <DialogDescription>Кадровик увидит причину и свяжется с вами.</DialogDescription>
            </DialogHeader>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Например: неверно указан оклад"
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setRejectOpen(false)}>
                Назад
              </Button>
              <Button variant="destructive" onClick={() => void doReject()} disabled={reason.trim().length < 3 || busy}>
                Отказаться
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

function ConsentInstructions({ company }: { company: string }) {
  return (
    <Card className="border-amber-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Переход на электронный документооборот</CardTitle>
        <CardDescription>{company}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-[13px]">
        <p>
          Ниже — пакет согласия: согласие на КЭДО и соглашение об электронной подписи. Его нужно подписать до первого
          электронного документа одним из способов:
        </p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>распечатать, подписать и передать оригинал кадровику;</li>
          <li>подписать PDF Госключом на телефоне и отправить файл подписи кадровику;</li>
          <li>подписать своей усиленной квалифицированной подписью.</li>
        </ul>
        <p className="text-muted-foreground">
          После регистрации согласия здесь появится кнопка «Получить подпись». Если не хотите переходить на ЭДО —
          ничего делать не нужно.
        </p>
      </CardContent>
    </Card>
  );
}
