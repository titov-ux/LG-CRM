// MSW-обработчики кадрового ЭДО (/hr-edo/*) и публичного портала (/sign/*).
// Имитация сценария: сотрудник → приглашение → согласие → подпись → документы.
// SMS-код в мок-режиме всегда 123456.

import { http, HttpResponse } from 'msw';
import { API_BASE_URL } from '@/lib/constants';
import type { HrDocument, HrEmployee } from '@/api/hrEdo';
import {
  HR_MOCK_CODE,
  hrChallenge,
  hrDocTypesDb,
  hrDocumentsDb,
  hrEmployeeSignature,
  hrEmployeesDb,
  hrEvent,
  hrEventsDb,
  hrKeysDb,
  hrMakeKey,
  hrMockPdf,
  hrNewId,
  hrNextNumber,
  hrPortalDoc,
  hrTouchEmployee,
} from './db/hrEdo';
import { candidatesDb } from './db';

const url = (path: string) => `${API_BASE_URL}${path}`;
const today = () => new Date().toISOString().slice(0, 10);
const err = (status: number, code: string, message: string, details: Record<string, unknown> = {}) =>
  HttpResponse.json({ detail: { code, message, details } }, { status });

function mask(phone?: string | null) {
  const d = (phone ?? '').replace(/\D/g, '');
  return d.length >= 4 ? `+7 ••• ••• ${d.slice(-4, -2)}-${d.slice(-2)}` : null;
}

function normPhone(p?: string | null): string | null {
  if (!p) return null;
  let d = p.replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = `7${d.slice(1)}`;
  if (d.length === 10) d = `7${d}`;
  return d ? `+${d}` : null;
}

function emp(idParam: unknown) {
  return hrEmployeesDb.find((e) => e.id === idParam);
}
function doc(idParam: unknown) {
  return hrDocumentsDb.find((d) => d.id === idParam);
}
function page<T>(items: T[], req: Request) {
  const sp = new URL(req.url).searchParams;
  const p = Number(sp.get('page') ?? 1);
  const size = Number(sp.get('pageSize') ?? 50);
  return { items: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size };
}
function typeOf(code: string) {
  return hrDocTypesDb.find((t) => t.code === code);
}

function freeze(d: HrDocument) {
  const type = typeOf(d.typeCode);
  d.number = hrNextNumber(type?.numberPrefix ?? 'ДОК');
  d.contentSha256 = crypto.randomUUID().replace(/-/g, '').repeat(2);
  d.contentStreebog256 = crypto.randomUUID().replace(/-/g, '').repeat(2);
  d.frozenAt = new Date().toISOString();
  d.hasSource = true;
  d.status = type?.paperOnly
    ? 'archived_paper'
    : type?.employerSig === 'ukep' && type.signOrder === 'employer_first'
      ? 'awaiting_employer'
      : 'frozen';
  hrEvent('frozen', d.id, d.employeeId);
}

function complete(d: HrDocument) {
  const type = typeOf(d.typeCode);
  const empDone = d.signatures.some((s) => s.signerRole === 'employee');
  const employerDone = type?.employerSig !== 'ukep' || d.signatures.some((s) => s.signerRole === 'employer');
  if (empDone && employerDone) {
    d.status = 'signed';
    d.signedAt = new Date().toISOString();
    d.hasStamped = true;
  } else if (empDone) d.status = 'awaiting_employer';
  else if (employerDone && !d.sentAt) d.status = 'frozen';
  d.updatedAt = new Date().toISOString();
}

function refresh() {
  hrEmployeesDb.forEach(hrTouchEmployee);
}

// Портал: единственная мок-сессия.
let portalEmployeeId: string | null = null;

function selfDto(e: HrEmployee) {
  hrTouchEmployee(e);
  return {
    id: e.id,
    fullName: e.fullName,
    position: e.position,
    edoStatus: e.edoStatus,
    phoneMasked: e.phoneMasked,
    email: e.email,
    key: hrKeysDb[e.id] ?? null,
    companyName: 'ООО «ЛГ Интеграция»',
    pendingCount: e.pendingDocuments,
  };
}

function visibleDocs(e: HrEmployee) {
  return hrDocumentsDb.filter(
    (d) => d.employeeId === e.id && d.sentAt && !['draft', 'cancelled', 'frozen', 'archived_paper'].includes(d.status),
  );
}

