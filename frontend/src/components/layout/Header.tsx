import { useNavigate } from '@tanstack/react-router';
import { Bell, Menu, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/common/UserAvatar';
import { QuickCreateMenu } from './QuickCreateMenu';
import { useNotifications } from '@/features/notifications/hooks';
import { useAuthStore } from '@/stores/auth';
import { useFiltersStore } from '@/stores/filters';
import { useUIStore } from '@/stores/ui';
interface Props {
  title: string;
}

export function Header({ title }: Props) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const search = useFiltersStore((s) => s.search);
  const setSearch = useFiltersStore((s) => s.setSearch);
  const toggleMobileNav = useUIStore((s) => s.toggleMobileNav);
  const { data: notifications } = useNotifications();
  const hasUnread = notifications?.some((n) => !n.read) ?? false;
  return (
    <header className="flex h-14 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-6">
      {/* Бургер — только на мобильном, открывает выезжающий сайдбар. */}
      <Button
        variant="ghost"
        size="icon"
        className="-ml-1 shrink-0 md:hidden"
        aria-label="Меню"
        onClick={toggleMobileNav}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>

      {/* Глобальный поиск — прячем на узких экранах, чтобы не теснить заголовок. */}
      <div className="ml-6 hidden flex-1 items-center gap-2 md:flex">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по системе…"
            className="h-8 pl-8 text-[13px]"
          />
        </div>
      </div>

      {/* На мобильном растягиваем пустое пространство, чтобы развести
          заголовок слева и иконки справа. */}
      <div className="flex flex-1 md:hidden" />

      <QuickCreateMenu />

      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <Button
        variant="ghost"
        size="icon"
        className="relative shrink-0"
        aria-label="Уведомления"
        onClick={() => navigate({ to: '/notifications' })}
      >
        <Bell className="h-4 w-4" />
        {hasUnread && (
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
        )}
      </Button>

      <UserAvatar user={user ?? undefined} size={28} />
    </header>
  );
}
