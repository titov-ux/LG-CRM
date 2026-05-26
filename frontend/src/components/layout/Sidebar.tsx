import {
  Activity,
  Bell,
  Briefcase,
  Building2,
  Calculator,
  Calendar,
  ContactRound,
  Database,
  FileText,
  FileUp,
  Home,
  MessageSquare,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { useNotifications } from '@/features/notifications/hooks';
import { AppInfoPopover } from './AppInfoPopover';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  tag?: string;
  tagHint?: string;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  { items: [{ to: '/dashboard', label: 'Главная', icon: Home }] },
  {
    label: 'Работа',
    items: [
      { to: '/vacancies', label: 'Вакансии', icon: Briefcase },
      { to: '/candidates', label: 'Кандидаты', icon: Users },
      { to: '/clients', label: 'Клиенты', icon: Building2 },
      { to: '/contacts', label: 'Контакты', icon: ContactRound },
      { to: '/chat', label: 'Чат', icon: MessageSquare },
      { to: '/calendar', label: 'Календарь', icon: Calendar },
    ],
  },
  {
    label: 'Хранилище',
    items: [
      { to: '/database', label: 'Все кандидаты', icon: Database },
      { to: '/documents', label: 'Документы', icon: FileText },
    ],
  },
  {
    label: 'Прочее',
    items: [
      { to: '/notifications', label: 'Уведомления', icon: Bell },
      { to: '/analytics', label: 'Аналитика', icon: TrendingUp },
      { to: '/calculator', label: 'Калькулятор', icon: Calculator },
      { to: '/resume-formatter', label: 'Форматтер резюме', icon: FileUp },
      { to: '/audit', label: 'Журнал действий', icon: Activity },
    ],
  },
  {
    label: 'Администрирование',
    items: [
      { to: '/roles', label: 'Роли и доступы', icon: ShieldCheck },
      { to: '/settings', label: 'Настройки', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: notifications } = useNotifications();
  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r bg-muted/30">
      <AppInfoPopover>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md px-3.5 py-4 text-left transition-colors hover:bg-background/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Информация о сборке"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-[11px] font-bold tracking-tight text-background">
            ЛГ
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[13px] font-semibold tracking-tight">Интеграция</span>
            <span className="text-[10.5px] text-muted-foreground">SaaS · 2026</span>
          </div>
        </button>
      </AppInfoPopover>

      <nav className="flex-1 space-y-4 px-2 py-2">
        {GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </div>
            )}
            <ul className="space-y-px">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.to);
                const badge =
                  item.to === '/notifications' ? unreadCount : item.badge;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                        active
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.8} />
                      <span className="flex-1">{item.label}</span>
                      {item.tag && (
                        <span
                          title={item.tagHint}
                          className="rounded border border-border/60 bg-muted/60 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-muted-foreground"
                        >
                          {item.tag}
                        </span>
                      )}
                      {badge != null && badge > 0 && (
                        <span className="tnum rounded bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white">
                          {badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