/** Общие операции сотрудника для «Моих документов» и портала. */
function employeeHandlers(prefix: string, current: () => HrEmployee | undefined) {
  const need = () => {
    const e = current();
    return e ?? null;
  };
  return [
    http.get(url(`${prefix}/documents`), () => {
      const e = need();
      if (!e) return err(401, 'portal_session_required', 'Войдите по ссылке из письма');
      return HttpResponse.json(visibleDocs(e).map((d) => hrPortalDoc(d, e)));
    }),
    http.get(url(`${prefix}/documents/:id/file`), ({ params }) => {
      const d = doc(params.id);
      if (!d) return err(404, 'not_found', 'Документ не найден');
      return new HttpResponse(hrMockPdf(d.number ?? d.title), { headers: { 'Content-Type': 'application/pdf' } });
    }),
    http.post(url(`${prefix}/documents/:id/viewed`), async ({ params, request }) => {
      const e = need();
      const d = doc(params.id);
      if (!e || !d) return err(404, 'not_found', 'Документ не найден');
      const body = (await request.json()) as { toEnd?: boolean };
      if (d.status === 'sent') d.status = 'viewed';
      d.viewedAt ??= new Date().toISOString();
      hrEvent(body.toEnd ? 'viewed_to_end' : 'viewed', d.id, e.id, e.fullName);
      return HttpResponse.json(hrPortalDoc(d, e));
    }),
    http.post(url(`${prefix}/documents/:id/reject`), async ({ params, request }) => {
      const e = need();
      const d = doc(params.id);
      if (!e || !d) return err(404, 'not_found', 'Документ не найден');
      d.status = 'rejected';
      d.rejectReason = ((await request.json()) as { reason: string }).reason;
      hrEvent('rejected', d.id, e.id, e.fullName);
      refresh();
      return HttpResponse.json(hrPortalDoc(d, e));
    }),
    http.post(url(`${prefix}/key/otp`), () => {
      const e = need();
      if (!e) return err(401, 'portal_session_required', 'Войдите по ссылке из письма');
      if (!['consent_signed', 'key_revoked'].includes(e.edoStatus))
        return err(409, 'consent_required', 'Подпись выпускается только после регистрации согласия на КЭДО');
      hrEvent('otp_sent', null, e.id, e.fullName);
      return HttpResponse.json(hrChallenge([], e.phoneMasked ?? ''));
    }),
    http.post(url(`${prefix}/key/issue`), async ({ request }) => {
      const e = need();
      if (!e) return err(401, 'portal_session_required', 'Войдите');
      const body = (await request.json()) as { code: string };
      if (body.code !== HR_MOCK_CODE) return err(422, 'otp_invalid', 'Неверный код', { attemptsLeft: 4 });
      const key = hrMakeKey(e);
      e.edoStatus = 'active';
      e.phoneVerifiedAt = new Date().toISOString();
      hrEvent('key_issued', null, e.id, e.fullName);
      refresh();
      return HttpResponse.json(key);
    }),
    http.post(url(`${prefix}/challenges`), async ({ request }) => {
      const e = need();
      if (!e) return err(401, 'portal_session_required', 'Войдите');
      const body = (await request.json()) as { documentIds: string[] };
      return HttpResponse.json(hrChallenge(body.documentIds, e.phoneMasked ?? ''));
    }),
    http.post(url(`${prefix}/challenges/:id/confirm`), async ({ request }) => {
      const e = need();
      if (!e) return err(401, 'portal_session_required', 'Войдите');
      const body = (await request.json()) as { code: string };
      if (body.code !== HR_MOCK_CODE) return err(422, 'otp_invalid', 'Неверный код', { attemptsLeft: 4 });
      const pending = visibleDocs(e).filter((d) => ['sent', 'viewed'].includes(d.status));
      pending.forEach((d) => {
        d.signatures.push(hrEmployeeSignature(e));
        hrEvent('signed', d.id, e.id, e.fullName);
        complete(d);
      });
      refresh();
      return HttpResponse.json({ signed: pending.map((d) => d.id), documents: pending.map((d) => hrPortalDoc(d, e)) });
    }),
  ];
}

