/**
 * Извлечение plain-текста из RTF-файла, всё на клиенте.
 *
 * RTF — это ASCII-документ с контрольными словами `\xxx` и группами
 * `{...}`. Полноценный рендер таблиц/стилей нам не нужен — задача только
 * вытащить текст для последующего AI-парсинга, поэтому реализован
 * минимальный совместимый со спецификацией 1.9.1 парсер:
 *
 *  • Группы `{...}` — стек, наследует charset/ucSkip;
 *  • Деструктивные группы `{\*\xxx ...}` — пропускаются целиком, чтобы не
 *    тащить в текст содержимое font-table / colortbl / info / listtable /
 *    pict и пр.;
 *  • `ሴ?` — Unicode-символ (signed 16-bit) + skip ucSkip байт
 *    fallback'а; `\uc1` управляет шириной skip;
 *  • `\'xx` — одиночный байт в текущей ANSI-кодировке (обычно cp1251 для
 *    русских резюме, переключается через `\ansicpg1251`);
 *  • `\par`, `\line`, `\sect`, `\page` → `\n`; `\tab` → `\t`;
 *  • `\\`, `\{`, `\}` — экранированные литералы.
 *
 * Реализовано без внешних зависимостей: RTF-парсеров под браузер мало и
 * все довольно тяжёлые, а нам достаточно ~150 строк.
 */

interface GroupState {
  /** Деструктивная (destination) группа, текст которой не идёт в результат. */
  ignored: boolean;
  /** Сколько байт fallback'а пропустить после `\u…`. По умолчанию 1, меняется `\ucN`. */
  ucSkip: number;
  /** Текущая ANSI-кодировка (1251 для русского). */
  charset: number;
  /**
   * Когда встретили `\*`, следующее неизвестное контрольное слово делает
   * группу ignored. RTF использует это для расширений: `{\*\someExt ...}`.
   */
  starPending: boolean;
}

/** Контрольные слова — деструктивные группы, текст которых не нужен. */
const IGNORED_DESTINATIONS = new Set([
  'fonttbl',
  'filetbl',
  'colortbl',
  'stylesheet',
  'listtable',
  'listoverridetable',
  'revtbl',
  'rsidtbl',
  'mmathPr',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'info',
  'author',
  'operator',
  'company',
  'title',
  'subject',
  'keywords',
  'comment',
  'doccomm',
  'creatim',
  'revtim',
  'printim',
  'buptim',
  'pict',
  'shppict',
  'nonshppict',
  'objdata',
  'objclass',
  'objname',
  'result',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'ftnsep',
  'ftnsepc',
  'ftncn',
  'aftnsep',
  'aftnsepc',
  'aftncn',
  'xmlnstbl',
  'generator',
  'mailmerge',
  'fldinst',
  'bkmkstart',
  'bkmkend',
  'panose',
  'falt',
  'fontemb',
  'fontfile',
]);

/** Контрольные слова, выводящие пробельный/перенос. */
const WHITESPACE_WORDS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n\n',
  page: '\n\n',
  pard: '',
  plain: '',
  tab: '\t',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
};

/** Символьные control words (\~ non-break-space, \_ non-break-hyphen). */
const SYMBOLIC_WORDS: Record<string, string> = {
  '~': ' ',
  '-': '',
  _: '‑',
};

const TEXT_DECODERS = new Map<number, TextDecoder>();

function decodeAnsiByte(byte: number, charset: number): string {
  let decoder = TEXT_DECODERS.get(charset);
  if (!decoder) {
    // 1251 — кириллица, 1252 — latin1, 437/850 — старый DOS. Браузеры поддерживают
    // основные cp1251/1252. Если кодировка незнакома — падаем на cp1252.
    const label = charset === 1251 ? 'windows-1251' : 'windows-1252';
    decoder = new TextDecoder(label, { fatal: false });
    TEXT_DECODERS.set(charset, decoder);
  }
  return decoder.decode(new Uint8Array([byte]));
}

/**
 * Превращает RTF-строку в plain-текст. Принимает уже decoded latin-1 строку
 * (RTF — ASCII, поэтому latin-1 не теряет байтов).
 */
