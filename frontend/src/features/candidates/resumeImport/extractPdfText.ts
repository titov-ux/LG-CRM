/**
 * Извлечение текста из PDF на стороне клиента через pdfjs-dist.
 *
 * Библиотека — bundled-зависимость, но подгружается лениво (dynamic
 * import → отдельный чанк Vite), поэтому основной бандл не растёт.
 * Раньше грузили с cdn.jsdelivr.net, но CDN недоступен у части
 * пользователей (блокировки/корпоративные сети) — «Не удалось обработать
 * файл» на любой документ. Теперь чанк и worker отдаются с нашего домена.
 */

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
      // Оба импорта ленивые: Vite выносит pdfjs в отдельный чанк, а worker
      // (?url) — в ассет; оба отдаются с нашего домена, без внешних CDN.
      // legacy-сборка: без top-level await (не проходит дефолтный target Vite)
      // и совместима со старыми Safari.
      const [mod, worker] = await Promise.all([
        import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as Promise<PdfJsLib>,
        import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
      ]);
      mod.GlobalWorkerOptions.workerSrc = worker.default;
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
