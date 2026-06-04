import { useNavigate } from '@tanstack/react-router';
import { useChatStore } from '@/features/chat/store';
import type { Notification, UUID } from '@/api/types';

/**
 * Куда ведёт уведомление. Возвращает `false`, если перехода нет (например,
 * системное уведомление без привязки к сущности) — в этом случае клик только
 * помечает уведомление прочитанным.
 */
export function notificationHasTarget(n: Notification): boolean {
  switch (n.entityType) {
    case 'candidate':
    case 'vacancy':
    case 'tender':
    case 'client':
    case 'contact':
      return !!n.entityId;
    case 'chat_message':
      return !!conversationIdOf(n);
    case 'event':
      return true;
    default:
      return false;
  }
}

function conversationIdOf(n: Notification): UUID | null {
  const cid = n.payload?.conversationId;
  return typeof cid === 'string' && cid ? (cid as UUID) : null;
}

/**
 * Хук-навигатор по уведомлениям: переводит пользователя на сущность, к которой
 * относится уведомление.
 *
 *  • candidate / vacancy / client / contact → карточка сущности;
 *  • chat_message (новое сообщение или @-упоминание в чате) → открывает диалог
 *    (id берём из payload.conversationId, т.к. entityId указывает на сообщение);
 *  • event (события календаря) → страница календаря.
 */
export function useNotificationNavigate() {
  const navigate = useNavigate();
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  return (n: Notification): void => {
    switch (n.entityType) {
      case 'candidate':
        if (n.entityId) navigate({ to: '/candidates/$id', params: { id: n.entityId } });
        break;
      case 'vacancy':
        if (n.entityId) navigate({ to: '/vacancies/$id', params: { id: n.entityId } });
        break;
      case 'tender':
        if (n.entityId) navigate({ to: '/tenders/$id', params: { id: n.entityId } });
        break;
      case 'client':
        if (n.entityId) navigate({ to: '/clients/$id', params: { id: n.entityId } });
        break;
      case 'contact':
        if (n.entityId) navigate({ to: '/contacts/$id', params: { id: n.entityId } });
        break;
      case 'chat_message': {
        const conversationId = conversationIdOf(n);
        if (conversationId) {
          setActiveConversation(conversationId);
          navigate({ to: '/chat' });
        }
        break;
      }
      case 'event':
        navigate({ to: '/calendar' });
        break;
      default:
        // system и прочее без привязки — перехода нет.
        break;
    }
  };
}
