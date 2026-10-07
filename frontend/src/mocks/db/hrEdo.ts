// MSW-«база» кадрового ЭДО. Упрощённая имитация бэкенда (backend/app/modules/hr_edo):
// статусы и переходы те же, криптография и SMS — заглушки (код всегда 123456,
// см. DevSmsHint.MOCK_OTP_CODE). Состояние живёт до перезагрузки вкладки.

import type {
  HrChallenge,
  HrDocStatus,
  HrDocType,
  HrDocTypeField,
  HrDocument,
  HrEmployee,
  HrEvent,
  HrPortalDocument,
  HrSignature,
  HrSigningKey,
} from '@/api/hrEdo';

export const HR_MOCK_CODE = '123456';

const f = (
  key: string,
  label: string,
  type: HrDocTypeField['type'] = 'text',
  extra: Partial<HrDocTypeField> = {},
): HrDocTypeField => ({ key, label, type, required: false, options: [], ...extra });

const LABOR: HrDocType['employeeSig'] = ['unep_lg', 'gosklyuch', 'ukep', 'paper'];

function t(p: Partial<HrDocType> & Pick<HrDocType, 'code' | 'title' | 'numberPrefix'>): HrDocType {
  return {
    contour: 'labor',
    employeeAction: 'sign',
    employeeSig: LABOR,
    employerSig: 'none',
    signOrder: 'employee_first',
    retentionYears: 50,
    uploadOnly: false,
    paperOnly: false,
    strictGroup: false,
    stage: 1,
    description: '',
    fields: [],
    ...p,
  };
}

const POSITION = f('position', 'Должность', 'text', { required: true, defaultFrom: 'employee.position' });
const START = f('start_date', 'Дата начала работы', 'date', { required: true, defaultFrom: 'employee.hired_at' });
const SALARY = f('salary', 'Оклад, ₽ в месяц (до вычета НДФЛ)', 'money', { required: true, placeholder: '150 000' });
const VAC_TYPE = f('vacation_type', 'Вид отпуска', 'select', {
  required: true,
  default: 'ежегодный оплачиваемый',
  options: ['ежегодный оплачиваемый', 'без сохранения заработной платы', 'учебный'],
});

export const hrDocTypesDb: HrDocType[] = [
  t({ code: 'edo_consent_package', title: 'Пакет согласия на КЭДО', numberPrefix: 'СОГ', employeeSig: ['gosklyuch', 'ukep', 'paper'] }),
  t({
    code: 'employment_contract',
    title: 'Трудовой договор',
    numberPrefix: 'ТД',
    employerSig: 'ukep',
    signOrder: 'employer_first',
    strictGroup: true,
    fields: [
      POSITION,
      START,
      f('contract_kind', 'Срок договора', 'select', { required: true, default: 'бессрочный', options: ['бессрочный', 'срочный'] }),
      SALARY,
      f('probation', 'Испытательный срок', 'text', { default: '3 месяца' }),
      f('work_place', 'Место работы', 'select', { required: true, default: 'дистанционно', options: ['дистанционно', 'офис', 'гибрид'] }),
    ],
  }),
  t({
    code: 'order_hire',
    title: 'Приказ о приёме на работу',
    numberPrefix: 'ПР',
    employeeAction: 'acknowledge',
    employerSig: 'ukep',
    signOrder: 'employer_first',
    fields: [POSITION, START, SALARY, f('contract_number', 'Номер трудового договора', 'text', { required: true })],
  }),
  t({
    code: 'vacation_request',
    title: 'Заявление на отпуск',
    numberPrefix: 'ЗО',
    retentionYears: 5,
    fields: [
      VAC_TYPE,
      f('vacation_start', 'Первый день отпуска', 'date', { required: true }),
      f('vacation_end', 'Последний день отпуска', 'date', { required: true }),
      f('vacation_days', 'Календарных дней', 'number', { required: true }),
    ],
  }),
  t({
    code: 'lna_acknowledgment',
    title: 'Ознакомление с ЛНА',
    numberPrefix: 'ЛНА',
    employeeAction: 'acknowledge',
    fields: [
      f('lna_title', 'Локальный нормативный акт', 'text', { required: true }),
      f('lna_date', 'Дата утверждения ЛНА', 'date', { required: true }),
    ],
  }),
  t({ code: 'pd_consent', title: 'Согласие на обработку ПДн', numberPrefix: 'ПДН', uploadOnly: true, retentionYears: 3 }),
  t({
    code: 'order_dismissal',
    title: 'Приказ об увольнении',
    numberPrefix: 'ПУ',
    uploadOnly: true,
    paperOnly: true,
    employeeSig: ['paper'],
    description: 'Только на бумаге (ч. 3 ст. 22.1 ТК РФ).',
  }),
];

