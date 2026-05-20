import type { Comment } from '@/api/types';

// Несколько посевных комментариев — чтобы пустые карточки выглядели живее
// и было видно работу @упоминаний и веток ответов.
export const commentsDb: Comment[] = [
  // Кандидат k1
  {
    id: 'cm1',
    entityType: 'candidate',
    entityId: 'k1',
    authorId: 'u4',
    parentId: null,
    text: 'Хороший кандидат, прошёл техничку. @u2, можем презентовать клиенту?',
    mentions: ['u2'],
    createdAt: '2026-05-19T11:12:00Z',
    updatedAt: null,
  },
  {
    id: 'cm2',
    entityType: 'candidate',
    entityId: 'k1',
    authorId: 'u2',
    parentId: 'cm1',
    text: 'Да, согласовано. Готовь презентацию сегодня к 18:00.',
    mentions: [],
    createdAt: '2026-05-19T11:24:00Z',
    updatedAt: null,
  },
  // Вакансия v2
  {
    id: 'cm3',
    entityType: 'vacancy',
    entityId: 'v2',
    authorId: 'u4',
    parentId: null,
    text: '@u1 подтверди, пожалуйста, формат: гибрид или офис у клиента?',
    mentions: ['u1'],
    createdAt: '2026-05-18T14:08:00Z',
    updatedAt: null,
  },
  // Клиент c1
  {
    id: 'cm4',
    entityType: 'client',
    entityId: 'c1',
    authorId: 'u2',
    parentId: null,
    text: 'Готовы расширять команду в Q3. Приоритет — backend и DevOps. @u3, держи в фокусе.',
    mentions: ['u3'],
    createdAt: '2026-05-18T14:20:00Z',
    updatedAt: null,
  },
];
