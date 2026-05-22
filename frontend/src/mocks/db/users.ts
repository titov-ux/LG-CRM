import type { User } from '@/api/types';

export const usersDb: User[] = [
  { id: 'u1', email: 'titov@lg-integration.ru', telegram: '@alexey_titov', fullName: 'Алексей Титов', initials: 'АТ', role: 'admin', color: '#0f172a', isActive: true },
  { id: 'u2', email: 'sokolova@lg-integration.ru', telegram: '@maria_sokolova_lg', fullName: 'Мария Соколова', initials: 'МС', role: 'account_manager', color: '#7c3aed', isActive: true },
  { id: 'u3', email: 'orlov@lg-integration.ru', telegram: '@dmitriy_orlov_lg', fullName: 'Дмитрий Орлов', initials: 'ДО', role: 'account_manager', color: '#0891b2', isActive: true },
  { id: 'u4', email: 'kuznetsova@lg-integration.ru', telegram: '@anna_kuznetsova_hr', fullName: 'Анна Кузнецова', initials: 'АК', role: 'recruiter', color: '#db2777', isActive: true },
  { id: 'u5', email: 'vasiliev@lg-integration.ru', telegram: '@igor_vasiliev_hr', fullName: 'Игорь Васильев', initials: 'ИВ', role: 'recruiter', color: '#ea580c', isActive: true },
  { id: 'u6', email: 'morozova@lg-integration.ru', telegram: '@elena_morozova_hr', fullName: 'Елена Морозова', initials: 'ЕМ', role: 'recruiter', color: '#16a34a', isActive: true },
];