const now = () => new Date().toISOString();
let seq = 1;
const id = (p: string) => `${p}-${seq++}`;

export const hrEmployeesDb: HrEmployee[] = [
  {
    id: 'hre-1',
    userId: 'u1',
    userName: 'Алексей Титов',
    fullName: 'Титов Алексей Владимирович',
    position: 'Генеральный директор',
    employmentType: 'ТК РФ',
    phone: '+79990001122',
    phoneMasked: '+7 ••• ••• 11-22',
    email: 'titov@lg-integration.ru',
    status: 'active',
    edoStatus: 'consent_signed',
    edoConsentDocId: 'hrd-consent-1',
    pendingDocuments: 0,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'hre-2',
    fullName: 'Петров Пётр Петрович',
    position: 'Java-разработчик',
    employmentType: 'ТК РФ',
    phone: '+79991234567',
    phoneMasked: '+7 ••• ••• 45-67',
    email: 'petrov@example.com',
    hiredAt: '2026-10-01',
    status: 'active',
    edoStatus: 'notified',
    edoConsentDocId: 'hrd-consent-2',
    pendingDocuments: 0,
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: 'hre-3',
    fullName: 'Сидоров Игорь Олегович',
    position: 'DevOps-инженер',
    employmentType: 'ТК РФ',
    phone: '+79035556677',
    phoneMasked: '+7 ••• ••• 66-77',
    status: 'active',
    edoStatus: 'not_invited',
    pendingDocuments: 0,
    createdAt: now(),
    updatedAt: now(),
  },
];

function consentDoc(docId: string, emp: HrEmployee, status: HrDocStatus, n: number): HrDocument {
  return {
    id: docId,
    employeeId: emp.id,
    employeeName: emp.fullName,
    typeCode: 'edo_consent_package',
    title: 'Пакет согласия на КЭДО',
    number: `СОГ-2026-000${n}`,
    docDate: now().slice(0, 10),
    status,
    fields: {},
    contentSha256: 'a'.repeat(64),
    contentStreebog256: 'b'.repeat(64),
    frozenAt: now(),
    sentAt: now(),
    signedAt: status === 'signed' ? now() : null,
    hasSource: true,
    hasStamped: false,
    createdAt: now(),
    updatedAt: now(),
    signatures:
      status === 'signed'
        ? [
            {
              id: id('sig'),
              signerRole: 'employee',
              signerName: emp.fullName,
              sigType: 'paper',
              signedAt: now(),
              hasFile: true,
              isTest: false,
              verification: {},
            },
          ]
        : [],
  };
}

export const hrDocumentsDb: HrDocument[] = [
  consentDoc('hrd-consent-1', hrEmployeesDb[0], 'signed', 1),
  consentDoc('hrd-consent-2', hrEmployeesDb[1], 'sent', 2),
];

export const hrEventsDb: HrEvent[] = [];
export const hrKeysDb: Record<string, HrSigningKey> = {};
export const hrCounters: Record<string, number> = { СОГ: 2 };

