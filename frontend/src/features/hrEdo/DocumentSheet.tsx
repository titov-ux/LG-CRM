/**
 * Карточка кадрового документа: предпросмотр (pdfjs), подписи, протокол и
 * действия по статусу (сформировать → подпись директора → отправить →
 * напомнить / бумажная подпись → скачать с листом подписания).
 */
import { useEffect, useState } from 'react';
import {
  Ban,
  BellRing,
  Download,
  FileLock2,
  Fingerprint,
  Loader2,
  Send,
  ShieldCheck,
  Stamp,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/permissions';
import { hrEdoApi, type HrDocument } from '@/api/hrEdo';
import {
  useCancelDocument,
  useDocTypes,
  useEmployerSignature,
  useFreezeDocument,
  useHrDocument,
  useHrDocumentEvents,
  usePaperSigned,
  useRemindDocument,
  useSendDocuments,
} from './hooks';
import { FileUploadDialog, PortalLinkDialog, ReasonDialog } from './dialogs';
import { PdfViewer } from './PdfViewer';
import {
  DOC_STATUS,
  EVENT_LABEL,
  SIG_TYPE_LABEL,
  apiErrorMessage,
  docLabel,
  fmtDate,
  fmtDateTime,
  groupFingerprint,
  saveBlob,
} from './statuses';

export function DocumentSheet({ documentId, onClose }: { documentId: string | null; onClose: () => void }) {
  const { data: doc, isLoading } = useHrDocument(documentId);
  return (
    <Sheet open={!!documentId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl">
        {isLoading || !doc ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : (
          <DocumentBody key={doc.id + doc.status} doc={doc} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DocumentBody({ doc }: { doc: HrDocument }) {
  const { data: types = [] } = useDocTypes();
  const type = types.find((t) => t.code === doc.typeCode);
  const canSignEmployer = useCan('hr_edo:sign_employer');
  const canExport = useCan('hr_edo:export');
  const freeze = useFreezeDocument();
  const send = useSendDocuments();
  const remind = useRemindDocument();
  const cancel = useCancelDocument();
  const employerSig = useEmployerSignature();
  const paper = usePaperSigned();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [employerOpen, setEmployerOpen] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [links, setLinks] = useState<{ name: string; url: string }[]>([]);
  const st = DOC_STATUS[doc.status];
  const employeeSigned = doc.signatures.some((s) => s.signerRole === 'employee');
  const employerSigned = doc.signatures.some((s) => s.signerRole === 'employer');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(await apiErrorMessage(e));
    }
  };

  const doSend = () =>
    run(async () => {
      const res = await send.mutateAsync([doc.id]);
      const entries = Object.values(res.portalLinks);
      if (entries.length) setLinks(entries.map((url) => ({ name: doc.employeeName, url })));
    }, 'Отправлено сотруднику');

  const download = async (kind: 'source' | 'stamped') => {
    try {
      const blob = await hrEdoApi.fileBlob(doc.id, kind, true);
      saveBlob(blob, `${docLabel(doc)}${kind === 'stamped' ? ' (с листом подписания)' : ''}.pdf`);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось скачать'));
    }
  };

  const downloadSig = async (sigId: string, name: string) => {
    try {
      saveBlob(await hrEdoApi.signatureBlob(doc.id, sigId), name);
    } catch (e) {
      toast.error(await apiErrorMessage(e, 'Не удалось скачать подпись'));
    }
  };

  return (
    <>
      <SheetHeader className="space-y-1 border-b px-5 py-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', st.className)}>{st.label}</span>
          {type?.paperOnly && <span className="text-[11px] text-muted-foreground">только бумага</span>}
        </div>
        <SheetTitle className="text-[16px]">{docLabel(doc)}</SheetTitle>
        <SheetDescription className="text-[12px]">
          {doc.employeeName} · от {fmtDate(doc.docDate)}
          {doc.dueAt && ['sent', 'viewed'].includes(doc.status) && ` · подписать до ${fmtDate(doc.dueAt)}`}
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          {doc.status === 'draft' && (
            <Button size="sm" onClick={() => void run(() => freeze.mutateAsync(doc.id), 'PDF сформирован и заморожен')} disabled={freeze.isPending}>
              {freeze.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileLock2 className="mr-1.5 h-3.5 w-3.5" />}
              Сформировать
            </Button>
          )}
          {doc.status === 'awaiting_employer' && !employerSigned && canSignEmployer && (
            <Button size="sm" onClick={() => setEmployerOpen(true)}>
              <Stamp className="mr-1.5 h-3.5 w-3.5" /> Подпись директора (.sig)
            </Button>
          )}
          {doc.status === 'frozen' && !type?.paperOnly && (
            <Button size="sm" onClick={() => void doSend()} disabled={send.isPending}>
              {send.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              Отправить сотруднику
            </Button>
          )}
          {['sent', 'viewed'].includes(doc.status) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void run(async () => {
                  const res = await remind.mutateAsync(doc.id);
                  const urls = Object.values(res.portalLinks);
                  if (urls.length) setLinks(urls.map((url) => ({ name: doc.employeeName, url })));
                }, 'Напоминание отправлено')
              }
            >
              <BellRing className="mr-1.5 h-3.5 w-3.5" /> Напомнить
            </Button>
          )}
          {['frozen', 'sent', 'viewed', 'expired'].includes(doc.status) && !employeeSigned && doc.typeCode !== 'edo_consent_package' && (
            <Button size="sm" variant="outline" onClick={() => setPaperOpen(true)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Подписан на бумаге
            </Button>
          )}
          {doc.hasStamped && (
            <Button size="sm" variant="outline" onClick={() => void download('stamped')}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> PDF с листом подписания
            </Button>
          )}
          {doc.hasSource && (
            <Button size="sm" variant="ghost" onClick={() => void download('source')}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Исходный PDF
            </Button>
          )}
          {['draft', 'frozen', 'awaiting_employer', 'sent', 'viewed', 'expired'].includes(doc.status) && (
            <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" onClick={() => setCancelOpen(true)}>
              <Ban className="mr-1.5 h-3.5 w-3.5" /> Отменить
            </Button>
          )}
        </div>
        {doc.rejectReason && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-[12px] text-red-700 dark:text-red-400">
            Отказ сотрудника: {doc.rejectReason}
          </p>
        )}
        {doc.cancelReason && (
          <p className="rounded-md bg-muted px-3 py-2 text-[12px] text-muted-foreground">Отменён: {doc.cancelReason}</p>
        )}
      </SheetHeader>

      <Tabs defaultValue="doc" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-5 mt-3 w-fit">
          <TabsTrigger value="doc">Документ</TabsTrigger>
          <TabsTrigger value="signatures">Подписи · {doc.signatures.length}</TabsTrigger>
          <TabsTrigger value="events">Протокол</TabsTrigger>
        </TabsList>
        <TabsContent value="doc" className="mt-0 min-h-0 flex-1 overflow-hidden px-5 py-3">
          {doc.hasSource ? (
            <PdfViewer
              key={`${doc.id}-${doc.hasStamped}`}
              className="h-full"
              load={() => hrEdoApi.fileBlob(doc.id, doc.hasStamped ? 'stamped' : 'source')}
            />
          ) : (
            <DraftPreview id={doc.id} />
          )}
        </TabsContent>
        <TabsContent value="signatures" className="mt-0 min-h-0 flex-1 space-y-3 overflow-auto px-5 py-3">
          <HashBlock doc={doc} />
          {doc.signatures.length === 0 && (
            <p className="text-[12.5px] text-muted-foreground">Подписей пока нет.</p>
          )}
          {doc.signatures.map((s) => (
            <div key={s.id} className={cn('rounded-lg border p-3 text-[12.5px]', s.isTest && 'border-amber-500/40')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {s.signerRole === 'employer' ? 'Работодатель' : 'Работник'}: {s.signerName}
                  </div>
                  <div className="text-muted-foreground">{SIG_TYPE_LABEL[s.sigType]}</div>
                </div>
                <div className="text-right text-muted-foreground">{fmtDateTime(s.signedAt)}</div>
              </div>
              <dl className="mt-2 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12px]">
                {s.fingerprint && (
                  <>
                    <dt className="text-muted-foreground">Отпечаток ключа</dt>
                    <dd className="break-words font-mono text-[11px]">{groupFingerprint(s.fingerprint)}</dd>
                  </>
                )}
                {s.phoneMasked && (
                  <>
                    <dt className="text-muted-foreground">Подтверждение</dt>
                    <dd>код из SMS на {s.phoneMasked}</dd>
                  </>
                )}
                {s.tspTime && (
                  <>
                    <dt className="text-muted-foreground">Метка времени</dt>
                    <dd>{fmtDateTime(s.tspTime)}</dd>
                  </>
                )}
                {s.certSubject && (
                  <>
                    <dt className="text-muted-foreground">Сертификат</dt>
                    <dd>{s.certSubject}</dd>
                  </>
                )}
              </dl>
              {s.isTest && (
                <p className="mt-2 text-[11.5px] text-amber-700 dark:text-amber-400">
                  Тестовая подпись: crypto-service не подключён (dev).
                </p>
              )}
              {canExport && s.hasFile && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-7 px-2 text-[12px]"
                  onClick={() =>
                    void downloadSig(
                      s.id,
                      s.sigType === 'paper'
                        ? `${docLabel(doc)} (скан).pdf`
                        : `${doc.number ?? doc.id}.${s.signerRole}.sig`,
                    )
                  }
                >
                  <Download className="mr-1 h-3.5 w-3.5" /> {s.sigType === 'paper' ? 'Скан' : 'Файл подписи .sig'}
                </Button>
              )}
            </div>
          ))}
        </TabsContent>
        <TabsContent value="events" className="mt-0 min-h-0 flex-1 overflow-auto px-5 py-3">
          <EventsTimeline id={doc.id} />
        </TabsContent>
      </Tabs>

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Отменить документ"
        description="Документ останется в реестре со статусом «Отменён» и причиной."
        placeholder="Например: ошибка в окладе, будет выпущен новый"
        confirmLabel="Отменить документ"
        destructive
        onConfirm={(reason) => cancel.mutateAsync({ id: doc.id, reason })}
      />
      <FileUploadDialog
        open={employerOpen}
        onOpenChange={setEmployerOpen}
        title="Подпись работодателя"
        description={
          <>
            Скачайте исходный PDF, подпишите его УКЭП директора (КриптоАРМ / КриптоПро, отсоединённая подпись CAdES) и
            загрузите файл .sig. Подпись в браузере через плагин появится на Этапе 2.
          </>
        }
        accept=".sig,.p7s,application/pkcs7-signature,application/octet-stream"
        hint="Файл .sig или .p7s"
        confirmLabel="Проверить и загрузить"
        onConfirm={(file) =>
          employerSig.mutateAsync({ id: doc.id, file }).then(() => toast.success('Подпись работодателя принята'))
        }
      />
      <FileUploadDialog
        open={paperOpen}
        onOpenChange={setPaperOpen}
        title="Подписан на бумаге"
        description="Бумажный контур: сотрудник подписал распечатку. Загрузите скан, оригинал храните в личном деле."
        accept="application/pdf,image/jpeg,image/png"
        hint="PDF, JPG или PNG"
        confirmLabel="Загрузить скан"
        onConfirm={(file) => paper.mutateAsync({ id: doc.id, file }).then(() => toast.success('Отмечено как подписанный'))}
      />
      <PortalLinkDialog links={links} onClose={() => setLinks([])} />
    </>
  );
}

function HashBlock({ doc }: { doc: HrDocument }) {
  if (!doc.contentSha256) return null;
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-[12px]">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium">
        <Fingerprint className="h-3.5 w-3.5" /> Хеши замороженного PDF
      </div>
      <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">ГОСТ Р 34.11-2012</dt>
        <dd className="break-all font-mono text-[11px]">{doc.contentStreebog256}</dd>
        <dt className="text-muted-foreground">SHA-256</dt>
        <dd className="break-all font-mono text-[11px]">{doc.contentSha256}</dd>
        <dt className="text-muted-foreground">Заморожен</dt>
        <dd>{fmtDateTime(doc.frozenAt)}</dd>
      </dl>
    </div>
  );
}

function DraftPreview({ id }: { id: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    hrEdoApi
      .documentPreview(id)
      .then((h) => alive && setHtml(h))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);
  if (failed) return <p className="text-[12.5px] text-muted-foreground">Не удалось построить предпросмотр.</p>;
  if (html === null) return <Skeleton className="h-96 w-full" />;
  return <iframe title="Черновик" srcDoc={html} sandbox="" className="h-full min-h-[600px] w-full rounded-md border bg-white" />;
}

function EventsTimeline({ id }: { id: string }) {
  const { data: events, isLoading } = useHrDocumentEvents(id);
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {(events ?? []).map((e) => (
        <li key={e.id} className="text-[12.5px]">
          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-foreground/60" />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</span>
            <span className="text-[11.5px] text-muted-foreground">{fmtDateTime(e.createdAt)}</span>
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {e.actorName}
            {e.ip && ` · ${e.ip}`}
            {typeof e.payload.phone === 'string' && ` · ${e.payload.phone}`}
            {typeof e.payload.reason === 'string' && ` · «${e.payload.reason}»`}
            {typeof e.payload.number === 'string' && ` · № ${e.payload.number}`}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground/70" title={`prev ${e.prevHash}`}>
            #{e.id} · {e.hash.slice(0, 16)}…
          </div>
        </li>
      ))}
      {events?.length === 0 && <p className="text-[12.5px] text-muted-foreground">Событий нет.</p>}
      <li className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" /> Протокол неизменяем: хеш-цепочка и запрет правки на уровне БД
      </li>
    </ol>
  );
}

