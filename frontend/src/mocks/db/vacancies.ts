import type { Vacancy, VacancyStatus } from '@/api/types';
import { assignKanbanOrders } from '@/components/kanban/utils';

export interface VacancyStatusDescriptor {
  id: VacancyStatus;
  label: string;
  color: string;
}

export const vacancyStatuses: VacancyStatusDescriptor[] = [
  { id: 'new', label: 'Новая', color: '#94a3b8' },
  { id: 'in_work', label: 'В работе', color: '#3b82f6' },
  { id: 'proposed', label: 'Кандидаты предложены', color: '#8b5cf6' },
  { id: 'interview', label: 'Интервью', color: '#a855f7' },
  { id: 'waiting_os', label: 'Ждём ОС', color: '#f59e0b' },
  { id: 'closed_success', label: 'Закрыта успешно', color: '#10b981' },
  { id: 'closed', label: 'Закрыта', color: '#ef4444' },
  { id: 'paused', label: 'На паузе', color: '#cbd5e1' },
];

// Финальные статусы — перевод в них на бэке требует обязательного комментария
// (см. backend/app/modules/vacancies/transitions.py: FINAL_STATUSES). Зеркалим
// здесь, чтобы UI запрашивал комментарий, а не падал с 422 comment_required.
export const FINAL_VACANCY_STATUSES: readonly VacancyStatus[] = ['closed_success', 'closed'];

export function isFinalVacancyStatus(status: VacancyStatus): boolean {
  return FINAL_VACANCY_STATUSES.includes(status);
}

