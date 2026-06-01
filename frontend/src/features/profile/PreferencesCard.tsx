import { Bell, Languages, Mail, MessageSquare, Monitor, Moon, PanelLeft, Sun } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePreferencesStore } from '@/stores/preferences';
import { useUIStore } from '@/stores/ui';
import type { Language, NotificationChannels, ThemeMode } from '@/stores/preferences';

const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
];

interface ChannelRow {
  key: keyof NotificationChannels;
  title: string;
  description: string;
}

const EMAIL_CHANNELS: ChannelRow[] = [
  {
    key: 'emailMentions',
    title: 'Упоминания и комментарии',
    description: 'Когда вас @упомянули в карточке вакансии или кандидата.',
  },
  {
    key: 'emailStatusChanges',
    title: 'Смена статусов',
    description: 'Изменения по вашим вакансиям и кандидатам (interview → offer и т.п.).',
  },
  {
    key: 'emailWeeklyDigest',
    title: 'Еженедельный дайджест',
    description: 'Сводка по подбору за неделю — приходит в понедельник утром.',
  },
];

const PUSH_CHANNELS: ChannelRow[] = [
  {
    key: 'pushMentions',
    title: 'Упоминания',
    description: 'Браузерные пуши при @упоминаниях.',
  },
  {
    key: 'pushStatusChanges',
    title: 'Изменения статусов',
    description: 'Браузерные пуши по вашим сущностям.',
  },
  {
    key: 'desktopSounds',
    title: 'Звуковые уведомления',
    description: 'Тихий звук при новых событиях в открытой вкладке.',
  },
];

export function PreferencesCard() {
  const theme = usePreferencesStore((s) => s.theme);
  const setTheme = usePreferencesStore((s) => s.setTheme);
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const timezone = usePreferencesStore((s) => s.timezone);
  const setTimezone = usePreferencesStore((s) => s.setTimezone);
  const channels = usePreferencesStore((s) => s.channels);
  const setChannel = usePreferencesStore((s) => s.setChannel);

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <Bell className="h-4 w-4 text-amber-500" />
          Уведомления и предпочтения
        </CardTitle>
        <CardDescription>
          Каналы оповещений, язык интерфейса и оформление. Настройки сохраняются локально.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <section className="space-y-3">
          <SectionTitle icon={<Mail className="h-3.5 w-3.5" />}>Email-уведомления</SectionTitle>
          <div className="rounded-md border">
            {EMAIL_CHANNELS.map((row, i) => (
              <ChannelToggle
                key={row.key}
                row={row}
                value={channels[row.key]}
                onChange={(v) => setChannel(row.key, v)}
                last={i === EMAIL_CHANNELS.length - 1}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle icon={<MessageSquare className="h-3.5 w-3.5" />}>
            В приложении
          </SectionTitle>
          <div className="rounded-md border">
            {PUSH_CHANNELS.map((row, i) => (
              <ChannelToggle
                key={row.key}
                row={row}
                value={channels[row.key]}
                onChange={(v) => setChannel(row.key, v)}
                last={i === PUSH_CHANNELS.length - 1}
              />
            ))}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <SectionTitle icon={<Languages className="h-3.5 w-3.5" />}>
            Регион и язык
          </SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Язык интерфейса</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">Русский</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Часовой пояс</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <SectionTitle icon={<Monitor className="h-3.5 w-3.5" />}>Внешний вид</SectionTitle>

          <div className="space-y-1.5">
            <Label className="text-[12px]">Тема</Label>
            <div className="grid grid-cols-3 gap-2">
              <ThemeOption
                active={theme === 'light'}
                onClick={() => setTheme('light')}
                icon={<Sun className="h-4 w-4" />}
                label="Светлая"
              />
              <ThemeOption
                active={theme === 'dark'}
                onClick={() => setTheme('dark')}
                icon={<Moon className="h-4 w-4" />}
                label="Тёмная"
              />
              <ThemeOption
                active={theme === 'system'}
                onClick={() => setTheme('system')}
                icon={<Monitor className="h-4 w-4" />}
                label="Системная"
              />
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              Применяется сразу. «Системная» следует за настройками вашей ОС.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="flex min-w-0 items-start gap-3">
              <PanelLeft className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <Label className="text-[13px]">Свернуть боковую панель</Label>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  Полезно на узких экранах и для большего рабочего поля.
                </p>
              </div>
            </div>
            <Switch checked={sidebarCollapsed} onCheckedChange={toggleSidebar} />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function SectionTitle({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] font-medium text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}

function ChannelToggle({
  row,
  value,
  onChange,
  last,
}: {
  row: ChannelRow;
  value: boolean;
  onChange: (v: boolean) => void;
  last: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-4 p-3 ${
        last ? '' : 'border-b'
      }`}
    >
      <div className="min-w-0">
        <Label className="text-[13px]">{row.title}</Label>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{row.description}</p>
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function ThemeOption({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-md border px-3 py-2.5 text-[12.5px] font-medium transition-colors ${
        active
          ? 'border-foreground/40 bg-foreground/[0.04] text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// Подсказка для типизации, чтобы не было `ThemeMode` неиспользованным.
export type { ThemeMode };
