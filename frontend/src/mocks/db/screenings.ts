import type {
  ScreeningQuestion,
  ScreeningReport,
  ScreeningSegment,
  ScreeningSession,
  ScreeningStatus,
} from '@/api/screenings';
import { candidatesDb } from './candidates';
import { usersDb } from './users';
import { vacanciesDb } from './vacancies';

/** Типовой план вопросов AI (create/regenerate с generateQuestions). */
export const MOCK_AI_QUESTIONS: Array<{ text: string; goal: string }> = [
  {
    text: 'Расскажите о последнем проекте и своей роли в нём',
    goal: 'Опыт и зона ответственности',
  },
  {
    text: 'Какой стек используете чаще всего и почему?',
    goal: 'Технический стек',
  },
  {
    text: 'Опишите сложную задачу, которую решали самостоятельно',
    goal: 'Проблемное мышление',
  },
  {
    text: 'Как выстраиваете работу с командой и заказчиком?',
    goal: 'Коммуникация',
  },
  {
    text: 'Какой формат работы и ставка вам сейчас удобны?',
    goal: 'Условия и мотивация',
  },
];

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86400_000).toISOString();
}

function mkQuestion(
  id: string,
  position: number,
  text: string,
  goal: string,
  status: ScreeningQuestion['status'] = 'pending',
  answerSummary?: string | null,
): ScreeningQuestion {
  return {
    id,
    position,
    text,
    goal,
    source: 'pregenerated',
    status,
    answerSummary: answerSummary ?? null,
  };
}

function enrich(session: ScreeningSession): ScreeningSession {
  const cand = candidatesDb.find((c) => c.id === session.candidateId);
  const vac = session.vacancyId
    ? vacanciesDb.find((v) => v.id === session.vacancyId)
    : undefined;
  const rec = session.recruiterId
    ? usersDb.find((u) => u.id === session.recruiterId)
    : undefined;
  return {
    ...session,
    candidateName: cand?.fullName ?? session.candidateName ?? null,
    vacancyTitle: vac?.title ?? session.vacancyTitle ?? null,
    recruiterName: rec?.fullName ?? session.recruiterName ?? null,
  };
}

const doneReport: ScreeningReport = {
  id: 'scr-rep-1',
  summary:
    'Кандидат уверенно рассказал о коммерческом опыте на Java/Spring, понимает микросервисную архитектуру и работу с Kafka. Есть пробелы в оценке сроков и глубины знаний по observability.',
  verdict: 'partial_fit',
  scores: {
    technical: { score: 4, note: 'Сильный backend-стек' },
    communication: { score: 3, note: 'Отвечает по делу, иногда кратко' },
    motivation: { score: 4, note: 'Ищет стабильный outstaff-проект' },
    culture: { score: 3, note: 'Ок с гибридом' },
  },
  redFlags: ['Мало примеров инцидентов в проде'],
  recommendation:
    'Рекомендуем техническое интервью с акцентом на проектирование и мониторинг. Уточнить готовность к онколлу.',
  model: 'mock-yandexgpt',
  createdAt: daysAgo(1),
};

const doneQuestions: ScreeningQuestion[] = [
  mkQuestion(
    'scr-q-d1',
    0,
    'Расскажите о последнем проекте и своей роли в нём',
    'Опыт',
    'answered',
    'Вёл сервис заказов на Spring Boot, команда 5 человек',
  ),
  mkQuestion(
    'scr-q-d2',
    1,
    'Какой стек используете чаще всего и почему?',
    'Стек',
    'answered',
    'Java 17, Spring, Kafka, PostgreSQL',
  ),
  mkQuestion(
    'scr-q-d3',
    2,
    'Опишите сложную задачу, которую решали самостоятельно',
    'Проблемы',
    'answered',
    'Оптимизация consumer lag в Kafka на пике нагрузки',
  ),
  mkQuestion(
    'scr-q-d4',
    3,
    'Как выстраиваете работу с командой и заказчиком?',
    'Коммуникация',
    'skipped',
  ),
  mkQuestion(
    'scr-q-d5',
    4,
    'Какой формат работы и ставка вам сейчас удобны?',
    'Условия',
    'asked',
  ),
];

