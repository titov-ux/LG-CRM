import { Mail, Send, UserRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { User } from '@/api/types';
import { UserAvatar } from '@/components/common/UserAvatar';
import { telegramUrl } from '@/lib/utils';
import { ROLE_LABEL } from '@/features/users/UserForm';
import { ROLE_BADGE } from './constants';

interface Props {
  user: User;
}

export function UserProfileSummaryCard({ user }: Props) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start">
        <UserAvatar user={user} size={72} ring interactive={false} />

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">{user.fullName}</span>
            <Badge
              variant="secondary"
              className={ROLE_BADGE[user.role] ?? 'bg-slate-100 text-slate-700'}
            >
              {ROLE_LABEL[user.role]}
            </Badge>
            {!user.isActive && (
              <Badge variant="secondary" className="bg-zinc-100 text-zinc-600">
                Деактивирован
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Mail className="h-3.5 w-3.5 shrink-0" />
            <a href={`mailto:${user.email}`} className="truncate hover:text-foreground hover:underline">
              {user.email}
            </a>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Send className="h-3.5 w-3.5 shrink-0" />
            {user.telegram ? (
              <a
                href={telegramUrl(user.telegram)}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:text-foreground hover:underline"
              >
                {user.telegram}
              </a>
            ) : (
              <span className="truncate text-muted-foreground/70">Telegram не указан</span>
            )}
          </div>

          <p className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2.5 text-[12px] text-muted-foreground">
            <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Публичный профиль сотрудника. Настройки уведомлений и безопасность доступны только
            владельцу аккаунта.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
