import type { Client, Contact } from '@/api/types';

export const clientsDb: Client[] = [
  { id: 'c1', name: 'X5 Retail Group', inn: '7728029110', industry: 'Ритейл', accountManagerId: 'u2', status: 'active', vacanciesCount: 8, contactsCount: 3 },
  { id: 'c2', name: 'Т1 Консалтинг', inn: '7730215257', industry: 'IT-консалтинг', accountManagerId: 'u2', status: 'active', vacanciesCount: 12, contactsCount: 5 },
  { id: 'c3', name: 'Газпром Нефть', inn: '5504036333', industry: 'Нефтегаз', accountManagerId: 'u3', status: 'active', vacanciesCount: 6, contactsCount: 4 },
  { id: 'c4', name: 'Московская Биржа', inn: '7702077840', industry: 'Финансы', accountManagerId: 'u3', status: 'in_progress', vacanciesCount: 4, contactsCount: 2 },
  { id: 'c5', name: 'Umbrella IT', inn: '7707083893', industry: 'IT', accountManagerId: 'u2', status: 'lead', vacanciesCount: 2, contactsCount: 1 },
  { id: 'c6', name: 'Альфа-Банк', inn: '7728168971', industry: 'Финансы', accountManagerId: 'u3', status: 'paused', vacanciesCount: 0, contactsCount: 2 },
];

export const contactsDb: Contact[] = [
  { id: 'ct1', clientId: 'c1', name: 'Александр Петров', role: 'CTO', email: 'a.petrov@x5.ru', phone: '+7 (495) 555-01-01' },
  { id: 'ct2', clientId: 'c1', name: 'Ирина Смирнова', role: 'HRD', email: 'i.smirnova@x5.ru', phone: '+7 (495) 555-01-02' },
  { id: 'ct3', clientId: 'c1', name: 'Михаил Иванов', role: 'Project Manager', email: 'm.ivanov@x5.ru', phone: '+7 (495) 555-01-03' },
  { id: 'ct4', clientId: 'c2', name: 'Олег Захаров', role: 'Delivery Director' },
  { id: 'ct5', clientId: 'c3', name: 'Светлана Белова', role: 'HR Lead' },
];
