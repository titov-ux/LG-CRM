import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useProfileStore } from '@/stores/profile';
import { ProfileHeaderCard } from './ProfileHeaderCard';
import { PreferencesCard } from './PreferencesCard';
import { SecurityCard } from './SecurityCard';
import { UserProfileSummaryCard } from './UserProfileSummaryCard';
import { useResolvedProfileUser } from './useResolvedProfileUser';

export function ProfileDialog() {
  const open = useProfileStore((s) => s.open);
  const setOpen = useProfileStore((s) => s.setOpen);
  const { user, isSelf, isLoading } = useResolvedProfileUser();

  const title = isSelf ? 'Мой профиль' : user ? user.fullName : 'Профиль';
  const description = isSelf
    ? 'Личные данные, уведомления и настройки безопасности.'
    : 'Публичная информация о сотруднике.';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[min(90vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}

          {!isLoading && !user && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Не удалось загрузить данные пользователя.
            </p>
          )}

          {!isLoading && user && isSelf && (
            <>
              <ProfileHeaderCard />
              <PreferencesCard />
              <SecurityCard />
            </>
          )}

          {!isLoading && user && !isSelf && <UserProfileSummaryCard user={user} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
