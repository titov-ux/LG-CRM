/**
 * Хук, который связывает realtime-канал WebSocket с react-query кэшем.
 *
 * Стратегия — самая безопасная: на любое чужое событие изменения вакансий
 * или кандидатов инвалидируем весь соответствующий «корень» ключей. React
 * Query сам перезапросит только те запросы, что сейчас активно используются
 * (то есть открытые списки/канбаны/карточки) — это и нужно.
 *
 * Echo (события, инициированные этой же вкладкой) — игнорируем: оптимистичные
 * апдейты уже отрисованы, а ответ мутации придёт через onSuccess.
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth';
import { candidateKeys } from '@/features/candidates/hooks';
import { vacancyKeys } from '@/features/vacancies/hooks';
import {
  startRealtime,
  stopRealtime,
  subscribeRealtime,
  type RealtimeEvent,
} from '@/lib/realtime';
import { WS_URL } from '@/lib/constants';

export function useRealtimeSync(): void {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!WS_URL) return; // моковый режим / SSR — realtime отключён
    if (!accessToken) {
      stopRealtime();
      return;
    }
    // Каждый раз дёргаем актуальный токен — учитывает refresh.
    startRealtime(() => useAuthStore.getState().accessToken);
    return () => {
      // При смене токена просто перестартуем (см. else выше).
      // На реальный unmount — не дёргаем stop, т.к. хук монтируется в layout
      // и unmount происходит только при logout (а logout сам чистит токен).
    };
  }, [accessToken]);

  useEffect(() => {
    const unsubscribe = subscribeRealtime((event: RealtimeEvent) => {
      if (event.echo) return; // своё же действие — оптимистично уже применили
      // Чат-события обрабатываются собственным хуком (useChatRealtime),
      // здесь ловим только домен vacancy/candidate.
      if (event.type !== 'vacancy.changed' && event.type !== 'candidate.changed') {
        return;
      }
      if (event.entity === 'vacancy') {
        queryClient.invalidateQueries({ queryKey: vacancyKeys.all });
        if (event.id) {
          // Дополнительно подёргаем карточку, если она открыта.
          queryClient.invalidateQueries({ queryKey: vacancyKeys.byId(event.id) });
          queryClient.invalidateQueries({ queryKey: vacancyKeys.activity(event.id) });
        }
      } else if (event.entity === 'candidate') {
        queryClient.invalidateQueries({ queryKey: candidateKeys.all });
        if (event.id) {
          queryClient.invalidateQueries({ queryKey: candidateKeys.byId(event.id) });
          queryClient.invalidateQueries({ queryKey: candidateKeys.activity(event.id) });
        }
      }
    });
    return unsubscribe;
  }, [queryClient]);
}
