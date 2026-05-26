/**
 * Извлечение текста из DOCX через mammoth (CDN + dynamic import).
 *
 * Загружаем библиотеку по требованию, чтобы не тащить её в основной бандл.
 */
const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/+esm';

interface MammothModule {
  extractRawText(args: { arrayBuffer: ArrayBuffer }): Promise<{ value?: string }>;
}

let mammothPromise: Promise<MammothModule> | null = null;

async function loadMammoth(): Promise<MammothModule> {
  if (!mammothPromise) {
    mammothPromise = (async () => {
      const mod = (await import(/* @vite-ignore */ MAMMOTH_URL)) as MammothModule;
      return mod;
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
