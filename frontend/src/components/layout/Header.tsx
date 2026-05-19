import { useState } from 'react';
import { Bell, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { UserAvatar } from '@/components/common/UserAvatar';
import { QuickCreateMenu } from './QuickCreateMenu';
import { useAuthStore } from '@/stores/auth';
import { useFiltersStore } from '@/stores/filters';
import { ProfileDialog } from '@/features/profile/ProfileDialog';

interface Props {
  title: string;
}

export function Header({ title }: Props) {
  const user = useAuthStore((s) => s.user);
  const search = useFiltersStore((s) => s.search);
  const setSearch = useFiltersStore((s) => s.setSearch);
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <header className="flex h-14 items-center gap-3 border-b bg-background px-6">
      <h1 className="text-[15px] font-semibold tracking-tight">{title}</h1>

      <div className="ml-6 flex flex-1 items-center gap-2">
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

      <QuickCreateMenu />

      <Separator orientation="vertical" className="h-6" />

      <Button variant="ghost" size="icon" className="relative">
        <Bell className="h-4 w-4" />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
      </Button>

      <button
        type="button"
        onClick={() => setProfileOpen(true)}
        disabled={!user}
        className="rounded-full outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        aria-label="Открыть профиль"
      >
        <UserAvatar user={user} size={28} />
      </button>

      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  );
}
