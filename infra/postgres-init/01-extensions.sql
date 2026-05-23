-- Расширения, необходимые модели данных (архитектура §6.2):
--  * citext  — email/телефон без проверки регистра
--  * pg_trgm — триграммный поиск для contains-фильтров
--  * uuid-ossp — резерв для генерации uuid на стороне сервера
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
