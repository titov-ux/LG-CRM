import { useQuery } from '@tanstack/react-query';
import { loginSnapshotsApi, type LoginSnapshotParams } from '@/api/loginSnapshots';

export const loginSnapshotKeys = {
  all: ['login-snapshots'] as const,
  list: (params: LoginSnapshotParams) => [...loginSnapshotKeys.all, params] as const,
};

export function useLoginSnapshots(params: LoginSnapshotParams = {}) {
  return useQuery({
    queryKey: loginSnapshotKeys.list(params),
    queryFn: () => loginSnapshotsApi.list(params),
    // presigned image-URL живут ~5 мин — не кэшируем надолго, чтобы не показывать
    // протухшие ссылки на кадры.
    staleTime: 60_000,
  });
}
