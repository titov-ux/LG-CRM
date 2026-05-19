import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProfileHeaderCard } from './ProfileHeaderCard';
import { PreferencesCard } from './PreferencesCard';
import { SecurityCard } from './SecurityCard';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4 text-left">
          <DialogTitle>Профиль</DialogTitle>
          <DialogDescription>
            Личные данные, уведомления и настройки безопасности.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto px-6 py-4">
          <ProfileHeaderCard />
          <PreferencesCard />
          <SecurityCard />
        </div>
      </DialogContent>
    </Dialog>
  );
}
