export type DocumentSectionId =
  | 'clients'
  | 'regulations'
  | 'company'
  | 'employees'
  | 'contractors'
  | 'tender'
  | 'general';

export type DocumentKind = 'doc' | 'pdf' | 'xlsx' | 'pptx' | 'image' | 'folder' | 'note';

export interface DocumentVersion {
  id: string;
  label: string; // "v1", "Первая редакция"
  createdAt: string;
  author: string;
  note?: string;
}

export interface DocumentComment {
  id: string;
  author: string;
  createdAt: string;
  text: string;
}

export interface DocumentFileMeta {
  fileName: string;
  mime: string;
  size: number; // bytes
  /** small files (<2МБ) — сохраняем dataURL в persist-store для оффлайн-просмотра */
  dataUrl?: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  emoji: string;
  kind: DocumentKind;
  section: DocumentSectionId;
  updatedAt: string; // ISO
  owner: string;
  tags?: string[];
  description?: string;
  parentId?: string; // для вложения внутрь папки
  versions?: DocumentVersion[];
  comments?: DocumentComment[];
  /** мета приложенного файла; контент лежит либо в `file.dataUrl`, либо в in-memory store, либо в S3 (по fileId) */
  file?: DocumentFileMeta;
  /** id файла в S3-хранилище (таблица files); есть — файл персистентен и доступен после reload */
  fileId?: string;
  /** HTML-контент заметки (kind='note'). Tiptap-вывод. */
  body?: string;
}

export interface DocumentTemplate {
  id: string;
  title: string;
  emoji: string;
  description: string;
  kind: DocumentKind;
  section: DocumentSectionId;
  tags?: string[];
  bodyDescription?: string; // что появится в описании созданного документа
}

export interface DocumentSection {
  id: DocumentSectionId;
  title: string;
  emoji: string;
  description: string;
}
