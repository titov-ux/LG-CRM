# Нагрузочный тест

Имитирует «рабочий день»: логин → дашборд → списки → открытие карточек → канбан-операции. Покрывает нефункциональные требования ТЗ §6.1 (100 одновременных пользователей, 500 карточек).

## Запуск

```bash
pip install locust
export USER_EMAIL=admin@lg.ru
export USER_PASSWORD='ваш-пароль'

locust -f tests/loadtest/locustfile.py \
    --host=https://staging.crm.lg.ru \
    --users 100 --spawn-rate 10 \
    --run-time 10m \
    --headless --csv loadtest
```

После завершения смотрим `loadtest_stats.csv` / `loadtest_failures.csv`. Метрики, которые должны держаться:

- p95 чтения списков `< 500 ms`
- p95 канбан-операций `< 800 ms`
- 0 ошибок 5xx
- 0 timeouts на 30-секундный wait

## Подготовка данных

Чтобы канбан не был пустым, разово залейте seed:

```bash
cd frontend && pnpm export-seed
cd ../backend && make seed-from-mocks
```

Для теста с 500 карточками — после импорта прогоните вспомогательный скрипт-генератор (отдельный файл, не входит в эту папку; делается под конкретный сценарий).
