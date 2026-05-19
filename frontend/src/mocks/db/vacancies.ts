import type { Vacancy, VacancyStatus } from '@/api/types';

export interface VacancyStatusDescriptor {
  id: VacancyStatus;
  label: string;
  color: string;
}

export const vacancyStatuses: VacancyStatusDescriptor[] = [
  { id: 'new', label: 'Новая', color: '#94a3b8' },
  { id: 'briefing', label: 'Брифинг', color: '#64748b' },
  { id: 'in_work', label: 'В работе', color: '#3b82f6' },
  { id: 'proposed', label: 'Кандидаты предложены', color: '#8b5cf6' },
  { id: 'interview', label: 'Интервью', color: '#a855f7' },
  { id: 'offer', label: 'Оффер', color: '#f59e0b' },
  { id: 'closed_success', label: 'Закрыта успешно', color: '#10b981' },
  { id: 'paused', label: 'На паузе', color: '#cbd5e1' },
];

export const vacanciesDb: Vacancy[] = [
  { id: 'v1', title: 'Senior Backend (Java)', clientId: 'c1', grade: 'Senior', stack: ['Java', 'Spring', 'Kafka', 'PostgreSQL'], format: 'Гибрид', rateClient: 4500, rateMax: 3200, positions: 2, status: 'in_work', priority: 'high', recruiterIds: ['u4', 'u5'], daysInStatus: 5, candidatesCount: 4, deadline: '2026-06-15' },
  { id: 'v2', title: 'Senior Frontend (React)', clientId: 'c1', grade: 'Senior', stack: ['React', 'TypeScript', 'Redux'], format: 'Удалённо', rateClient: 4200, rateMax: 3000, positions: 1, status: 'interview', priority: 'urgent', recruiterIds: ['u4'], daysInStatus: 11, candidatesCount: 3, deadline: '2026-05-30' },
  { id: 'v3', title: 'DevOps Engineer', clientId: 'c2', grade: 'Middle', stack: ['Kubernetes', 'Terraform', 'AWS'], format: 'Удалённо', rateClient: 3800, rateMax: 2700, positions: 1, status: 'proposed', priority: 'medium', recruiterIds: ['u5'], daysInStatus: 3, candidatesCount: 2, deadline: '2026-07-01' },
  { id: 'v4', title: 'Lead Data Engineer', clientId: 'c2', grade: 'Lead', stack: ['Python', 'Spark', 'Airflow'], format: 'Гибрид', rateClient: 5500, rateMax: 4000, positions: 1, status: 'briefing', priority: 'medium', recruiterIds: ['u6'], daysInStatus: 2, candidatesCount: 0, deadline: '2026-08-01' },
  { id: 'v5', title: 'QA Automation', clientId: 'c3', grade: 'Middle', stack: ['Python', 'Selenium', 'Pytest'], format: 'Офис', rateClient: 3200, rateMax: 2400, positions: 2, status: 'in_work', priority: 'low', recruiterIds: ['u4'], daysInStatus: 15, candidatesCount: 5, deadline: '2026-06-30' },
  { id: 'v6', title: 'Senior iOS Developer', clientId: 'c1', grade: 'Senior', stack: ['Swift', 'SwiftUI', 'Combine'], format: 'Гибрид', rateClient: 4800, rateMax: 3400, positions: 1, status: 'offer', priority: 'high', recruiterIds: ['u6'], daysInStatus: 4, candidatesCount: 1, deadline: '2026-05-25' },
  { id: 'v7', title: 'Middle Backend (Go)', clientId: 'c4', grade: 'Middle', stack: ['Go', 'gRPC', 'PostgreSQL'], format: 'Офис', rateClient: 3900, rateMax: 2800, positions: 3, status: 'new', priority: 'medium', recruiterIds: [], daysInStatus: 1, candidatesCount: 0, deadline: '2026-07-15' },
  { id: 'v8', title: 'ML Engineer', clientId: 'c3', grade: 'Senior', stack: ['Python', 'PyTorch', 'MLOps'], format: 'Удалённо', rateClient: 5200, rateMax: 3700, positions: 1, status: 'in_work', priority: 'high', recruiterIds: ['u5', 'u6'], daysInStatus: 8, candidatesCount: 3, deadline: '2026-06-20' },
  { id: 'v9', title: 'Senior SRE', clientId: 'c2', grade: 'Senior', stack: ['Kubernetes', 'Prometheus', 'Go'], format: 'Удалённо', rateClient: 5000, rateMax: 3600, positions: 1, status: 'closed_success', priority: 'medium', recruiterIds: ['u5'], daysInStatus: 22, candidatesCount: 1, deadline: '2026-05-10' },
  { id: 'v10', title: 'Product Analyst', clientId: 'c4', grade: 'Middle', stack: ['SQL', 'Python', 'Tableau'], format: 'Гибрид', rateClient: 3400, rateMax: 2500, positions: 1, status: 'paused', priority: 'low', recruiterIds: ['u4'], daysInStatus: 6, candidatesCount: 2, deadline: null },
];