export const hrEdoHandlers = [
  http.get(url('/hr-edo/doc-types'), () => HttpResponse.json(hrDocTypesDb)),

  // ── Сотрудники ──
  http.get(url('/hr-edo/employees'), ({ request }) => {
    refresh();
    const sp = new URL(request.url).searchParams;
    const q = (sp.get('q') ?? '').toLowerCase();
    const items = hrEmployeesDb.filter(
      (e) =>
        (!q || e.fullName.toLowerCase().includes(q)) &&
        (!sp.get('edoStatus') || e.edoStatus === sp.get('edoStatus')) &&
        (!sp.get('employmentType') || e.employmentType === sp.get('employmentType')),
    );
    return HttpResponse.json(page(items, request));
  }),
  http.post(url('/hr-edo/employees'), async ({ request }) => {
    const body = (await request.json()) as Partial<HrEmployee>;
    const phone = normPhone(body.phone);
    const e: HrEmployee = {
      id: hrNewId('hre'),
      fullName: body.fullName ?? '',
      position: body.position ?? '',
      employmentType: body.employmentType ?? 'ТК РФ',
      phone,
      phoneMasked: mask(phone),
      email: body.email ?? null,
      hiredAt: body.hiredAt ?? null,
      userId: body.userId ?? null,
      candidateId: body.candidateId ?? null,
      status: 'active',
      edoStatus: 'not_invited',
      pendingDocuments: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    hrEmployeesDb.push(e);
    hrEvent('employee_created', null, e.id);
    return HttpResponse.json(e, { status: 201 });
  }),
  http.post(url('/hr-edo/employees/from-candidate/:cid'), ({ params }) => {
    const c = candidatesDb.find((x) => x.id === params.cid);
    if (!c) return err(404, 'not_found', 'Кандидат не найден');
    if (c.status !== 'hired') return err(409, 'candidate_not_hired', 'Оформить можно только кандидата в статусе «Вышел на работу»');
    const exists = hrEmployeesDb.find((e) => e.candidateId === c.id);
    if (exists) return err(409, 'employee_exists', 'Сотрудник по этому кандидату уже заведён', { employeeId: exists.id });
    const phone = normPhone(c.phone);
    const e: HrEmployee = {
      id: hrNewId('hre'),
      candidateId: c.id,
      fullName: c.fullName,
      position: c.role,
      employmentType: c.employmentType,
      phone,
      phoneMasked: mask(phone),
      email: c.email ?? null,
      status: 'active',
      edoStatus: 'not_invited',
      pendingDocuments: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    hrEmployeesDb.push(e);
    return HttpResponse.json(e, { status: 201 });
  }),
  http.get(url('/hr-edo/employees/:id'), ({ params }) => {
    const e = emp(params.id);
    if (!e) return err(404, 'not_found', 'Сотрудник не найден');
    hrTouchEmployee(e);
    return HttpResponse.json(e);
  }),
  http.patch(url('/hr-edo/employees/:id'), async ({ params, request }) => {
    const e = emp(params.id);
    if (!e) return err(404, 'not_found', 'Сотрудник не найден');
    const body = (await request.json()) as Partial<HrEmployee>;
    Object.assign(e, { ...body, phone: body.phone === undefined ? e.phone : normPhone(body.phone) });
    e.phoneMasked = mask(e.phone);
    return HttpResponse.json(e);
  }),
  http.post(url('/hr-edo/employees/:id/invite'), ({ params }) => {
    const e = emp(params.id);
    if (!e) return err(404, 'not_found', 'Сотрудник не найден');
    if (!e.phone) return err(409, 'phone_missing', 'Укажите номер мобильного телефона');
    let d = e.edoConsentDocId ? doc(e.edoConsentDocId) : undefined;
    if (!d) {
      d = {
        id: hrNewId('hrd'),
        employeeId: e.id,
        employeeName: e.fullName,
        typeCode: 'edo_consent_package',
        title: 'Пакет согласия на КЭДО',
        docDate: today(),
        status: 'draft',
        fields: {},
        hasSource: false,
        hasStamped: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        signatures: [],
      };
      hrDocumentsDb.unshift(d);
      freeze(d);
      d.status = 'sent';
      d.sentAt = new Date().toISOString();
      e.edoConsentDocId = d.id;
    }
    e.edoStatus = 'notified';
    hrEvent('notified', d.id, e.id);
    return HttpResponse.json({
      employee: e,
      document: d,
      emailSent: !!e.email,
      portalUrl: e.email ? null : `${window.location.origin}/sign/demo-${e.id}`,
    });
  }),
  http.post(url('/hr-edo/employees/:id/consent'), ({ params }) => {
    const e = emp(params.id);
    const d = e?.edoConsentDocId ? doc(e.edoConsentDocId) : undefined;
    if (!e || !d) return err(409, 'consent_package_missing', 'Сначала сформируйте пакет согласия');
    d.signatures.push({
      id: hrNewId('sig'),
      signerRole: 'employee',
      signerName: e.fullName,
      sigType: 'paper',
      signedAt: new Date().toISOString(),
      hasFile: true,
      isTest: false,
      verification: {},
    });
    d.status = 'signed';
    d.signedAt = new Date().toISOString();
    e.edoStatus = 'consent_signed';
    hrEvent('consent_registered', d.id, e.id);
    return HttpResponse.json(e);
  }),
  http.post(url('/hr-edo/employees/:id/refuse'), ({ params }) => {
    const e = emp(params.id);
    if (!e) return err(404, 'not_found', 'Сотрудник не найден');
    e.edoStatus = 'refused';
    hrEvent('edo_refused', null, e.id);
    return HttpResponse.json(e);
  }),
  http.post(url('/hr-edo/employees/:id/keys/revoke'), ({ params }) => {
    const e = emp(params.id);
    if (!e) return err(404, 'not_found', 'Сотрудник не найден');
    delete hrKeysDb[e.id];
    e.activeKey = null;
    e.edoStatus = 'key_revoked';
    hrEvent('key_revoked', null, e.id);
    return HttpResponse.json(e);
  }),
  http.post(url('/hr-edo/employees/:id/phone'), async ({ params, request }) => {
    const e = emp(params.id);
    if (!e) return err(404, 'not_found', 'Сотрудник не найден');
    const body = (await request.json()) as { phone: string };
    e.phone = normPhone(body.phone);
    e.phoneMasked = mask(e.phone);
    delete hrKeysDb[e.id];
    if (e.edoStatus === 'active') e.edoStatus = 'key_revoked';
    hrEvent('phone_changed', null, e.id);
    return HttpResponse.json(e);
  }),

  // ── Документы ──
  http.get(url('/hr-edo/documents'), ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const q = (sp.get('q') ?? '').toLowerCase();
    const items = hrDocumentsDb.filter(
      (d) =>
        (!sp.get('status') || d.status === sp.get('status')) &&
        (!sp.get('typeCode') || d.typeCode === sp.get('typeCode')) &&
        (!sp.get('employeeId') || d.employeeId === sp.get('employeeId')) &&
        (!q || `${d.title} ${d.number ?? ''} ${d.employeeName}`.toLowerCase().includes(q)),
    );
    return HttpResponse.json(page(items, request));
  }),
  http.post(url('/hr-edo/documents/preview'), async ({ request }) => {
    const body = (await request.json()) as { typeCode: string; fields: Record<string, string> };
    const t = typeOf(body.typeCode);
    const rows = Object.entries(body.fields ?? {})
      .map(([k, v]) => `<tr><td style="color:#5d6570;padding:4px 12px 4px 0">${k}</td><td>${v || '—'}</td></tr>`)
      .join('');
    return new HttpResponse(
      `<!doctype html><html><body style="font-family:sans-serif;padding:32px"><div style="border:1px dashed #b45309;color:#92400e;padding:6px;text-align:center;font-size:12px">ЧЕРНОВИК - ТЕКСТ НА СОГЛАСОВАНИИ У ЮРИСТА</div><h2 style="text-align:center">${t?.title ?? ''}</h2><p style="color:#5d6570">Демо-режим: полный шаблон рендерит бэкенд.</p><table>${rows}</table></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }),
  http.post(url('/hr-edo/documents'), async ({ request }) => {
    const body = (await request.json()) as {
      typeCode: string;
      employeeIds: string[];
      fields: Record<string, unknown>;
      docDate?: string;
      freeze?: boolean;
    };
    const t = typeOf(body.typeCode);
    const created = body.employeeIds.map((eid) => {
      const e = emp(eid);
      const d: HrDocument = {
        id: hrNewId('hrd'),
        employeeId: eid,
        employeeName: e?.fullName ?? '',
        typeCode: body.typeCode,
        title: t?.title ?? body.typeCode,
        docDate: body.docDate ?? today(),
        status: 'draft',
        fields: body.fields,
        hasSource: false,
        hasStamped: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        signatures: [],
      };
      hrDocumentsDb.unshift(d);
      hrEvent('created', d.id, eid);
      if (body.freeze) freeze(d);
      return d;
    });
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post(url('/hr-edo/documents/upload'), async ({ request }) => {
    const fd = await request.formData();
    const e = emp(fd.get('employeeId'));
    const t = typeOf(String(fd.get('typeCode')));
    const d: HrDocument = {
      id: hrNewId('hrd'),
      employeeId: e?.id ?? '',
      employeeName: e?.fullName ?? '',
      typeCode: t?.code ?? '',
      title: String(fd.get('title') || t?.title || 'Документ'),
      docDate: String(fd.get('docDate') || today()),
      status: 'draft',
      fields: {},
      hasSource: false,
      hasStamped: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      signatures: [],
    };
    hrDocumentsDb.unshift(d);
    freeze(d);
    return HttpResponse.json(d, { status: 201 });
  }),
  http.post(url('/hr-edo/documents/send'), async ({ request }) => {
    const { ids } = (await request.json()) as { ids: string[] };
    const items: HrDocument[] = [];
    for (const i of ids) {
      const d = doc(i);
      if (!d) continue;
      const t = typeOf(d.typeCode);
      if (t?.paperOnly) return err(422, 'paper_only', `«${d.title}» ведётся только на бумаге (ч. 3 ст. 22.1 ТК РФ)`);
      if (d.status === 'awaiting_employer')
        return err(409, 'employer_signature_required', `«${d.title}»: сначала нужна подпись работодателя`);
      const e = emp(d.employeeId);
      if (e?.edoStatus !== 'active')
        return err(409, 'employee_not_ready', `${e?.fullName} ещё не получил(а) электронную подпись: сначала согласие на КЭДО`);
      d.status = 'sent';
      d.sentAt = new Date().toISOString();
      d.dueAt = new Date(Date.now() + 7 * 86400_000).toISOString();
      hrEvent('sent', d.id, d.employeeId);
      items.push(d);
    }
    refresh();
    return HttpResponse.json({ items, portalLinks: {} });
  }),
  http.get(url('/hr-edo/documents/:id'), ({ params }) => {
    const d = doc(params.id);
    return d ? HttpResponse.json(d) : err(404, 'not_found', 'Документ не найден');
  }),
  http.get(url('/hr-edo/documents/:id/preview'), ({ params }) => {
    const d = doc(params.id);
    return new HttpResponse(
      `<!doctype html><html><body style="font-family:sans-serif;padding:32px"><h2>${d?.title ?? ''}</h2><p>Черновик (демо-режим)</p></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }),
  http.post(url('/hr-edo/documents/:id/freeze'), ({ params }) => {
    const d = doc(params.id);
    if (!d) return err(404, 'not_found', 'Документ не найден');
    freeze(d);
    return HttpResponse.json(d);
  }),
  http.post(url('/hr-edo/documents/:id/remind'), ({ params }) => {
    const d = doc(params.id);
    if (!d) return err(404, 'not_found', 'Документ не найден');
    hrEvent('notified', d.id, d.employeeId);
    return HttpResponse.json({ items: [d], portalLinks: {} });
  }),
  http.post(url('/hr-edo/documents/:id/cancel'), async ({ params, request }) => {
    const d = doc(params.id);
    if (!d) return err(404, 'not_found', 'Документ не найден');
    d.status = 'cancelled';
    d.cancelReason = ((await request.json()) as { reason: string }).reason;
    hrEvent('cancelled', d.id, d.employeeId);
    return HttpResponse.json(d);
  }),
  http.post(url('/hr-edo/documents/:id/employer-signature'), ({ params }) => {
    const d = doc(params.id);
    if (!d) return err(404, 'not_found', 'Документ не найден');
    d.signatures.unshift({
      id: hrNewId('sig'),
      signerRole: 'employer',
      signerName: 'Генеральный директор',
      sigType: 'ukep',
      signedAt: new Date().toISOString(),
      hasFile: true,
      isTest: true,
      verification: { test: true },
    });
    hrEvent('employer_signed', d.id, d.employeeId);
    complete(d);
    return HttpResponse.json(d);
  }),
  http.post(url('/hr-edo/documents/:id/paper-signed'), ({ params }) => {
    const d = doc(params.id);
    if (!d) return err(404, 'not_found', 'Документ не найден');
    d.signatures.push({
      id: hrNewId('sig'),
      signerRole: 'employee',
      signerName: d.employeeName,
      sigType: 'paper',
      signedAt: new Date().toISOString(),
      hasFile: true,
      isTest: false,
      verification: {},
    });
    hrEvent('paper_signed', d.id, d.employeeId);
    complete(d);
    return HttpResponse.json(d);
  }),
  http.get(url('/hr-edo/documents/:id/file'), ({ params }) => {
    const d = doc(params.id);
    return new HttpResponse(hrMockPdf(d?.number ?? 'document'), { headers: { 'Content-Type': 'application/pdf' } });
  }),
  http.get(url('/hr-edo/documents/:id/signatures/:sid/file'), () =>
    new HttpResponse(new Blob(['LG-TEST-SIGNATURE']), { headers: { 'Content-Type': 'application/pkcs7-signature' } }),
  ),
  http.get(url('/hr-edo/documents/:id/events'), ({ params }) =>
    HttpResponse.json([...hrEventsDb].reverse().filter((e) => e.documentId === params.id)),
  ),
  http.get(url('/hr-edo/events/verify'), () => HttpResponse.json({ ok: true, checked: hrEventsDb.length })),
  http.get(url('/hr-edo/events'), ({ request }) => HttpResponse.json(page(hrEventsDb, request))),
  http.get(url('/hr-edo/dev/sms-outbox'), () => HttpResponse.json([])),

  // ── Мои документы (мок-пользователь u1) ──
  http.get(url('/hr-edo/my'), () => {
    const e = hrEmployeesDb.find((x) => x.userId === 'u1');
    return HttpResponse.json({ employee: e ? selfDto(e) : null });
  }),
  ...employeeHandlers('/hr-edo/my', () => hrEmployeesDb.find((x) => x.userId === 'u1')),

  // ── Публичный портал ──
  http.get(url('/sign/session'), () => {
    const e = emp(portalEmployeeId);
    return e ? HttpResponse.json(selfDto(e)) : err(401, 'portal_session_required', 'Войдите по ссылке из письма');
  }),
  http.post(url('/sign/session/logout'), () => {
    portalEmployeeId = null;
    return HttpResponse.json({ ok: true });
  }),
  ...employeeHandlers('/sign/session', () => emp(portalEmployeeId)),
  http.get(url('/sign/:token'), ({ params }) => {
    const e = emp(String(params.token).replace(/^demo-/, '')) ?? hrEmployeesDb[1];
    return HttpResponse.json({
      employeeName: e.fullName.split(' ').slice(1, 2).join(' ') + ' ' + e.fullName[0] + '.',
      companyName: 'ООО «ЛГ Интеграция»',
      phoneMasked: e.phoneMasked,
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    });
  }),
  http.post(url('/sign/:token/login/otp'), ({ params }) => {
    const e = emp(String(params.token).replace(/^demo-/, '')) ?? hrEmployeesDb[1];
    return HttpResponse.json(hrChallenge([], e.phoneMasked ?? ''));
  }),
  http.post(url('/sign/:token/login/verify'), async ({ params, request }) => {
    const e = emp(String(params.token).replace(/^demo-/, '')) ?? hrEmployeesDb[1];
    const body = (await request.json()) as { code: string };
    if (body.code !== HR_MOCK_CODE) return err(422, 'otp_invalid', 'Неверный код', { attemptsLeft: 4 });
    portalEmployeeId = e.id;
    hrEvent('portal_login', null, e.id, e.fullName);
    return HttpResponse.json(selfDto(e));
  }),
];
