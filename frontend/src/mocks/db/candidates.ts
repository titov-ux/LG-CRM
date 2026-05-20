import type { Candidate, CandidateStatus } from '@/api/types';
import { assignKanbanOrders } from '@/components/kanban/utils';

export interface CandidateStatusDescriptor {
  id: CandidateStatus;
  label: string;
  color: string;
}

export const candidateStatuses: CandidateStatusDescriptor[] = [
  { id: 'new', label: 'Новый', color: '#94a3b8' },
  { id: 'screening', label: 'Скрининг', color: '#64748b' },
  { id: 'recruiter_iv', label: 'Интервью с рекрутером', color: '#3b82f6' },
  { id: 'ready', label: 'Готов к презентации', color: '#06b6d4' },
  { id: 'presented', label: 'Презентован клиенту', color: '#8b5cf6' },
  { id: 'client_iv', label: 'На интервью у клиента', color: '#a855f7' },
  { id: 'offer', label: 'Оффер', color: '#f59e0b' },
  { id: 'hired', label: 'Трудоустроен', color: '#10b981' },
  { id: 'reserve', label: 'Резерв', color: '#cbd5e1' },
];

export const candidatesDb: Candidate[] = assignKanbanOrders([
  { id: 'k1', fullName: 'Иван Петров', role: 'Senior Java Developer', grade: 'Senior', experienceYears: 7, stack: ['Java', 'Spring', 'Kafka', 'PostgreSQL', 'Docker'], rate: 3000, format: 'Гибрид', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'presented', daysInStatus: 3, vacancyIds: ['v1'], hot: false, email: 'ivan.petrov@mail.ru', phone: '+7 (916) 555-12-23' },
  { id: 'k2', fullName: 'Алина Смирнова', role: 'Senior React Developer', grade: 'Senior', experienceYears: 6, stack: ['React', 'TypeScript', 'Next.js'], rate: 2900, format: 'Удалённо', location: 'СПб', source: 'LinkedIn', recruiterId: 'u4', status: 'client_iv', daysInStatus: 9, vacancyIds: ['v2'], hot: true },
  { id: 'k3', fullName: 'Сергей Николаев', role: 'DevOps Engineer', grade: 'Middle', experienceYears: 4, stack: ['Kubernetes', 'AWS', 'Terraform'], rate: 2500, format: 'Удалённо', location: 'Екатеринбург', source: 'Telegram', recruiterId: 'u5', status: 'recruiter_iv', daysInStatus: 2, vacancyIds: ['v3'], hot: false },
  { id: 'k4', fullName: 'Мария Иванова', role: 'Lead Data Engineer', grade: 'Lead', experienceYears: 10, stack: ['Python', 'Spark', 'Airflow', 'AWS'], rate: 3900, format: 'Гибрид', location: 'Москва', source: 'Рекомендация', recruiterId: 'u6', status: 'ready', daysInStatus: 1, vacancyIds: [], hot: false },
  { id: 'k5', fullName: 'Дмитрий Козлов', role: 'QA Automation Engineer', grade: 'Middle', experienceYears: 5, stack: ['Python', 'Selenium', 'Pytest', 'Postman'], rate: 2300, format: 'Офис', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'presented', daysInStatus: 6, vacancyIds: ['v5'], hot: false },
  { id: 'k6', fullName: 'Ольга Лебедева', role: 'Senior iOS Developer', grade: 'Senior', experienceYears: 8, stack: ['Swift', 'SwiftUI', 'Combine', 'Objective-C'], rate: 3300, format: 'Гибрид', location: 'Москва', source: 'LinkedIn', recruiterId: 'u6', status: 'offer', daysInStatus: 4, vacancyIds: ['v6'], hot: false },
  { id: 'k7', fullName: 'Андрей Соколов', role: 'Backend Developer (Go)', grade: 'Middle', experienceYears: 4, stack: ['Go', 'gRPC', 'PostgreSQL'], rate: 2700, format: 'Офис', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'new', daysInStatus: 1, vacancyIds: [], hot: false },
  { id: 'k8', fullName: 'Наталья Волкова', role: 'ML Engineer', grade: 'Senior', experienceYears: 6, stack: ['Python', 'PyTorch', 'MLOps', 'Kubernetes'], rate: 3500, format: 'Удалённо', location: 'СПб', source: 'GitHub', recruiterId: 'u5', status: 'client_iv', daysInStatus: 11, vacancyIds: ['v8'], hot: true },
  { id: 'k9', fullName: 'Михаил Зайцев', role: 'SRE Engineer', grade: 'Senior', experienceYears: 7, stack: ['Kubernetes', 'Prometheus', 'Go', 'Terraform'], rate: 3500, format: 'Удалённо', location: 'Казань', source: 'Telegram', recruiterId: 'u5', status: 'hired', daysInStatus: 18, vacancyIds: ['v9'], hot: false },
  { id: 'k10', fullName: 'Екатерина Беляева', role: 'Product Analyst', grade: 'Middle', experienceYears: 4, stack: ['SQL', 'Python', 'Tableau', 'PowerBI'], rate: 2400, format: 'Гибрид', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'screening', daysInStatus: 5, vacancyIds: [], hot: false },
  { id: 'k11', fullName: 'Павел Морозов', role: 'Senior Backend (Java)', grade: 'Senior', experienceYears: 9, stack: ['Java', 'Spring', 'Kafka'], rate: 3100, format: 'Гибрид', location: 'Москва', source: 'Рекомендация', recruiterId: 'u5', status: 'presented', daysInStatus: 2, vacancyIds: ['v1'], hot: false },
  { id: 'k12', fullName: 'Юлия Тарасова', role: 'ML Engineer', grade: 'Senior', experienceYears: 5, stack: ['Python', 'PyTorch', 'TensorFlow'], rate: 3400, format: 'Удалённо', location: 'СПб', source: 'LinkedIn', recruiterId: 'u6', status: 'reserve', daysInStatus: 30, vacancyIds: [], hot: false },
]);