export function hrEvent(kind: string, docId: string | null, empId: string | null, actorName = 'Вы') {
  const prev = hrEventsDb[0]?.hash ?? '0'.repeat(64);
  const n = hrEventsDb.length + 1;
  const doc = hrDocumentsDb.find((d) => d.id === docId);
  const emp = hrEmployeesDb.find((e) => e.id === empId);
  hrEventsDb.unshift({
    id: n,
    documentId: docId,
    documentTitle: doc ? doc.title : null,
    employeeId: empId,
    employeeName: emp?.fullName ?? null,
    kind,
    actorType: 'user',
    actorName,
    ip: '127.0.0.1',
    payload: {},
    createdAt: now(),
    prevHash: prev,
    hash: (n.toString(16) + prev).slice(0, 64).padEnd(64, 'f'),
  });
}

export function hrTouchEmployee(emp: HrEmployee) {
  emp.pendingDocuments = hrDocumentsDb.filter(
    (d) => d.employeeId === emp.id && (d.status === 'sent' || d.status === 'viewed'),
  ).length;
  emp.activeKey = hrKeysDb[emp.id] ?? null;
  emp.updatedAt = now();
}

export function hrNextNumber(prefix: string): string {
  hrCounters[prefix] = (hrCounters[prefix] ?? 0) + 1;
  return `${prefix}-2026-${String(hrCounters[prefix]).padStart(4, '0')}`;
}

export function hrNewId(prefix: string) {
  return id(prefix);
}

export function hrChallenge(documentIds: string[] = [], phoneMasked = '+7 ••• ••• 45-67'): HrChallenge {
  return {
    challengeId: id('ch'),
    phoneMasked,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    resendAfter: 60,
    documentIds,
  };
}

export function hrMakeKey(emp: HrEmployee): HrSigningKey {
  const hex = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
  const key: HrSigningKey = {
    id: id('key'),
    fingerprint: hex,
    algorithm: 'GOST R 34.10-2012 256 (тестовая подпись)',
    issuedAt: now(),
    phoneMasked: emp.phoneMasked ?? '',
    isTest: true,
  };
  hrKeysDb[emp.id] = key;
  return key;
}

export function hrEmployeeSignature(emp: HrEmployee): HrSignature {
  const key = hrKeysDb[emp.id];
  return {
    id: id('sig'),
    signerRole: 'employee',
    signerName: emp.fullName,
    sigType: 'unep_lg',
    signedAt: now(),
    tspTime: now(),
    fingerprint: key?.fingerprint ?? null,
    phoneMasked: emp.phoneMasked,
    hasFile: true,
    isTest: true,
    verification: { test: true },
  };
}

export function hrPortalDoc(d: HrDocument, emp: HrEmployee): HrPortalDocument {
  const type = hrDocTypesDb.find((x) => x.code === d.typeCode);
  const unep = !!type?.employeeSig.includes('unep_lg');
  return {
    id: d.id,
    typeCode: d.typeCode,
    title: d.title,
    number: d.number,
    docDate: d.docDate,
    status: d.status,
    employeeAction: type?.employeeAction ?? 'none',
    signMethod: type?.employeeAction === 'none' ? 'none' : unep ? 'unep_lg' : 'external',
    canSign: unep && ['sent', 'viewed'].includes(d.status) && emp.edoStatus === 'active',
    dueAt: d.dueAt,
    sentAt: d.sentAt,
    signedAt: d.signedAt,
    viewedAt: d.viewedAt,
    contentStreebog256: d.contentStreebog256,
    signatures: d.signatures,
  };
}

/** Минимальный валидный PDF (ASCII-текст) — для pdfjs в мок-режиме. */
export function hrMockPdf(title: string): Blob {
  const text = title.replace(/[^\x20-\x7e]/g, '').trim() || 'HR document';
  const lines = [`MOCK HR-EDO DOCUMENT`, text, 'Demo mode: real PDF is rendered by the backend.'];
  const content = lines
    .map((l, i) => `BT /F1 ${i === 0 ? 18 : 12} Tf 60 ${760 - i * 30} Td (${l.replace(/[()\\]/g, '')}) Tj ET`)
    .join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([body], { type: 'application/pdf' });
}
