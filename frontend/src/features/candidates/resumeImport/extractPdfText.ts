/**
 * Извлечение текста из PDF на стороне клиента через pdfjs-dist.
 *
 * Сознательно грузим pdfjs ESM-сборку с jsDelivr через dynamic import
 * вместо bundled-зависимости: библиотека ~2 МБ + worker, ставить ради
 * редкой операции «распознать резюме» неэффективно. Кэшируется браузером
 * после первого открытия модалки.
 *
 * Если интернета нет — выбрасывает ошибку, форма ловит её и показывает
 * пользователю «не удалось загрузить распознаватель PDF».
 */

const PDFJS_VERSION = '4.0.379';
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

interface PdfTextItem {
  str: string;
  /** Y-координата (transform[5]) — используется для разбивки на строки. */
  transform: [number, number, number, number, number, number];
  hasEOL?: boolean;
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(args: { data: ArrayBuffer }): { promise: Promise<PdfDocument> };
}

let pdfjsPromise: Promise<PdfJsLib> | null = null;

function loadPdfJs(): Promise<PdfJsLib> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // /* @vite-ignore */ — у Vite иначе не пройдёт резолв CDN-URL.
      const mod = (await import(/* @vite-ignore */ PDFJS_URL)) as PdfJsLib;
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    })().catch((err) => {
      pdfjsPromise = null; // позволяем повторить попытку при следующем клике
      throw err;
    });
  }
  return pdfjsPromise;
}

/**
 * Считывает File → ArrayBuffer → текст по страницам, склеенный в одну строку
 * с разделителями `\n` между смысловыми строками PDF.
 *
 * Алгоритм: проходим items в порядке, который вернул pdfjs (близко к
 * top-to-bottom, left-to-right). Каждое изменение Y → перенос строки.
 * Это даёт пригодный для regex-парсинга вид документа.
 */
export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const lines: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    let prevY: number | null = null;
    let prevX: number | null = null;
    let current = '';

    for (const item of content.items) {
      const y = item.transform?.[5];
      const x = item.transform?.[4];
      if (y === undefined || x === undefined) continue;

      // PDF у разных генераторов хранит координаты в разной шкале: у части
      // документов межстрочный шаг меньше 1. Поэтому используем меньший порог.
      const yChanged = prevY !== null && Math.abs(y - prevY) > 0.5;
      // Дополнительный эвристический перенос: если X резко "прыгает назад",
      // обычно началась новая строка (или новый блок в колонке).
      const xWrapped = prevX !== null && x + 2 < prevX;
      if (yChanged || xWrapped) {
        if (current.trim()) lines.push(current.trim());
        current = '';
      }

      current += `${item.str} `;
      // hasEOL у pdfjs выставляется на границе блока — тоже трактуем как перенос строки.
      if (item.hasEOL) {
        if (current.trim()) lines.push(current.trim());
        current = '';
        prevY = null;
        prevX = null;
        continue;
      }
      prevY = y;
      prevX = x;
    }
    if (current.trim()) lines.push(current.trim());
  }

  return lines.join('\n');
}
