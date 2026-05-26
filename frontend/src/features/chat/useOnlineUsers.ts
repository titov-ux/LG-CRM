import { useEffect, useState } from 'react';
import { getOnlineUserIdsSnapshot, subscribeOnlineUsers } from '@/lib/realtime';
import type { UUID } from '@/api/types';

export function useOnlineUsers(): Set<UUID> {
  const [onlineIds, setOnlineIds] = useState<Set<UUID>>(
    () => new Set<UUID>(Array.from(getOnlineUserIdsSnapshot())),
  );

  useEffect(() => {
    return subscribeOnlineUsers((next) => {
      setOnlineIds(new Set<UUID>(Array.from(next)));
    });
  }, []);

  return onlineIds;
}