/** Сегменты транскрипта для завершённых сессий (ключ = sessionId). */
export const screeningSegmentsDb: Record<string, ScreeningSegment[]> = {
  'scr-3': [
    {
      id: 'scr-seg-1',
      seq: 1,
      speaker: 'recruiter',
      text: 'Здравствуйте, Иван. Давайте начнём со знакомства — расскажите о последнем проекте.',
      startedMs: 1200,
      endedMs: 6800,
    },
    {
      id: 'scr-seg-2',
      seq: 2,
      speaker: 'candidate',
      text: 'Последние два года я работал над сервисом заказов: Spring Boot, Kafka, PostgreSQL. Отвечал за API и обработку событий.',
      startedMs: 7200,
      endedMs: 18500,
    },
    {
      id: 'scr-seg-3',
      seq: 3,
      speaker: 'recruiter',
      text: 'Какой стек вам ближе всего сейчас?',
      startedMs: 19200,
      endedMs: 22000,
    },
    {
      id: 'scr-seg-4',
      seq: 4,
      speaker: 'candidate',
      text: 'Java 17 и Spring, плюс Kafka. С Docker и Kubernetes работаю на уровне деплоя сервисов.',
      startedMs: 22500,
      endedMs: 31000,
    },
    {
      id: 'scr-seg-5',
      seq: 5,
      speaker: 'recruiter',
      text: 'Была ли сложная задача, которую вытащили сами?',
      startedMs: 31800,
      endedMs: 34500,
    },
    {
      id: 'scr-seg-6',
      seq: 6,
      speaker: 'candidate',
      text: 'Да — разгоняли consumer lag: переписали партиционирование и добавили backpressure. Lag упал с часов до минут.',
      startedMs: 35000,
      endedMs: 45500,
    },
  ],
};

export const screeningsDb: ScreeningSession[] = [
  enrich({
    id: 'scr-1',
    candidateId: 'k3',
    vacancyId: 'v3',
    matchId: null,
    recruiterId: 'u5',
    status: 'draft',
    telemostUrl: 'https://telemost.yandex.ru/j/mock-draft',
    consentConfirmed: false,
    startedAt: null,
    endedAt: null,
    durationSec: null,
    audioFileId: null,
    createdAt: hoursAgo(3),
    updatedAt: hoursAgo(2),
    questions: MOCK_AI_QUESTIONS.map((q, i) =>
      mkQuestion(`scr-q-1-${i}`, i, q.text, q.goal),
    ),
  }),
  enrich({
    id: 'scr-2',
    candidateId: 'k10',
    vacancyId: null,
    matchId: null,
    recruiterId: 'u4',
    status: 'live',
    telemostUrl: 'https://telemost.yandex.ru/j/mock-live',
    consentConfirmed: true,
    startedAt: hoursAgo(0.25),
    endedAt: null,
    durationSec: null,
    audioFileId: null,
    createdAt: hoursAgo(5),
    updatedAt: hoursAgo(0.25),
    questions: MOCK_AI_QUESTIONS.map((q, i) =>
      mkQuestion(
        `scr-q-2-${i}`,
        i,
        q.text,
        q.goal,
        i === 0 ? 'asked' : 'pending',
      ),
    ),
  }),
  enrich({
    id: 'scr-3',
    candidateId: 'k1',
    vacancyId: 'v1',
    matchId: null,
    recruiterId: 'u4',
    status: 'done',
    telemostUrl: 'https://telemost.yandex.ru/j/mock-done',
    consentConfirmed: true,
    startedAt: daysAgo(1),
    endedAt: daysAgo(1),
    durationSec: 28 * 60 + 40,
    audioFileId: null,
    createdAt: daysAgo(2),
    updatedAt: daysAgo(1),
    questions: doneQuestions,
    report: doneReport,
  }),
  enrich({
    id: 'scr-4',
    candidateId: 'k2',
    vacancyId: 'v2',
    matchId: null,
    recruiterId: 'u4',
    status: 'processing',
    telemostUrl: 'https://telemost.yandex.ru/j/mock-processing',
    consentConfirmed: true,
    startedAt: hoursAgo(2),
    endedAt: hoursAgo(1.5),
    durationSec: 22 * 60,
    audioFileId: null,
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(1.5),
    questions: MOCK_AI_QUESTIONS.map((q, i) =>
      mkQuestion(
        `scr-q-4-${i}`,
        i,
        q.text,
        q.goal,
        i < 3 ? 'answered' : i === 3 ? 'skipped' : 'asked',
        i < 3 ? 'Краткий ответ кандидата (мок)' : null,
      ),
    ),
  }),
].map(enrich);

