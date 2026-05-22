import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { User } from '@/api/types';
import { cn } from '@/lib/utils';
import { useProfileStore, type ProfileUserRef } from '@/stores/profile';

type UserLike = Pick<User, 'fullName' | 'initials' | 'color'> &
  Partial<Pick<User, 'id' | 'email' | 'role' | 'isActive'>>;

interface Props {
  user: UserLike | null | undefined;
  size?: number;
  ring?: boolean;
  className?: string;
  /** Открывает профиль по клику. По умолчанию — да, если у пользователя есть id. */
  interactive?: boolean;
}

export function UserAvatar({ user, size = 24, ring = false, className, interactive }: Props) {
  const openProfile = useProfileStore((s) => s.openProfile);

  if (!user) return null;

  const canOpen = interactive !== false && !!user.id;

  const avatar = (
    <Avatar
      className={cn(ring && 'ring-2 ring-background', !canOpen && className)}
      style={{ width: size, height: size }}
      title={user.fullName}
    >
      <AvatarFallback style={{ background: user.color, color: 'white', fontSize: size * 0.42 }}>
        {user.initials}
      </AvatarFallback>
    </Avatar>
  );

  if (!canOpen) return avatar;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        openProfile(user as ProfileUserRef);
      }}
      className={cn(
        'rounded-full outline-none ring-offset-background transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      aria-label={`Профиль: ${user.fullName}`}
    >
      {avatar}
    </button>
  );
}
