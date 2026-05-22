import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Search, Shuffle, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDocumentsStore } from '@/stores/documents';
import { ALL_EMOJIS, EMOJI_CATEGORIES } from './emojiData';

interface Props {
  value?: string;
  onSelect: (emoji: string) => void;
  onRemove?: () => void;
  children: ReactNode; // триггер (обычно — клик по иконке документа)
  align?: 'start' | 'center' | 'end';
}

export function EmojiPicker({ value, onSelect, onRemove, children, align = 'start' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<string>(EMOJI_CATEGORIES[0].id);
  const recents = useDocumentsStore((s) => s.recentEmojis);
  const pushRecent = useDocumentsStore((s) => s.pushRecentEmoji);
  const scrollRef = useRef<HTMLDivElement>(null);

  const trimmedQuery = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!trimmedQuery) return null;
    return ALL_EMOJIS.filter(
      (e) =>
        e.n.toLowerCase().includes(trimmedQuery) ||
        e.k.toLowerCase().includes(trimmedQuery),
    ).slice(0, 200);
  }, [trimmedQuery]);

  const handlePick = (emoji: string) => {
    pushRecent(emoji);
    onSelect(emoji);
    setOpen(false);
    setQuery('');
  };

  const handleRandom = () => {
    const random = ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)];
    handlePick(random.c);
  };

  const handleTabClick = (id: string) => {
    setActiveTab(id);
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={6}
        collisionPadding={16}
        className="flex h-[440px] w-[360px] flex-col overflow-hidden p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-1 border-b p-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск эмодзи…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleRandom}
            title="Случайный эмодзи"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </Button>
          {onRemove && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
              title="Удалить иконку"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Tabs */}
        {!trimmedQuery && (
          <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-1.5 py-1">
            {recents.length > 0 && (
              <button
                type="button"
                onClick={() => handleTabClick('recent')}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded text-base transition-colors',
                  activeTab === 'recent' ? 'bg-muted' : 'hover:bg-muted/60',
                )}
                title="Недавние"
              >
                🕘
              </button>
            )}
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleTabClick(c.id)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded text-base transition-colors',
                  activeTab === c.id ? 'bg-muted' : 'hover:bg-muted/60',
                )}
                title={c.title}
              >
                {c.icon}
              </button>
            ))}
          </div>
        )}

        {/* Grid */}
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
        >
          {trimmedQuery ? (
            searchResults && searchResults.length > 0 ? (
              <EmojiGrid emojis={searchResults} value={value} onPick={handlePick} />
            ) : (
              <div className="py-12 text-center text-[12px] text-muted-foreground">
                Ничего не найдено
              </div>
            )
          ) : (
            <>
              {recents.length > 0 && (
                <div data-cat="recent" className="mb-3">
                  <div className="mb-1 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Недавние
                  </div>
                  <EmojiGrid
                    emojis={recents.map((c) => ({ c, n: '', k: '' }))}
                    value={value}
                    onPick={handlePick}
                  />
                </div>
              )}
              {EMOJI_CATEGORIES.map((cat) => (
                <div key={cat.id} data-cat={cat.id} className="mb-3 last:mb-0">
                  <div className="mb-1 px-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {cat.title}
                  </div>
                  <EmojiGrid emojis={cat.items} value={value} onPick={handlePick} />
                </div>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmojiGrid({
  emojis,
  value,
  onPick,
}: {
  emojis: { c: string; n: string; k?: string }[];
  value?: string;
  onPick: (c: string) => void;
}) {
  return (
    <div className="grid grid-cols-9 gap-0.5">
      {emojis.map((e, i) => {
        const selected = e.c === value;
        return (
          <button
            key={`${e.c}-${i}`}
            type="button"
            onClick={() => onPick(e.c)}
            title={e.n || undefined}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded text-lg leading-none transition-colors hover:bg-muted',
              selected && 'bg-muted ring-1 ring-foreground/20',
            )}
          >
            {e.c}
          </button>
        );
      })}
    </div>
  );
}
