import type { Candidate, CandidateStatus } from '@/api/types';
import { assignKanbanOrders } from '@/components/kanban/utils';

export interface CandidateStatusDescriptor {
  id: CandidateStatus;
  label: string;
  color: string;
}

export const candidateStatuses: CandidateStatusDescriptor[] = [
  { id: 'new', label: 'Новый', color: '#94a3b8' },
  { id: 'recruiter_iv', label: 'Интервью с рекрутером', color: '#3b82f6' },
  { id: 'ready', label: 'Готов к презентации', color: '#06b6d4' },
  { id: 'presented', label: 'Презентован клиенту', color: '#8b5cf6' },
  { id: 'waiting_os', label: 'Ждём ОС', color: '#fbbf24' },
  { id: 'offer', label: 'Оффер', color: '#f59e0b' },
  { id: 'rejected_client', label: 'Отказ клиента', color: '#ef4444' },
  { id: 'rejected_candidate', label: 'Отказ кандидата', color: '#f97316' },
  { id: 'hired', label: 'Трудоустроен', color: '#10b981' },
  { id: 'reserve', label: 'Резерв', color: '#cbd5e1' },
];

export const candidatesDb: Candidate[] = assignKanbanOrders([
  { id: 'k1', fullName: 'Иван Петров', role: 'Senior Java Developer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 7, stack: ['Java', 'Spring', 'Kafka', 'PostgreSQL', 'Docker'], rateMonth: 480000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'presented', daysInStatus: 3, vacancyIds: ['v1'], telegram: '@ivan_petrov', phone: '+7 (916) 555-12-23' },
  { id: 'k2', fullName: 'Алина Смирнова', role: 'Senior React Developer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 6, stack: ['React', 'TypeScript', 'Next.js'], rateMonth: 460000, employmentType: 'СМЗ', format: 'Удалённо', location: 'СПб', source: 'LinkedIn', recruiterId: 'u4', status: 'presented', daysInStatus: 9, vacancyIds: ['v2'] },
  { id: 'k3', fullName: 'Сергей Николаев', role: 'DevOps Engineer', engagementType: 'agency', grade: 'Middle', experienceYears: 4, stack: ['Kubernetes', 'AWS', 'Terraform'], rateMonth: 400000, employmentType: 'ИП', format: 'Удалённо', location: 'Екатеринбург', source: 'Telegram', recruiterId: 'u5', status: 'recruiter_iv', daysInStatus: 2, vacancyIds: ['v3'] },
  { id: 'k4', fullName: 'Мария Иванова', role: 'Lead Data Engineer', engagementType: 'agency', grade: 'Lead', experienceYears: 10, stack: ['Python', 'Spark', 'Airflow', 'AWS'], rateMonth: 620000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', source: 'Рекомендация', recruiterId: 'u6', status: 'ready', daysInStatus: 1, vacancyIds: [] },
  { id: 'k5', fullName: 'Дмитрий Козлов', role: 'QA Automation Engineer', engagementType: 'outstaff', grade: 'Middle', experienceYears: 5, stack: ['Python', 'Selenium', 'Pytest', 'Postman'], rateMonth: 370000, employmentType: 'ТК РФ', format: 'Офис', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'presented', daysInStatus: 6, vacancyIds: ['v5'] },
  { id: 'k6', fullName: 'Ольга Лебедева', role: 'Senior iOS Developer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 8, stack: ['Swift', 'SwiftUI', 'Combine', 'Objective-C'], rateMonth: 530000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', source: 'LinkedIn', recruiterId: 'u6', status: 'offer', daysInStatus: 4, vacancyIds: ['v6'] },
  { id: 'k7', fullName: 'Андрей Соколов', role: 'Backend Developer (Go)', engagementType: 'agency', grade: 'Middle', experienceYears: 4, stack: ['Go', 'gRPC', 'PostgreSQL'], rateMonth: 430000, employmentType: 'СМЗ', format: 'Офис', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'new', daysInStatus: 1, vacancyIds: [] },
  { id: 'k8', fullName: 'Наталья Волкова', role: 'ML Engineer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 6, stack: ['Python', 'PyTorch', 'MLOps', 'Kubernetes'], rateMonth: 560000, employmentType: 'ИП', format: 'Удалённо', location: 'СПб', source: 'GitHub', recruiterId: 'u5', status: 'presented', daysInStatus: 11, vacancyIds: ['v8'] },
  { id: 'k9', fullName: 'Михаил Зайцев', role: 'SRE Engineer', engagementType: 'agency', grade: 'Senior', experienceYears: 7, stack: ['Kubernetes', 'Prometheus', 'Go', 'Terraform'], rateMonth: 560000, employmentType: 'ИП', format: 'Удалённо', location: 'Казань', source: 'Telegram', recruiterId: 'u5', status: 'hired', daysInStatus: 18, vacancyIds: ['v9'] },
  { id: 'k10', fullName: 'Екатерина Беляева', role: 'Product Analyst', engagementType: 'outstaff', grade: 'Middle', experienceYears: 4, stack: ['SQL', 'Python', 'Tableau', 'PowerBI'], rateMonth: 380000, employmentType: 'ТК РФ', format: 'Гибрид', location: 'Москва', source: 'hh.ru', recruiterId: 'u4', status: 'recruiter_iv', daysInStatus: 5, vacancyIds: [] },
  { id: 'k11', fullName: 'Павел Морозов', role: 'Senior Backend (Java)', engagementType: 'outstaff', grade: 'Senior', experienceYears: 9, stack: ['Java', 'Spring', 'Kafka'], rateMonth: 500000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', source: 'Рекомендация', recruiterId: 'u5', status: 'presented', daysInStatus: 2, vacancyIds: ['v1'] },
  { id: 'k12', fullName: 'Юлия Тарасова', role: 'ML Engineer', engagementType: 'agency', grade: 'Senior', experienceYears: 5, stack: ['Python', 'PyTorch', 'TensorFlow'], rateMonth: 540000, employmentType: 'СМЗ', format: 'Удалённо', location: 'СПб', source: 'LinkedIn', recruiterId: 'u6', status: 'reserve', daysInStatus: 30, vacancyIds: [] },
]);