function rtfToText(src: string): string {
  const out: string[] = [];
  const stack: GroupState[] = [
    { ignored: false, ucSkip: 1, charset: 1252, starPending: false },
  ];
  /** Сколько байт fallback'а после \u пропускаем. */
  let skipChars = 0;

  const top = (): GroupState => stack[stack.length - 1];
  const emit = (s: string): void => {
    if (!top().ignored) out.push(s);
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === '{') {
      const parent = top();
      stack.push({
        ignored: parent.ignored,
        ucSkip: parent.ucSkip,
        charset: parent.charset,
        starPending: false,
      });
      i += 1;
      continue;
    }
    if (c === '}') {
      if (stack.length > 1) stack.pop();
      i += 1;
      continue;
    }

    if (c === '\\') {
      const next = src[i + 1];

      // Экранированные литералы.
      if (next === '\\' || next === '{' || next === '}') {
        if (skipChars > 0) skipChars -= 1;
        else emit(next);
        i += 2;
        continue;
      }
      // \* — следующее неизвестное cw делает группу ignored.
      if (next === '*') {
        top().starPending = true;
        i += 2;
        continue;
      }
      // \'xx — одиночный байт ANSI.
      if (next === "'") {
        const hex = src.substr(i + 2, 2);
        const byte = parseInt(hex, 16);
        if (skipChars > 0) {
          skipChars -= 1;
        } else if (!Number.isNaN(byte)) {
          emit(decodeAnsiByte(byte, top().charset));
        }
        i += 4;
        continue;
      }
      // \r и \n внутри backslash-последовательности — в RTF это \par.
      if (next === '\n' || next === '\r') {
        emit('\n');
        i += 2;
        continue;
      }

      // Символьные контрольные слова (\~, \-, \_, \:) — один не-буквенный символ.
      if (next !== undefined && SYMBOLIC_WORDS[next] !== undefined) {
        if (skipChars > 0) skipChars -= 1;
        else emit(SYMBOLIC_WORDS[next]);
        i += 2;
        continue;
      }

      // Контрольное слово: \word(optional digits)(optional space)
      const rest = src.substring(i + 1);
      const m = /^([A-Za-z]+)(-?\d+)?[ ]?/.exec(rest);
      if (m) {
        const word = m[1];
        const param = m[2] !== undefined ? parseInt(m[2], 10) : null;
        i += 1 + m[0].length;

        // Звёздочка перед группой и слово — деструкция, если ignored.
        if (top().starPending) {
          top().starPending = false;
          // По спецификации `{\*\xxx ...}` — это «расширение, можно проигнорировать
          // если не знаешь». Самый безопасный путь — игнорировать всё содержимое.
          top().ignored = true;
        }

        if (word === 'ansicpg' && param !== null) {
          top().charset = param;
          continue;
        }
        if (word === 'uc' && param !== null) {
          top().ucSkip = Math.max(0, param);
          continue;
        }
        if (word === 'u' && param !== null) {
          // Unicode-символ: signed 16-bit.
          const codePoint = param < 0 ? param + 0x10000 : param;
          if (skipChars > 0) {
            // Этот \u вложен в skip — но всё равно skip учитывается только для
            // fallback'а после ТЕКУЩЕГО \u, так что просто продолжаем.
          }
          if (!top().ignored) {
            out.push(String.fromCharCode(codePoint));
          }
          skipChars = top().ucSkip;
          continue;
        }

        if (IGNORED_DESTINATIONS.has(word)) {
          top().ignored = true;
          continue;
        }

        const ws = WHITESPACE_WORDS[word];
        if (ws !== undefined) {
          if (skipChars > 0) skipChars -= 1;
          else emit(ws);
          continue;
        }

        // Неизвестное контрольное слово — игнорируем (стилевое/шрифтовое).
        continue;
      }

      // \ + символ (например, перенос строки)
      if (skipChars > 0) skipChars -= 1;
      i += 2;
      continue;
    }

    // Обычный символ.
    if (c === '\n' || c === '\r') {
      // В RTF переносы строк в исходнике — белый шум; реальные переносы дают \par.
      i += 1;
      continue;
    }
    if (skipChars > 0) {
      skipChars -= 1;
    } else {
      emit(c);
    }
    i += 1;
  }

  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractRtfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  // RTF — это ASCII, не-ASCII байты передаются через \'xx / \uNNNN, так что
  // безопасно прочитать как latin-1 (один байт = один char, без перекодировок).
  const raw = new TextDecoder('latin1').decode(buffer);
  return rtfToText(raw);
}
