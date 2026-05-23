"""Нагрузочный сценарий для staging.

Цель — проверить нефункциональные требования ТЗ §6.1: 100 одновременных
пользователей, 500 карточек на доске. Сценарий имитирует «рабочий день»:
логин → читаем дашборд / списки → периодически меняем статусы / прикрепляем.

Запуск:
    pip install locust
    locust -f tests/loadtest/locustfile.py \
        --host=https://crm.lg.ru \
        --users 100 --spawn-rate 10 \
        --run-time 10m \
        --headless --csv loadtest

Перед запуском seed_admin создаст одного пользователя; для разных user-сессий
можно либо использовать ENV USER_EMAIL/USER_PASSWORD, либо предварительно
завести 100 учёток через seed_from_mocks (там их пока 6).
"""
from __future__ import annotations

import os
import random

from locust import HttpUser, between, task


class CrmUser(HttpUser):
    wait_time = between(1, 5)

    def on_start(self) -> None:
        email = os.environ.get("USER_EMAIL", "admin@lg.ru")
        password = os.environ.get("USER_PASSWORD", "change-me")
        r = self.client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": password},
            name="auth.login",
        )
        if r.status_code != 200:
            r.failure(f"login failed: {r.status_code}")
            self.environment.runner.quit()
            return
        token = r.json()["accessToken"]
        self.client.headers["Authorization"] = f"Bearer {token}"
        # Кэшируем первые id-шники, чтобы потом дёргать /{id}.
        self.vacancy_ids: list[str] = []
        self.candidate_ids: list[str] = []
        self._prefetch_ids()

    def _prefetch_ids(self) -> None:
        r = self.client.get("/api/v1/vacancies?pageSize=50", name="vacancies.list")
        if r.ok:
            self.vacancy_ids = [v["id"] for v in r.json().get("items", [])]
        r = self.client.get("/api/v1/candidates?pageSize=50", name="candidates.list")
        if r.ok:
            self.candidate_ids = [c["id"] for c in r.json().get("items", [])]

    @task(8)
    def view_dashboard(self) -> None:
        self.client.get("/api/v1/analytics/summary", name="analytics.summary")
        self.client.get("/api/v1/analytics/funnel", name="analytics.funnel")

    @task(15)
    def list_vacancies(self) -> None:
        self.client.get(
            f"/api/v1/vacancies?page={random.randint(1, 3)}&pageSize=50",
            name="vacancies.list",
        )

    @task(15)
    def list_candidates(self) -> None:
        self.client.get(
            f"/api/v1/candidates?page={random.randint(1, 3)}&pageSize=50",
            name="candidates.list",
        )

    @task(5)
    def open_vacancy_with_matches(self) -> None:
        if not self.vacancy_ids:
            return
        vid = random.choice(self.vacancy_ids)
        self.client.get(f"/api/v1/vacancies/{vid}", name="vacancies.byId")
        self.client.get(f"/api/v1/vacancies/{vid}/candidates", name="matching.byVacancy")

    @task(3)
    def open_candidate(self) -> None:
        if not self.candidate_ids:
            return
        cid = random.choice(self.candidate_ids)
        self.client.get(f"/api/v1/candidates/{cid}", name="candidates.byId")
        self.client.get(f"/api/v1/candidates/{cid}/activity", name="candidates.activity")

    @task(2)
    def notifications(self) -> None:
        self.client.get("/api/v1/notifications", name="notifications.list")
