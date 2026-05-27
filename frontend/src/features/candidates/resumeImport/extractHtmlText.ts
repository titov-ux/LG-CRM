/**
 * Извлечение plain-текста из HTML-файла на стороне клиента.
 *
 * HTML-резюме обычно получаются через «Сохранить страницу как…» из браузера
 * (например, профиль на LinkedIn / HH) либо экспорт из Word в HTML. В обоих
 * случаях нам нужен только видимый текст с разумной разбивкой на строки —
 * рендер таблиц/стилей не нужен.
 *
 * Алгоритм:
 *  1) ArrayBuffer → строка. Сначала UTF-8 strict, при провале — windows-1251.
 *     Если в декодированном тексте найден `<meta charset="...">` с другой
 *     кодировкой — перекодируем повторно (HH/Word любят cp1251).
 *  2) DOMParser → DOM. Парсинг строго оффлайн: внешние ресурсы не подгружаются.
 *  3) Выкидываем script/style/noscript/head/iframe/svg — текста там нет, а
 *     мусора может быть много (JS-код / CSS / SVG-paths).
 *  4) Обход дерева с явной вставкой `\n` после блочных элементов и `<br>`.
 *     Иначе всё схлопывается в один абзац и регэкспы AI-парсинга работают плохо.
 *
 * Реализовано без внешних зависимостей — DOMParser встроен в браузер.
 */

// «Мусорные» символы: U+FFFD (replacement-метка) + control-кроме \t\n\r.
// Тот же набор, что в extractTxtText — нужно сравнивать качество декода.
// eslint-disable-next-line no-control-regex
const NON_PRINTABLE_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F�]/g;

function ratioOfBad(text: string): number {
  if (!text) return 0;
  const matches = text.match(NON_PRINTABLE_RE);
  return matches ? matches.length / text.length : 0;
}

function tryDecode(buffer: ArrayBuffer, encoding: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * Достаём значение `charset` из meta-тегов внутри `<head>`. Поддерживаем оба
 * варианта объявления — HTML5 (`<meta charset="...">`) и legacy
 * (`<meta http-equiv="content-type" content="text/html; charset=...">`).
 *
 * Возвращаем нормализованное имя, понятное TextDecoder (utf-8/windows-1251/…),
 * либо null если ничего не нашлось.
 */
function detectMetaCharset(html: string): string | null {
  // Берём первые ~4 КБ — meta charset по спеке должна быть в первом килобайте.
  const head = html.slice(0, 4096);

  const charsetMatch = head.match(/<meta[^>]+charset\s*=\s*['"]?([\w-]+)/i);
  if (charsetMatch?.[1]) return charsetMatch[1].toLowerCase();

  const contentMatch = head.match(
    /<meta[^>]+http-equiv\s*=\s*['"]?content-type[^>]*content\s*=\s*['"][^'"]*charset\s*=\s*([\w-]+)/i,
  );
  if (contentMatch?.[1]) return contentMatch[1].toLowerCase();

  return null;
}

/**
 * Нормализуем редкие алиасы (cp1251, win-1251) к каноничному имени TextDecoder.
 * Если имя ему незнакомо — `TextDecoder` бросит RangeError, поэтому маппим вручную.
 */
function normalizeCharset(name: string): string {
  const lower = name.toLowerCase();
  if (lower === 'cp1251' || lower === 'win-1251' || lower === 'windows1251') {
    return 'windows-1251';
  }
  if (lower === 'utf8') return 'utf-8';
  return lower;
}

function decodeHtmlBuffer(buffer: ArrayBuffer): string {
  // 1) Строгий UTF-8 — самый частый случай (современные браузеры/экспорты).
  const strict = tryDecode(buffer, 'utf-8', true);
  if (strict !== null) {
    // Если внутри HTML объявлена другая кодировка (например, cp1251 у Word),
    // переразбираем тем же буфером с указанной кодировкой.
    const declared = detectMetaCharset(strict);
    if (declared && declared !== 'utf-8' && declared !== 'utf8') {
      const reDecoded = tryDecode(buffer, normalizeCharset(declared), false);
      if (reDecoded !== null) return reDecoded;
    }
    return strict;
  }

  // 2) UTF-8 не прошёл строгий режим → пробуем cp1251 (русский Word/HH).
  const cp1251 = tryDecode(buffer, 'windows-1251', false);
  if (cp1251 !== null) {
    // Может быть, в самом файле явно объявлен другой charset — посмотрим.
    const declared = detectMetaCharset(cp1251);
    if (declared && declared !== 'windows-1251') {
      const reDecoded = tryDecode(buffer, normalizeCharset(declared), false);
      if (reDecoded !== null && ratioOfBad(reDecoded) < ratioOfBad(cp1251)) {
        return reDecoded;
      }
    }
    return cp1251;
  }

  // 3) Последний шанс — нестрогий UTF-8 с заменой на U+FFFD.
  return tryDecode(buffer, 'utf-8', false) ?? '';
}

// Элементы, после которых нужен перенос строки при обходе DOM.
// Берём типичный набор block-уровневых тегов + ячейки таблиц и список-айтемы.
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'div', 'dd', 'dl', 'dt',
  'figure', 'figcaption', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

// Не текстовые узлы — выкидываем целиком, чтобы в результат не утекал
// исходник JS/CSS/SVG-разметки.
const STRIPPED_TAGS = ['script', 'style', 'noscript', 'iframe', 'svg', 'head'];

function walk(node: Node, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text) out.push(text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  // <br> — особый случай: сам по себе чистый перенос строки.
  if (tag === 'br') {
    out.push('\n');
    return;
  }

  for (const child of Array.from(el.childNodes)) {
    walk(child, out);
  }

  if (BLOCK_TAGS.has(tag)) {
    out.push('\n');
  }
}

/**
 * Чистит итоговый текст: схлопывает пробельные подряд + не более двух
 * пустых строк подряд, обрезает trailing whitespace.
 */
function tidy(raw: string): string {
  return raw
    // \r → ничего, \t → пробел, NBSP → обычный пробел
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/ /g, ' ')
    // несколько пробелов подряд внутри строки → один
    .replace(/[ ]{2,}/g, ' ')
    // обрезаем пробелы по краям каждой строки
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    // не больше двух \n подряд (визуальная пустая строка)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractHtmlText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const html = decodeHtmlBuffer(buffer);
  if (!html) return '';

  // DOMParser в браузере не выполняет <script> и не подгружает ресурсы —
  // это ровно то, что нужно: безопасный оффлайновый парсинг.
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Удаляем теги, в которых текст не несёт смысла (или мешает).
  for (const tag of STRIPPED_TAGS) {
    doc.querySelectorAll(tag).forEach((el) => el.remove());
  }

  const out: string[] = [];
  walk(doc.body ?? doc.documentElement, out);

  return tidy(out.join(''));
}
