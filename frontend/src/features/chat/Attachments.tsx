/**
 * Рендер списка вложений в сообщении. Для image и pdf — inline-превью
 * (через временный download-url), для остального — компактная карточка
 * «иконка + имя + размер» с переходом на скачивание.
 *
 * URL получаем лениво по клику/при первом маунте картинки/PDF — это
 * presigned-ссылка с TTL ~5 минут. Если файл инфицирован — бэк отдаст 409
 * и мы покажем сообщение об ошибке.
 */
import { useEffect, useState } from 'react';
import { Download, FileText, ShieldAlert } from 'lucide-react';
import { filesApi, type FileResponse } from '@/api/files';
import { cn } from '@/lib/utils';

interface Props {
  files: FileResponse[];
}

export function Attachments({ files }: Props) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) => (
        <Attachment key={f.id} file={f} />
      ))}
    </div>
  );
}

function Attachment({ file }: { file: FileResponse }) {
  const isImage = file.mime.startsWith('image/');
  const isPdf = file.mime === 'application/pdf';
  const infected = file.scanStatus === 'infected';

  if (infected) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-[11.5px] text-destructive">
        <ShieldAlert className="h-3.5 w-3.5" />
        <span className="max-w-[220px] truncate">{file.originalName}</span>
        <span className="text-[10.5px]">антивирус заблокировал</span>
      </div>
    );
  }

  if (isImage) {
    return <ImagePreview file={file} />;
  }
  if (isPdf) {
    return <PdfPreview file={file} />;
  }
  return <FileCard file={file} />;
}

function useDownloadUrl(fileId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void filesApi
      .download(fileId)
      .then((r) => {
        if (alive) setUrl(r.url);
      })
      .catch(() => {
        // 404 — например, юзер уже не в conversation. Просто оставим null
        // и покажем file-card без preview.
      });
    return () => {
      alive = false;
    };
  }, [fileId]);
  return url;
}

function ImagePreview({ file }: { file: FileResponse }) {
  const url = useDownloadUrl(file.id);
  return (
    <a
      href={url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'group relative block overflow-hidden rounded-md border bg-muted',
        !url && 'pointer-events-none',
      )}
      title={file.originalName}
    >
      {url ? (
        <img
          src={url}
          alt={file.originalName}
          className="max-h-60 max-w-xs object-contain"
        />
      ) : (
        <div className="flex h-32 w-32 items-center justify-center text-[11px] text-muted-foreground">
          загружаем…
        </div>
      )}
    </a>
  );
}

function PdfPreview({ file }: { file: FileResponse }) {
  const url = useDownloadUrl(file.id);
  return (
    <a
      href={url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-[12.5px] hover:bg-muted/40',
        !url && 'pointer-events-none opacity-60',
      )}
      title={file.originalName}
    >
      <FileText className="h-4 w-4 text-rose-500" />
      <span className="min-w-0">
        <span className="block max-w-[240px] truncate font-medium">
          {file.originalName}
        </span>
        <span className="block text-[10.5px] text-muted-foreground">
          PDF · {formatSize(file.size)}
        </span>
      </span>
    </a>
  );
}

function FileCard({ file }: { file: FileResponse }) {
  const url = useDownloadUrl(file.id);
  return (
    <a
      href={url ?? '#'}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'flex items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-[12.5px] hover:bg-muted/40',
        !url && 'pointer-events-none opacity-60',
      )}
      title={file.originalName}
    >
      <Download className="h-4 w-4 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block max-w-[240px] truncate font-medium">
          {file.originalName}
        </span>
        <span className="block text-[10.5px] text-muted-foreground">
          {file.mime} · {formatSize(file.size)}
        </span>
      </span>
    </a>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
