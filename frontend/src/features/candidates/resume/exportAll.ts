/**
 * Массовая выгрузка резюме: все кандидаты базы (включая архив) → .docx в
 * фирменном шаблоне → один ZIP-архив. Кнопка доступна только администратору
 * (см. CandidatesDatabasePage).
 *
 * ZIP собираем сами, без сжатия (метод «stored»): .docx уже сжат внутри,
 * а отдельная зависимость ради этого не нужна.
 */
import { candidatesApi } from '@/api/candidates';
import type { Candidate } from '@/api/types';
import { generateResumeDocxBlob, resumeFileName } from './generateDocx';

// В базе может быть больше 1000 кандидатов — тянем постранично, по 100
// полных резюме на страницу.
const EXPORT_PAGE_SIZE = 100;

export interface ExportProgress {
  done: number;
  total: number;
}

export interface ExportResult {
  exported: number;
  /** ФИО кандидатов, чьё резюме не удалось собрать. */
  failed: string[];
}

// ---- CRC32 + ZIP (stored) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function buildZip(entries: ZipEntry[], now = new Date()): Blob {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.length;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // имена в UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, e.data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);

    offset += 30 + name.length + size;
  }

  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], {
    type: 'application/zip',
  });
}

// ---- Выгрузка ----

async function fetchAllCandidates(): Promise<Candidate[]> {
  const byId = new Map<string, Candidate>();
  let page = 1;
  // Страхуемся от бесконечного цикла: 500 страниц × 200 = 100 000 кандидатов.
  while (page <= 500) {
    // Админский эндпоинт: только он отдаёт резюме пачкой (GET /candidates — без них).
    const res = await candidatesApi.exportPage(page, EXPORT_PAGE_SIZE);
    res.items.forEach((c) => byId.set(c.id, c));
    if (res.items.length === 0 || page * EXPORT_PAGE_SIZE >= res.total) break;
    page += 1;
  }
  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = name.slice(0, dot);
  const ext = name.slice(dot);
  let i = 2;
  while (used.has(`${base}_${i}${ext}`)) i += 1;
  const next = `${base}_${i}${ext}`;
  used.add(next);
  return next;
}

/** Скачивает ZIP со всеми резюме базы. Возвращает число выгруженных и ошибки. */
export async function exportAllResumes(
  onProgress?: (p: ExportProgress) => void,
): Promise<ExportResult> {
  const candidates = await fetchAllCandidates();
  const total = candidates.length;
  const entries: ZipEntry[] = [];
  const failed: string[] = [];
  const used = new Set<string>();

  onProgress?.({ done: 0, total });
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    try {
      const blob = await generateResumeDocxBlob(c);
      entries.push({
        name: uniqueName(resumeFileName(c, 'docx'), used),
        data: new Uint8Array(await blob.arrayBuffer()),
      });
    } catch {
      failed.push(c.fullName);
    }
    onProgress?.({ done: i + 1, total });
  }

  if (entries.length > 0) {
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(buildZip(entries));
    const a = document.createElement('a');
    a.href = url;
    a.download = `Резюме_кандидатов_${stamp}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return { exported: entries.length, failed };
}
