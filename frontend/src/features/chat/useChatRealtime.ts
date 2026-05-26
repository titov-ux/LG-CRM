/**
 * Realtime-подписка для чата.
 *
 * Стратегия — самая простая и надёжная: на любое чужое чат-событие
 * инвалидируем список диалогов (там меняется `lastMessageAt` или unread-state)
 * и историю конкретного диалога — react-query сам перезапросит видимые
 * сейчас данные.
 *
 * Если событие принесло `notifiedUserIds` и среди них текущий пользователь —
 * подёргиваем кэш уведомлений (Этап 2: @-упоминания → Notification).
 *
 * Этап 3: реакции (chat.reaction_changed) — инвалидируем messages. Изменения
 * состава группы (chat.conversation_changed kind='member_removed' с моим
 * userId) — переключаем активный диалог на null (Telegram-like: диалог
 * пропадает из списка).
 *
 * Echo — игнорируем: оптимистичный апдейт уже применился через onSuccess
 * мутации.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  subscribeRealtime,
  type ChatRealtimeEvent,
  type RealtimeEvent,
} from '@/lib/realtime';
import { useAuthStore } from '@/stores/auth';
import { notificationKeys } from '@/features/notifications/hooks';
import { chatKeys } from './hooks';
import { useChatStore } from './store';
import { playMentionSound, playMessageSound } from './sound';
import type { ChatConversation, UUID } from '@/api/types';

export function useChatRealtime(): void {
  const queryClient = useQueryClient();
  const meId = useAuthStore((s) => s.user?.id);
  const activeId = useChatStore((s) => s.activeConversationId);
  const setActive = useChatStore((s) => s.setActiveConversation);

  useEffect(() => {
    const isChat = (e: RealtimeEvent): e is ChatRealtimeEvent =>
      e.type.startsWith('chat.');
    const unsubscribe = subscribeRealtime((evt: RealtimeEvent) => {
      if (!isChat(evt)) return;
      const event: ChatRealtimeEvent = evt;
      if (event.echo) return;

      // Список диалогов: lastMessageAt + read-state + состав.
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });

      // История конкретного диалога — для create/update/delete/reaction.
      if (
        event.type === 'chat.message_created' ||
        event.type === 'chat.message_updated' ||
        event.type === 'chat.message_deleted' ||
        event.type === 'chat.reaction_changed'
      ) {
        if (event.conversationId) {
          queryClient.invalidateQueries({
            queryKey: chatKeys.messages(event.conversationId as UUID),
          });
          // Любое изменение сообщения может затронуть тред (новый ответ,
          // редактирование/удаление ответа, реакция в треде). Точечно матчить
          // корень не обязательно — react-query пересчитает только активные.
          queryClient.invalidateQueries({
            queryKey: [...chatKeys.all, 'thread', event.conversationId],
          });
        }
      }

      // Меняется состав группы: если меня выкинули — снимаем активный
      // диалог и инвалидируем кэш. Также инвалидируем карточку диалога
      // (memberIds/title могли поменяться).
      if (event.type === 'chat.conversation_changed') {
        if (event.conversationId) {
          queryClient.invalidateQueries({
            queryKey: chatKeys.conversation(event.conversationId as UUID),
          });
        }
        const kind = event.payload['kind'];
        const removedUserId = event.payload['userId'];
        if (
          kind === 'member_removed' &&
          removedUserId === meId &&
          event.conversationId &&
          event.conversationId === activeId
        ) {
          setActive(null);
        }
      }

      // Если меня упомянули — оживим nav-badge уведомлений.
      const notified = event.payload['notifiedUserIds'];
      const iWasMentioned =
        !!meId && Array.isArray(notified) && notified.includes(meId);
      if (
        meId &&
        (event.type === 'chat.message_created' ||
          event.type === 'chat.message_updated')
      ) {
        if (iWasMentioned) {
          queryClient.invalidateQueries({ queryKey: notificationKeys.all });
        }
      }

      // Звуковое уведомление на новое сообщение. Slack-конвенция:
      //  • не звуким на своё же действие (echo);
      //  • не звуким на правки и удаления — только новое;
      //  • не звуким, если диалог открыт сейчас и вкладка в фокусе;
      //  • не звуким, если диалог mute (myMutedUntil > now()).
      if (event.type === 'chat.message_created' && !event.echo) {
        const convId = event.conversationId;
        const isActiveAndFocused =
          !!convId &&
          convId === activeId &&
          typeof document !== 'undefined' &&
          document.visibilityState === 'visible' &&
          document.hasFocus();
        if (!isActiveAndFocused) {
          const conv = convId
            ? queryClient
                .getQueriesData<ChatConversation[]>({
                  queryKey: chatKeys.conversations(),
                })
                .flatMap(([, data]) => data ?? [])
                .find((c) => c.id === convId)
            : undefined;
          const muted =
            !!conv?.myMutedUntil &&
            +new Date(conv.myMutedUntil) > Date.now();
          if (!muted) {
            if (iWasMentioned) playMentionSound();
            else playMessageSound();
          }
        }
      }
    });
    return unsubscribe;
  }, [queryClient, meId, activeId, setActive]);
}
