import { create } from 'zustand';
import type { UUID } from '@/api/types';

/**
 * Лёгкий стор активного диалога — выбран в левой колонке, отображается
 * в центральной. Тред-панель (правая колонка) — поле для будущего этапа 4.
 */
interface ChatState {
  activeConversationId: UUID | null;
  setActiveConversation: (id: UUID | null) => void;
  /** ID корневого сообщения открытого треда (правая шторка). */
  activeThreadRootId: UUID | null;
  openThread: (rootId: UUID) => void;
  closeThread: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeConversationId: null,
  setActiveConversation: (id) =>
    // При смене диалога автоматически закрываем тред — он относится к
    // конкретному диалогу.
    set({ activeConversationId: id, activeThreadRootId: null }),
  activeThreadRootId: null,
  openThread: (rootId) => set({ activeThreadRootId: rootId }),
  closeThread: () => set({ activeThreadRootId: null }),
}));
