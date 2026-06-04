// Единая «БД» для MSW. Все хендлеры модифицируют объекты прямо здесь —
// это даёт нам state между запросами на время сессии браузера.

export { usersDb } from './users';
export { clientsDb, contactsDb } from './clients';
export { vacanciesDb, vacancyStatuses, persistVacanciesDb } from './vacancies';
export { tendersDb, persistTendersDb } from './tenders';
export { candidatesDb, candidateStatuses, persistCandidatesDb } from './candidates';
export { notificationsDb, activityDb, auditDb } from './notifications';
export { commentsDb } from './comments';
export {
  permissionsMatrixDb,
  updatePermissionRow,
  resetPermissionsMatrix,
} from './permissionsMatrix';
