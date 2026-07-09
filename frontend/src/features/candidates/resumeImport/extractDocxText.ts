/**
 * Извлечение текста из DOCX через mammoth.
 *
 * Библиотека — bundled-зависимость, но подгружается лениво (dynamic
 * import → отдельный чанк Vite), чтобы не тащить её в основной бандл.
 * Раньше грузили с cdn.jsdelivr.net, но CDN недоступен у части
 * пользователей — распознавание падало на любом файле.
 */
interface MammothModule {
  extractRawText(args: { arrayBuffer: ArrayBuffer }): Promise<{ value?: string }>;
}

let mammothPromise: Promise<MammothModule> | null = null;

async function loadMammoth(): Promise<MammothModule> {
  if (!mammothPromise) {
    mammothPromise = (async () => {
      const mod = (await import('mammoth')) as unknown as
        | MammothModule
        | { default: MammothModule };
      // CJS-interop: у Vite функции могут лежать как в namespace, так и в default.
      return 'extractRawText' in mod ? mod : mod.default;
    })().catch((error) => {
      mammothPromise = null;
      throw error;
    });
  }
  return mammothPromise;
}

export async function extractDocxText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const mammoth = await loadMammoth();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value ?? '';
}
