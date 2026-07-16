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
  /** Ширина глифа в PDF-единицах — нужна, чтобы понять, есть ли пробел между items. */
  width?: number;
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

/** Схлопнуть горизонтальные пробелы (в т.ч. NBSP) в один обычный пробел. */
function normalizeLine(raw: string): string {
  return raw.replace(/[ \t\u00a0]+/g, ' ').trim();
}

/**
 * Считывает File → ArrayBuffer → текст по страницам, склеенный в одну строку
 * с разделителями `\n` между смысловыми строками PDF.
 *
 * Алгоритм: items в порядке pdfjs (top-to-bottom, left-to-right). Смена Y →
 * новая строка. Пробел между словами вставляем только если между глифами есть
 * горизонтальный зазор И сам item не начинается с пробела/пунктуации.
 *
 * Важно: раньше после КАЖДОГО item безусловно дописывался `' '`. У HH-PDF
 * (cairo) пробелы уже приходят отдельными items → получалось
 * «Опыт   работы», YandexGPT/сплиттер плохо переваривали такой текст.
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
    let prevWidth = 0;
    let current = '';

    const flush = () => {
      const line = normalizeLine(current);
      if (line) lines.push(line);
      current = '';
      prevY = null;
      prevX = null;
      prevWidth = 0;
    };

    for (const item of content.items) {
      const y = item.transform?.[5];
      const x = item.transform?.[4];
      if (y === undefined || x === undefined) continue;

      const str = item.str ?? '';
      const width = typeof item.width === 'number' ? item.width : 0;

      // PDF у разных генераторов хранит координаты в разной шкале: у части
      // документов межстрочный шаг меньше 1. Поэтому используем меньший порог.
      const yChanged = prevY !== null && Math.abs(y - prevY) > 0.5;
      // Крупный прыжок X назад на той же строке — новая колонка / перенос.
      // Маленькие «откаты» у cairo (служебные пустые items) игнорируем.
      const xWrapped =
        prevX !== null && prevY !== null && Math.abs(y - prevY) <= 0.5 && x + 20 < prevX;

      if (yChanged || xWrapped) {
        flush();
      }

      if (str) {
        if (current) {
          const gap = prevX !== null ? x - (prevX + prevWidth) : 0;
          const needsSpace =
            gap > 1.2 &&
            !/\s$/.test(current) &&
            !/^\s/.test(str) &&
            !/^[,.:;!?)\]%}»]/.test(str);
          if (needsSpace) current += ' ';
        }
        current += str;
      }

      // hasEOL у pdfjs выставляется на границе блока — тоже трактуем как перенос строки.
      if (item.hasEOL) {
        flush();
        continue;
      }

      // Пустые items не сдвигают «курсор» — иначе ломается расчёт gap.
      if (str || width > 0) {
        prevY = y;
        prevX = x;
        prevWidth = width;
      } else if (prevY === null) {
        prevY = y;
        prevX = x;
        prevWidth = 0;
      }
    }
    if (current) flush();
  }

  return lines.join('\n');
}