let screeningSeq = 100;
let questionSeq = 1000;
let reportSeq = 10;

export function nextScreeningId(): string {
  return `scr-${++screeningSeq}`;
}

export function nextQuestionId(): string {
  return `scr-q-${++questionSeq}`;
}

export function nextReportId(): string {
  return `scr-rep-${++reportSeq}`;
}

export function buildAiQuestions(): ScreeningQuestion[] {
  return MOCK_AI_QUESTIONS.map((q, i) =>
    mkQuestion(nextQuestionId(), i, q.text, q.goal),
  );
}

export function buildMockReport(sessionId: string): ScreeningReport {
  const session = screeningsDb.find((s) => s.id === sessionId);
  const name = session?.candidateName ?? 'Кандидат';
  return {
    id: nextReportId(),
    summary: `Мок-отчёт по скринингу: ${name}. Кандидат ответил на основные вопросы по опыту и стеку. Детали — синтетические данные для UI без бэкенда.`,
    verdict: 'fit',
    scores: {
      technical: { score: 4, note: 'Достаточный уровень' },
      communication: { score: 4, note: 'Понятные ответы' },
      motivation: { score: 3, note: 'Интерес к проекту средний' },
      culture: { score: 4, note: 'Формат подходит' },
    },
    redFlags: [],
    recommendation: 'Можно приглашать на следующее техническое интервью.',
    model: 'mock-yandexgpt',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Имитация фонового анализа: processing → done + report при следующем чтении.
 * Список и карточка сессии «дозревают» без реального AI.
 */
export function maybeFinalizeProcessing(session: ScreeningSession): ScreeningSession {
  if (session.status !== 'processing') return enrich(session);
  session.status = 'done';
  session.report = buildMockReport(session.id);
  session.updatedAt = new Date().toISOString();
  if (!screeningSegmentsDb[session.id]) {
    screeningSegmentsDb[session.id] = [
      {
        id: `scr-seg-${session.id}-1`,
        seq: 1,
        speaker: 'recruiter',
        text: 'Спасибо за встречу, переходим к итогам.',
        startedMs: 1000,
        endedMs: 4000,
      },
      {
        id: `scr-seg-${session.id}-2`,
        seq: 2,
        speaker: 'candidate',
        text: 'Спасибо, буду ждать обратной связи.',
        startedMs: 4500,
        endedMs: 8000,
      },
    ];
  }
  return enrich(session);
}

export function getScreening(id: string): ScreeningSession | undefined {
  const session = screeningsDb.find((s) => s.id === id);
  if (!session) return undefined;
  return maybeFinalizeProcessing(session);
}

export function listScreenings(filters: {
  candidateId?: string | null;
  vacancyId?: string | null;
  recruiterId?: string | null;
  status?: ScreeningStatus | null;
}): ScreeningSession[] {
  return screeningsDb
    .filter((s) => {
      if (filters.candidateId && s.candidateId !== filters.candidateId) return false;
      if (filters.vacancyId && s.vacancyId !== filters.vacancyId) return false;
      if (filters.recruiterId && s.recruiterId !== filters.recruiterId) return false;
      if (filters.status && s.status !== filters.status) return false;
      return true;
    })
    .map((s) => maybeFinalizeProcessing(s))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function enrichScreening(session: ScreeningSession): ScreeningSession {
  return enrich(session);
}
