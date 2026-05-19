import { useMemo } from 'react';
import type { User } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { useProfileStore } from '@/stores/profile';
import { useUsers } from '@/features/users/hooks';

export function useResolvedProfileUser(): {
  user: User | null;
  isSelf: boolean;
  isLoading: boolean;
} {
  const target = useProfileStore((s) => s.user);
  const currentUser = useAuthStore((s) => s.user);
  const { data: users, isLoading } = useUsers();

  return useMemo(() => {
    if (!target) {
      return { user: null, isSelf: false, isLoading: false };
    }

    const isSelf = !!currentUser && currentUser.id === target.id;
    if (isSelf && currentUser) {
      return { user: currentUser, isSelf: true, isLoading: false };
    }

    const fromList = users?.find((u) => u.id === target.id);
    if (fromList) {
      return { user: fromList, isSelf: false, isLoading: false };
    }

    const hasCoreFields =
      'email' in target &&
      'role' in target &&
      typeof target.email === 'string' &&
      typeof target.role === 'string';

    if (hasCoreFields) {
      return {
        user: {
          id: target.id,
          fullName: target.fullName,
          initials: target.initials,
          color: target.color,
          email: target.email!,
          role: target.role!,
          isActive: target.isActive ?? true,
        },
        isSelf: false,
        isLoading: false,
      };
    }

    return { user: null, isSelf: false, isLoading: isLoading };
  }, [target, currentUser, users, isLoading]);
}
