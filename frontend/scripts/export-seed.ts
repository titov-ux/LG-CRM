/**
 * Экспорт mocks/db в JSON для staging-импорта на бэке.
 *
 * Запускается через `pnpm export-seed` (под капотом `tsx`). Пишет файл
 * `frontend/seed_data.json`, который потом читает `backend/scripts/seed_from_mocks.py`.
 *
 * Это одноразовый инструмент — нужен только при первом наполнении staging-БД
 * демо-данными (см. План_перехода_на_API.docx §7). В прод эти данные не идут.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Импортируем сами TS-модули. Все типы — pure data, side-effects не делают.
import { usersDb } from '../src/mocks/db/users';
import { clientsDb, contactsDb } from '../src/mocks/db/clients';
import { vacanciesDb } from '../src/mocks/db/vacancies';
import { candidatesDb } from '../src/mocks/db/candidates';
import { commentsDb } from '../src/mocks/db/comments';
import { notificationsDb } from '../src/mocks/db/notifications';

const out = {
  users: usersDb,
  clients: clientsDb,
  contacts: contactsDb,
  vacancies: vacanciesDb,
  candidates: candidatesDb,
  comments: commentsDb,
  notifications: notificationsDb,
};

const target = resolve(process.cwd(), 'seed_data.json');
writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');
console.log(`[export-seed] wrote ${target}`);
console.log(
  `[export-seed] counts:`,
  Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  ),
);
