import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function NoteEditor({ value, onChange, placeholder, autoFocus, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Начните писать… поддерживается Markdown-ввод (## заголовок, * список, > цитата, ``` код)',
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
          class: 'text-blue-600 underline underline-offset-2 hover:text-blue-700',
        },
      }),
    ],
    content: value,
    autofocus: autoFocus,
    editorProps: {
      attributes: {
        class:
          'tiptap prose prose-sm max-w-none min-h-[200px] focus:outline-none ' +
          'prose-headings:font-bold prose-headings:tracking-tight ' +
          'prose-h1:text-[28px] prose-h1:mt-4 prose-h1:mb-2 ' +
          'prose-h2:text-[20px] prose-h2:mt-4 prose-h2:mb-1.5 ' +
          'prose-h3:text-[16px] prose-h3:mt-3 prose-h3:mb-1 ' +
          'prose-p:my-1.5 prose-p:leading-relaxed ' +
          'prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 ' +
          'prose-blockquote:border-l-4 prose-blockquote:border-foreground/20 prose-blockquote:pl-3 prose-blockquote:text-foreground/80 prose-blockquote:not-italic ' +
          'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12.5px] prose-code:before:content-none prose-code:after:content-none ' +
          'prose-pre:bg-muted prose-pre:text-foreground prose-pre:rounded-md prose-pre:p-3 ' +
          'prose-hr:my-4',
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getHTML());
    },
  });

  // если контент пришёл извне (загрузили новую заметку) — синхронизируем
  useEffect(() => {
    if (!editor) return;
    if (value === editor.getHTML()) return;
    editor.commands.setContent(value, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL ссылки', prev ?? 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const TbBtn = ({
    onClick,
    active,
    title,
    children,
    disabled,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30',
        active && 'bg-muted text-foreground',
      )}
    >
      {children}
    </button>
  );

  return (
    <div className={cn('flex min-h-0 flex-col rounded-md border bg-background', className)}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-md border-b bg-background/95 px-1.5 py-1 backdrop-blur">
        <TbBtn
          title="Заголовок 1"
          active={editor.isActive('heading', { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Заголовок 2"
          active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Заголовок 3"
          active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 className="h-3.5 w-3.5" />
        </TbBtn>
        <div className="mx-1 h-4 w-px bg-border" />
        <TbBtn
          title="Полужирный (⌘B)"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Курсив (⌘I)"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Зачёркнутый"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Код inline"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code className="h-3.5 w-3.5" />
        </TbBtn>
        <div className="mx-1 h-4 w-px bg-border" />
        <TbBtn
          title="Маркированный список"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Нумерованный список"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Чек-лист"
          active={editor.isActive('taskList')}
          onClick={() => editor.chain().focus().toggleTaskList().run()}
        >
          <ListChecks className="h-3.5 w-3.5" />
        </TbBtn>
        <div className="mx-1 h-4 w-px bg-border" />
        <TbBtn
          title="Цитата"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          title="Блок кода"
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <Code className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn title="Разделитель" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn title="Ссылка" active={editor.isActive('link')} onClick={setLink}>
          <LinkIcon className="h-3.5 w-3.5" />
        </TbBtn>
        <div className="ml-auto flex items-center gap-0.5">
          <TbBtn
            title="Отменить (⌘Z)"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </TbBtn>
          <TbBtn
            title="Повторить (⇧⌘Z)"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </TbBtn>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-4 py-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** Read-only рендерер заметки для превью */
export function NoteViewer({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        'tiptap prose prose-sm max-w-none ' +
          'prose-headings:font-bold prose-headings:tracking-tight ' +
          'prose-h1:text-[24px] prose-h2:text-[18px] prose-h3:text-[15px] ' +
          'prose-p:leading-relaxed ' +
          'prose-blockquote:border-l-4 prose-blockquote:border-foreground/20 prose-blockquote:pl-3 prose-blockquote:not-italic ' +
          'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none ' +
          'prose-a:text-blue-600 prose-a:underline prose-a:underline-offset-2',
        className,
      )}
      // ВАЖНО: рендерим HTML, выданный Tiptap (доверенный собственный вывод)
      dangerouslySetInnerHTML={{ __html: html || '<p class="text-muted-foreground">Пустая заметка</p>' }}
    />
  );
}
