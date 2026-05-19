import type { User } from '@/api/types';
import { UserAvatar } from './UserAvatar';

interface Props {
  users: Array<Pick<User, 'id' | 'fullName' | 'initials' | 'color'>>;
  max?: number;
  size?: number;
}

export function AvatarStack({ users, max = 3, size = 22 }: Props) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((u, i) => (
        <div
          key={u.id}
          className="relative"
          style={{ marginLeft: i === 0 ? 0 : -6, zIndex: shown.length - i }}
        >
          <UserAvatar user={u} size={size} ring />
        </div>
      ))}
      {rest > 0 && (
        <div
          className="flex items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground"
          style={{ marginLeft: -6, width: size, height: size }}
        >
          +{rest}
        </div>
      )}
    </div>
  );
}
