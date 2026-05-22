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
  { id: 'k1', fullName: 'Иван Петров', role: 'Senior Java Developer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 7, stack: ['Java', 'Spring', 'Kafka', 'PostgreSQL', 'Docker'], rateMonth: 480000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', recruiterId: 'u4', status: 'presented', daysInStatus: 3, vacancyIds: ['v1'], telegram: '@ivan_petrov', phone: '+7 (916) 555-12-23' },
  { id: 'k2', fullName: 'Алина Смирнова', role: 'Senior React Developer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 6, stack: ['React', 'TypeScript', 'Next.js'], rateMonth: 460000, employmentType: 'СМЗ', format: 'Удалённо', location: 'СПб', recruiterId: 'u4', status: 'presented', daysInStatus: 9, vacancyIds: ['v2'] },
  { id: 'k3', fullName: 'Сергей Николаев', role: 'DevOps Engineer', engagementType: 'agency', grade: 'Middle', experienceYears: 4, stack: ['Kubernetes', 'AWS', 'Terraform'], rateMonth: 400000, employmentType: 'ИП', format: 'Удалённо', location: 'Екатеринбург', recruiterId: 'u5', status: 'recruiter_iv', daysInStatus: 2, vacancyIds: ['v3'] },
  { id: 'k4', fullName: 'Мария Иванова', role: 'Lead Data Engineer', engagementType: 'agency', grade: 'Lead', experienceYears: 10, stack: ['Python', 'Spark', 'Airflow', 'AWS'], rateMonth: 620000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', recruiterId: 'u6', status: 'ready', daysInStatus: 1, vacancyIds: [] },
  { id: 'k5', fullName: 'Дмитрий Козлов', role: 'QA Automation Engineer', engagementType: 'outstaff', grade: 'Middle', experienceYears: 5, stack: ['Python', 'Selenium', 'Pytest', 'Postman'], rateMonth: 370000, employmentType: 'ТК РФ', format: 'Офис', location: 'Москва', recruiterId: 'u4', status: 'presented', daysInStatus: 6, vacancyIds: ['v5'] },
  { id: 'k6', fullName: 'Ольга Лебедева', role: 'Senior iOS Developer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 8, stack: ['Swift', 'SwiftUI', 'Combine', 'Objective-C'], rateMonth: 530000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', recruiterId: 'u6', status: 'offer', daysInStatus: 4, vacancyIds: ['v6'] },
  { id: 'k7', fullName: 'Андрей Соколов', role: 'Backend Developer (Go)', engagementType: 'agency', grade: 'Middle', experienceYears: 4, stack: ['Go', 'gRPC', 'PostgreSQL'], rateMonth: 430000, employmentType: 'СМЗ', format: 'Офис', location: 'Москва', recruiterId: 'u4', status: 'new', daysInStatus: 1, vacancyIds: [] },
  { id: 'k8', fullName: 'Наталья Волкова', role: 'ML Engineer', engagementType: 'outstaff', grade: 'Senior', experienceYears: 6, stack: ['Python', 'PyTorch', 'MLOps', 'Kubernetes'], rateMonth: 560000, employmentType: 'ИП', format: 'Удалённо', location: 'СПб', recruiterId: 'u5', status: 'presented', daysInStatus: 11, vacancyIds: ['v8'] },
  { id: 'k9', fullName: 'Михаил Зайцев', role: 'SRE Engineer', engagementType: 'agency', grade: 'Senior', experienceYears: 7, stack: ['Kubernetes', 'Prometheus', 'Go', 'Terraform'], rateMonth: 560000, employmentType: 'ИП', format: 'Удалённо', location: 'Казань', recruiterId: 'u5', status: 'hired', daysInStatus: 18, vacancyIds: ['v9'] },
  { id: 'k10', fullName: 'Екатерина Беляева', role: 'Product Analyst', engagementType: 'outstaff', grade: 'Middle', experienceYears: 4, stack: ['SQL', 'Python', 'Tableau', 'PowerBI'], rateMonth: 380000, employmentType: 'ТК РФ', format: 'Гибрид', location: 'Москва', recruiterId: 'u4', status: 'recruiter_iv', daysInStatus: 5, vacancyIds: [] },
  { id: 'k11', fullName: 'Павел Морозов', role: 'Senior Backend (Java)', engagementType: 'outstaff', grade: 'Senior', experienceYears: 9, stack: ['Java', 'Spring', 'Kafka'], rateMonth: 500000, employmentType: 'ИП', format: 'Гибрид', location: 'Москва', recruiterId: 'u5', status: 'presented', daysInStatus: 2, vacancyIds: ['v1'] },
  { id: 'k12', fullName: 'Юлия Тарасова', role: 'ML Engineer', engagementType: 'agency', grade: 'Senior', experienceYears: 5, stack: ['Python', 'PyTorch', 'TensorFlow'], rateMonth: 540000, employmentType: 'СМЗ', format: 'Удалённо', location: 'СПб', recruiterId: 'u6', status: 'reserve', daysInStatus: 30, vacancyIds: [] },
  {
    id: 'k13',
    fullName: 'Михаил Геннадьевич Жуйков',
    role: 'Консультант СЭД ST2',
    engagementType: 'outstaff',
    grade: 'Senior',
    experienceYears: 14,
    stack: [
      'SharePoint',
      'OpenText Content Server',
      'C#',
      'JavaScript',
      'PowerShell',
      'Jira',
      'Confluence',
    ],
    rateMonth: 420000,
    employmentType: 'ИП',
    format: 'Гибрид',
    location: 'Москва',
    recruiterId: 'u4',
    status: 'ready',
    daysInStatus: 2,
    vacancyIds: [],
    birthday: '1981-06-16',
    summary:
      '14 лет работы с платформами SharePoint и СЭД: от установки и миграции до разработки и администрирования. Полный цикл: WSS 3.0 - Subscription Edition, Project Server, Confluence, Jira, OpenText Content Server. Разработка на C#, JavaScript, ASP.NET, создание workflow, PowerShell-автоматизация. Прошёл обучение по OpenText Content Server 25.3 и Directory Services.',
    skillCategories: [
      {
        id: 'sc-lang',
        name: 'Языки программирования',
        items: ['C#', 'JavaScript', 'Groovy', 'PowerShell', 'OScript', 'SQL'],
      },
      {
        id: 'sc-tech',
        name: 'Технологии',
        items: [
          'MS SharePoint (2010/2013/2016/2019/SE)',
          'MS Project Server (2010/2013/2016)',
          'OpenText Content Server 25.3',
          'OpenText Directory Services',
          'Atlassian Confluence',
          'Atlassian Jira',
          'ASP.NET',
          'HTML5',
          'CSS3',
          'XML',
          'JSON',
          'XSL/XSLT',
          'CAML',
          'REST',
          'SOAP',
          'AJAX',
          'Bootstrap',
          'jQuery',
          'SPServices',
          'CSOM',
          'JSOM',
          'CSR',
          'JSLink',
          'InfoPath',
          'IIS',
          'PWA',
        ],
      },
      {
        id: 'sc-admin',
        name: 'Администрирование',
        items: [
          'SharePoint Server',
          'Project Server',
          'Jira',
          'Confluence',
          'Active Directory',
          'IIS',
          'Windows Server 2012',
          'oVirt',
          'ProxMox',
          'Backup Exec (Symantec/Veritas)',
        ],
      },
      {
        id: 'sc-devops',
        name: 'DevOps и автоматизация',
        items: [
          'PowerShell',
          'Visual Studio (WSP)',
          'SharePoint Designer',
          'Eclipse IDE',
          'CSIDE',
          'Timer Job',
          'Event Receiver',
          'Custom Action',
          'Visual Web Part',
          'SSIS',
          'REST API',
          'TFS',
          'Git',
        ],
      },
      {
        id: 'sc-extra',
        name: 'Дополнительно',
        items: ['СЭД', 'системная интеграция', 'миграция SharePoint/Project Server', 'разработка ТЗ и инструкций'],
      },
    ],
    experience: [
      {
        id: 'exp-fintech',
        company: 'АО Финтех',
        position: 'Ведущий инженер-разработчик SharePoint/Jira/Confluence',
        startMonth: '2025-07',
        endMonth: '2026-02',
        project:
          'Инфраструктура АО Финтех: серверы Confluence и Jira на 500+ пользователей, SharePoint-ферма (2010-SE), интеграция с Active Directory.',
        achievements: [
          'Администрирование Confluence и Jira: обновление версий, установка плагинов, миграция пространств',
          'Интеграция Confluence и Jira с Active Directory',
          'Groovy (Eclipse IDE): скрипты для Jira',
          'Миграция SharePoint Server и Project Server (2010, 2013, 2016)',
          'СЭД на SharePoint: 20+ проектов, 500+ пользователей',
          'C#, JavaScript, jQuery, HTML5, CSS3: веб-формы, веб-части, бизнес-аналитика',
          'Восстановление SharePoint 2013 (Backup Exec 15) и 2016 (Veritas Backup Exec 20.3)',
          'PowerShell-скрипты для автоматизации администрирования',
        ],
        stack: [
          'Confluence',
          'Jira',
          'SharePoint Server 2010/2013/2016/2019/SE',
          'Project Server 2010/2013/2016',
          'Active Directory',
          'Groovy',
          'C#',
          'JavaScript',
          'jQuery',
          'HTML5',
          'CSS3',
          'Bootstrap',
          'REST API',
          'SharePoint Designer',
          'Visual Studio (WSP)',
          'PowerShell',
          'IIS',
          'Symantec Backup Exec 15',
          'Veritas Backup Exec 20.3',
          'PWA',
        ],
      },
      {
        id: 'exp-terralink',
        company: 'Terralink Technologies LLC',
        position: 'SharePoint Developer / OpenText Developer',
        startMonth: '2017-05',
        endMonth: '2025-07',
        project:
          'Разработка СЭД на базе SharePoint SE: 5 проектов, 2000+ пользователей. Обучение и работа с OpenText Content Server 25.3.',
        achievements: [
          'Разработка СЭД на SharePoint SE: 5 проектов, 2000+ пользователей',
          'Visual Studio 2022 (WSP): Custom Action, Event Receiver, Timer Job, Visual Web Part',
          'C#, JavaScript, jQuery, HTML5, CSS3: веб-формы и веб-части для СЭД',
          'Полный курс OpenText Content Server 25.3 и Directory Services: OScript, CSIDE, Eclipse IDE',
          'Самостоятельная установка OpenText Directory Services и Content Server 25.3',
          'Workflow в OpenText: создание с нуля, модули на OScript, публикация на сервере',
          'PowerShell-скрипты: автоматизация администрирования и IIS',
          'Разработка проектной и пользовательской документации',
        ],
        stack: [
          'C#',
          'JavaScript',
          'jQuery',
          'HTML5',
          'CSS3',
          'Bootstrap',
          'REST API',
          'SharePoint Designer',
          'Visual Studio 2022 (WSP)',
          'Custom Action',
          'Event Receiver',
          'Timer Job',
          'Visual Web Part',
          'PowerShell',
          'IIS',
          'OpenText Directory Services',
          'OpenText Content Server 25.3',
          'OScript',
          'CSIDE',
          'Eclipse IDE',
        ],
      },
      {
        id: 'exp-xerox',
        company: 'Xerox',
        position: 'Разработчик SharePoint',
        startMonth: '2012-03',
        endMonth: '2017-05',
        project:
          'Установка, настройка и администрирование SharePoint Server и Project Server (2010, 2013). СЭД для 1100+ пользователей.',
        achievements: [
          'Миграция SharePoint и Project Server (WSS 3.0, 2007, 2010, 2013)',
          'СЭД на SharePoint: 30+ проектов, 1100+ пользователей',
          'JavaScript, jQuery, HTML5, CSS3, Bootstrap, AJAX: веб-формы и бизнес-аналитика',
          'SAP + SharePoint 2010/2013: интеграция через Active Directory и SSIS (MS SQL 2008 R2)',
          'SOAP/REST, CAML, SPServices: работа с веб-сервисами',
          'PowerShell-скрипты для автоматизации',
          'Администрирование IIS и Project Server 2010/2013',
          'Восстановление SharePoint 2010: Symantec Backup Exec 12.5',
        ],
        stack: [
          'MS SharePoint Server (WSS 3.0, 2007, 2010, 2013)',
          'MS Project Server (2010, 2013)',
          'JavaScript',
          'jQuery',
          'HTML5',
          'CSS3',
          'Bootstrap',
          'AJAX',
          'REST API',
          'JSON',
          'XML',
          'XSL/XSLT',
          'InfoPath',
          'SharePoint Designer',
          'SOAP',
          'REST',
          'CAML',
          'SPServices',
          'SAP',
          'Active Directory',
          'MS SQL Server 2008 R2',
          'SSIS',
          'PowerShell',
          'IIS',
          'Symantec Backup Exec 12.5',
        ],
      },
    ],
    education: [
      {
        id: 'edu-mephi',
        degree: 'Магистр',
        institution: 'Национальный исследовательский ядерный университет «МИФИ»',
        city: 'Москва',
        graduationYear: 2016,
        specialty: 'Автоматики и электроники, Ядерные физика и технологии',
      },
    ],
    certifications: [
      {
        id: 'cert-opentext',
        title: 'Консультант/администратор и разработчик OpenText Content Server 25.3 и Directory Services',
        issuer: 'Terralink Technologies',
        period: '2017-2025',
      },
    ],
    languages: [
      { language: 'Русский', level: 'родной' },
      { language: 'Английский', level: 'B2' },
    ],
  },
]);

const CANDIDATES_STORAGE_KEY = 'crm-lg:v1:db:candidates';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function hydrateCandidatesFromStorage() {
  if (!canUseStorage()) return;
  try {
    const raw = window.localStorage.getItem(CANDIDATES_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Candidate[];
    if (!Array.isArray(parsed)) return;
    candidatesDb.splice(0, candidatesDb.length, ...parsed);
  } catch {
    // ignore broken local data and keep bundled seed
  }
}

export function persistCandidatesDb() {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(CANDIDATES_STORAGE_KEY, JSON.stringify(candidatesDb));
  } catch {
    // ignore quota/storage errors to avoid breaking app flow
  }
}

hydrateCandidatesFromStorage();
