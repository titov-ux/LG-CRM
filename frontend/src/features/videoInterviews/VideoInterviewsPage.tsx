import { CalendarClock, FileText, Link2, MonitorPlay, Sparkles, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/common/EmptyState';

/**
 * Видеоинтервью — задел под будущий раздел.
 *
 * Здесь появятся записи видеоинтервью с кандидатами: планирование встреч,
 * хранение записей, расшифровки и AI-саммари по итогам разговора.
 * Пока раздел в разработке — страница показывает планируемые возможности,
 * чтобы застолбить место в навигации и роутинге.
 */

interface PlannedFeature {
  icon: LucideIcon;
  title: string;
  description: string;
}

const PLANNED: PlannedFeature[] = [
  {
    icon: CalendarClock,
    title: 'Планирование интервью',
    description:
      'Назначение видеовстречи с кандидатом прямо из карточки — со ссылкой и событием в календаре.',
  },
  {
    icon: MonitorPlay,
    title: 'Записи встреч',
    description:
      'Хранение записей интервью, привязанных к кандидату и вакансии, с быстрым просмотром.',
  },
  {
    icon: FileText,
    title: 'Расшифровка разговора',
    description:
      'Автоматическая текстовая расшифровка записи с таймкодами и поиском по содержимому.',
  },
  {
    icon: Sparkles,
    title: 'AI-саммари и оценка',
    description:
      'Краткое резюме интервью, ключевые ответы кандидата и рекомендации по следующему шагу.',
  },
  {
    icon: Link2,
    title: 'Интеграции',
    description:
      'Подключение Zoom / Google Meet / Телемост для автоматического подтягивания записей.',
  },
];

export function VideoInterviewsPage() {
  return (
    <div className="flex-1 space-y-4 overflow-auto px-6 pb-8 pt-5">
      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-muted text-foreground">
          <Video className="h-4.5 w-4.5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Видеоинтервью</h1>
          <p className="text-[11.5px] text-muted-foreground">
            Записи, расшифровки и итоги видеоинтервью с кандидатами.
          </p>
        </div>
      </div>

      {/* Заглушка: раздел в разработке */}
      <Card>
        <CardContent className="p-4">
          <EmptyState
            icon={Video}
            title="Раздел в разработке"
            description="Здесь появятся видеоинтервью с кандидатами: записи, расшифровки и AI-саммари. Ниже — что планируется."
          />
        </CardContent>
      </Card>

      {/* Планируемые возможности */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLANNED.map((f) => {
          const Icon = f.icon;
          return (
            <Card key={f.title} className="bg-muted/20">
              <CardContent className="flex items-start gap-3 p-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background">
                  <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
                </div>
                <div>
                  <div className="text-[13px] font-medium">{f.title}</div>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {f.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
