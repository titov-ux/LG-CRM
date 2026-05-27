/**
 * Извлечение текста из .txt-файла.
 *
 * Браузерный `TextDecoder('utf-8', { fatal: true })` валится на cp1251 →
 * пробуем сначала UTF-8 (большинство современных файлов), при ошибке
 * откатываемся на windows-1251 (наследие Word/HH RU-экспортов).
 *
 * Дополнительно: если декод формально прошёл, но в результате много
 * U+FFFD / управляющих символов — сравниваем с cp1251 и берём лучший.
 */

// «Мусорные» символы: U+FFFD (replacement-метка декодера) и control chars
// кроме \t \n \r (на них опираемся, чтобы понять, кто дал кашу).
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

export async function extractTxtText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  // 1. Строгий UTF-8 — если файл реально UTF-8, получим текст без потерь.
  const strict = tryDecode(buffer, 'utf-8', true);
  if (strict !== null) {
    if (ratioOfBad(strict) < 0.02) return strict;
    // formal UTF-8, но много мусора — проверим cp1251.
    const cp = tryDecode(buffer, 'windows-1251', false);
    if (cp && ratioOfBad(cp) < ratioOfBad(strict)) return cp;
    return strict;
  }

  // 2. Не UTF-8 → пробуем cp1251 (Windows-кодировка для русского).
  const cp1251 = tryDecode(buffer, 'windows-1251', false);
  if (cp1251 !== null) return cp1251;

  // 3. Последний шанс — нестрогий UTF-8 с заменой на U+FFFD.
  return tryDecode(buffer, 'utf-8', false) ?? '';
}