// ВНИМАНИЕ: `candidatesCount` в этом seed всегда равно 0.
// Реальное значение поля считается на стороне MSW при каждом чтении
// вакансий из candidatesDb (см. withCandidatesCount в mocks/handlers.ts).
// Не хардкодьте сюда «декоративные» цифры — фронт всё равно их перепишет,
// и они только маскируют расхождение с фактическими привязками.
export const vacanciesDb: Vacancy[] = assignKanbanOrders([
  {
    id: 'v1',
    title: 'Senior Backend (Java)',
    clientId: 'c1',
    engagementType: 'outstaff',
    project: 'Биллинг',
    grade: 'Senior',
    stack: ['Java', 'Spring', 'Kafka', 'PostgreSQL'],
    format: 'Гибрид',
    rateClient: 4500,
    positions: 2,
    status: 'in_work',
    priority: 'high',
    accountManagerId: 'u2',
    recruiterIds: ['u4', 'u5'],
    daysInStatus: 5,
    candidatesCount: 0,
    deadline: '2026-06-15',
    description:
      'Разработка высоконагруженного биллинга для финтех-продукта. Сервис обрабатывает ~3 000 RPS, интегрируется с внешними платёжными шлюзами и системой антифрода. Команда: 6 backend, 2 QA, тимлид. Гибридный формат: 2 дня в офисе (Москва, м. Белорусская).',
    requirements:
      'Обязательно:\n— Опыт коммерческой разработки на Java от 5 лет\n— Spring Boot, Spring Cloud\n— Kafka, PostgreSQL (партиционирование, индексы)\n— Опыт построения распределённых систем\n\nЖелательно:\n— Опыт в финтехе или e-commerce\n— Знание Kubernetes, Helm\n— Английский на уровне чтения документации',
  },
  {
    id: 'v2',
    title: 'Senior Frontend (React)',
    clientId: 'c1',
    engagementType: 'outstaff',
    project: 'Личный кабинет клиента',
    grade: 'Senior',
    stack: ['React', 'TypeScript', 'Redux'],
    format: 'Удалённо',
    rateClient: 4200,
    positions: 1,
    status: 'interview',
    priority: 'urgent',
    accountManagerId: 'u2',
    recruiterIds: ['u4'],
    daysInStatus: 11,
    candidatesCount: 0,
    deadline: '2026-05-30',
    description:
      'Развитие личного кабинета клиента: миграция с устаревшего AngularJS на современный стек React + TypeScript. Проект на финальной стадии, нужен сильный фронтенд, который доведёт переезд до релиза и возьмёт на себя архитектурные решения.',
    requirements:
      'Обязательно:\n— React 18+, TypeScript (strict)\n— Опыт миграций крупных кодовых баз\n— Redux Toolkit / RTK Query\n— Покрытие тестами (Jest, RTL)\n\nЖелательно:\n— Опыт работы с Module Federation\n— Знакомство с Storybook\n— Понимание Web Vitals и оптимизации производительности',
  },
  {
    id: 'v3',
    title: 'DevOps Engineer',
    clientId: 'c2',
    engagementType: 'agency',
    project: 'Облачная платформа',
    grade: 'Middle',
    stack: ['Kubernetes', 'Terraform', 'AWS'],
    format: 'Удалённо',
    rateClient: 3800,
    positions: 1,
    status: 'proposed',
    priority: 'medium',
    accountManagerId: 'u2',
    recruiterIds: ['u5'],
    daysInStatus: 3,
    candidatesCount: 0,
    deadline: '2026-07-01',
    description:
      'Поддержка и развитие облачной инфраструктуры SaaS-платформы. ~40 микросервисов в EKS, IaC на Terraform, GitOps через ArgoCD. Нужно усилить команду платформы на 5 человек.',
    requirements:
      'Обязательно:\n— Kubernetes (управление кластерами, helm-чарты)\n— Terraform (модули, state management)\n— AWS (EKS, RDS, S3, IAM)\n— CI/CD: GitLab CI или GitHub Actions\n\nЖелательно:\n— ArgoCD / FluxCD\n— Prometheus + Grafana, ELK\n— Опыт построения SLO/SLA',
  },
  {
    id: 'v4',
    title: 'Lead Data Engineer',
    clientId: 'c2',
    engagementType: 'agency',
    grade: 'Lead',
    stack: ['Python', 'Spark', 'Airflow'],
    format: 'Гибрид',
    rateClient: 5500,
    positions: 1,
    status: 'new',
    priority: 'medium',
    accountManagerId: 'u2',
    recruiterIds: ['u6'],
    daysInStatus: 2,
    candidatesCount: 0,
    deadline: '2026-08-01',
    description:
      'Создание дата-платформы с нуля: DWH на Snowflake, ETL на Airflow, потоковая обработка через Kafka + Spark Streaming. Лид соберёт команду из 4–6 инженеров и будет отвечать за архитектуру и roadmap на 12 месяцев.',
    requirements:
      'Обязательно:\n— Опыт построения DWH/Data Lake с нуля\n— Python, Spark (batch и streaming)\n— Airflow или аналоги (Dagster, Prefect)\n— Лидерский опыт от 2 лет (5+ человек)\n\nЖелательно:\n— Snowflake, dbt\n— Опыт построения data quality / data contracts\n— Английский Upper-Intermediate (есть международная команда)',
  },
  {
    id: 'v5',
    title: 'QA Automation',
    clientId: 'c3',
    engagementType: 'outstaff',
    grade: 'Middle',
    stack: ['Python', 'Selenium', 'Pytest'],
    format: 'Офис',
    rateClient: 3200,
    positions: 2,
    status: 'in_work',
    priority: 'low',
    accountManagerId: 'u3',
    recruiterIds: ['u4'],
    daysInStatus: 15,
    candidatesCount: 0,
    deadline: '2026-06-30',
    description:
      'Автоматизация регрессионного тестирования веб-приложения e-grocery. Текущее покрытие — 35%, цель на полгода — 70%. Работа в офисе СПб, м. Чкаловская.',
    requirements:
      'Обязательно:\n— Python (Pytest), Selenium / Playwright\n— Опыт построения автотестов с нуля\n— Понимание REST API и инструменты (Postman, requests)\n— Git, CI/CD\n\nЖелательно:\n— Опыт нагрузочного тестирования (Locust, k6)\n— Allure, отчётность',
  },
  {
    id: 'v6',
    title: 'Senior iOS Developer',
    clientId: 'c1',
    engagementType: 'outstaff',
    project: 'Mobile Banking',
    grade: 'Senior',
    stack: ['Swift', 'SwiftUI', 'Combine'],
    format: 'Гибрид',
    rateClient: 4800,
    positions: 1,
    status: 'interview',
    priority: 'high',
    accountManagerId: 'u2',
    recruiterIds: ['u6'],
    daysInStatus: 4,
    candidatesCount: 0,
    deadline: '2026-05-25',
    description:
      'Разработка iOS-приложения для премиум-сегмента (банкинг). Команда: 3 iOS, 4 Android, общий продакшен. Релизы раз в 2 недели, app store rating 4.8.',
    requirements:
      'Обязательно:\n— Swift, SwiftUI, Combine\n— Опыт публикации приложений в App Store\n— Понимание архитектур MVVM / TCA\n— Знание тонкостей безопасности iOS\n\nЖелательно:\n— Опыт работы с биометрией и Secure Enclave\n— Знание Objective-C для поддержки legacy-модулей',
  },
  {
    id: 'v7',
    title: 'Middle Backend (Go)',
    clientId: 'c4',
    engagementType: 'agency',
    grade: 'Middle',
    stack: ['Go', 'gRPC', 'PostgreSQL'],
    format: 'Офис',
    rateClient: 3900,
    positions: 3,
    status: 'new',
    priority: 'medium',
    accountManagerId: 'u3',
    recruiterIds: [],
    daysInStatus: 1,
    candidatesCount: 0,
    deadline: '2026-07-15',
    description:
      'Расширение команды бэкенда логистической платформы. Разработка новых микросервисов, оптимизация существующих, работа с большими объёмами данных в реальном времени.',
    requirements:
      'Обязательно:\n— Go от 2 лет коммерческой разработки\n— gRPC, Protobuf\n— PostgreSQL: написание сложных запросов, оптимизация\n— Docker, базовое понимание Kubernetes\n\nЖелательно:\n— Опыт работы с очередями (Kafka, NATS)\n— Знакомство с DDD / Clean Architecture',
  },
  {
    id: 'v8',
    title: 'ML Engineer',
    clientId: 'c3',
    engagementType: 'outstaff',
    project: 'Рекомендательная система',
    grade: 'Senior',
    stack: ['Python', 'PyTorch', 'MLOps'],
    format: 'Удалённо',
    rateClient: 5200,
    positions: 1,
    status: 'in_work',
    priority: 'high',
    accountManagerId: 'u3',
    recruiterIds: ['u5', 'u6'],
    daysInStatus: 8,
    candidatesCount: 0,
    deadline: '2026-06-20',
    description:
      'Развитие рекомендательной системы для e-commerce: коллаборативная фильтрация + контентная модель. Нужно довести MVP до прод-нагрузки и наладить регулярное переобучение.',
    requirements:
      'Обязательно:\n— Python, PyTorch / TensorFlow\n— Опыт MLOps: MLflow, DVC, feature store\n— Production-опыт развёртывания моделей\n— Знание классических алгоритмов рекомендательных систем\n\nЖелательно:\n— Опыт работы с векторными БД (Pinecone, Milvus)\n— A/B-тестирование моделей\n— Публикации или участие в Kaggle (top-tier)',
  },
  {
    id: 'v9',
    title: 'Senior SRE',
    clientId: 'c2',
    engagementType: 'agency',
    grade: 'Senior',
    stack: ['Kubernetes', 'Prometheus', 'Go'],
    format: 'Удалённо',
    rateClient: 5000,
    positions: 1,
    status: 'closed_success',
    priority: 'medium',
    accountManagerId: 'u2',
    recruiterIds: ['u5'],
    daysInStatus: 22,
    candidatesCount: 0,
    deadline: '2026-05-10',
    description:
      'Усиление SRE-команды: настройка observability, инциденты, оптимизация инфраструктуры. Дежурства 1 неделя в месяц с компенсацией.',
    requirements:
      'Обязательно:\n— Kubernetes (опыт эксплуатации в продакшене)\n— Prometheus, Grafana, Loki\n— Go (написание операторов и тулинга)\n— Опыт incident response и postmortem-культуры\n\nЖелательно:\n— Service mesh (Istio, Linkerd)\n— Knative или serverless-платформы',
  },
  {
    id: 'v10',
    title: 'Product Analyst',
    clientId: 'c4',
    engagementType: 'outstaff',
    grade: 'Middle',
    stack: ['SQL', 'Python', 'Tableau'],
    format: 'Гибрид',
    rateClient: 3400,
    positions: 1,
    status: 'paused',
    priority: 'low',
    accountManagerId: 'u3',
    recruiterIds: ['u4'],
    daysInStatus: 6,
    candidatesCount: 0,
    deadline: null,
    description:
      'Поддержка продуктовой команды маркетплейса аналитикой: продуктовые метрики, когортный анализ, ad-hoc отчёты, гипотезы для A/B. Вакансия на паузе до утверждения бюджета Q3.',
    requirements:
      'Обязательно:\n— Уверенный SQL (window functions, оптимизация)\n— Python для анализа (pandas, numpy)\n— Опыт визуализации (Tableau, Metabase или Superset)\n— Понимание продуктовых метрик (retention, LTV, funnel)\n\nЖелательно:\n— Опыт работы с системами продуктовой аналитики (Amplitude, Mixpanel)\n— Базовая статистика, A/B-тестирование',
  },
]);

const VACANCIES_STORAGE_KEY = 'crm-lg:v1:db:vacancies';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function hydrateVacanciesFromStorage() {
  if (!canUseStorage()) return;
  try {
    const raw = window.localStorage.getItem(VACANCIES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Vacancy[];
    if (!Array.isArray(parsed)) return;
    vacanciesDb.splice(0, vacanciesDb.length, ...parsed);
  } catch {
    // ignore broken local data and keep bundled seed
  }
}

export function persistVacanciesDb() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(VACANCIES_STORAGE_KEY, JSON.stringify(vacanciesDb));
  } catch {
    // ignore quota/storage errors to avoid breaking app flow
  }
}

hydrateVacanciesFromStorage();
