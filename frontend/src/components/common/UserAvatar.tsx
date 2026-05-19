import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import type { User } from '@/api/types';
import { cn } from '@/lib/utils';

interface Props {
  user: Pick<User, 'fullName' | 'initials' | 'color'> | null | undefined;
  size?: number;
  ring?: boolean;
  className?: string;
}

export function UserAvatar({ user, size = 24, ring = false, className }: Props) {
  if (!user) return null;
  return (
    <Avatar
      className={cn(ring && 'ring-2 ring-background', className)}
      style={{ width: size, height: size }}
      title={user.fullName}
    >
      <AvatarFallback style={{ background: user.color, color: 'white', fontSize: size * 0.42 }}>
        {user.initials}
      </AvatarFallback>
    </Avatar>
  );
}
