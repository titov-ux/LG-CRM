"""Замерить тайминги ключевых perf-эндпоинтов и распечатать p50/p95.

Сценарии (соответствуют 3 экранам из PERF-отчёта):
  1) GET /candidates           — список кандидатов с разными фильтрами,
                                  плюс отдельный замер «канбан» (pageSize=200);
  2) GET /vacancies            — канбан вакансий (pageSize=200);
  3) GET /candidates?vacancyId — прикреплённые к вакансии (для карточки);
  4) GET /candidates/{id}      — открытие карточки;
  5) GET /vacancies/{id}       — открытие карточки вакансии;
  6) PUT /candidates/kanban-order — батч drag-n-drop из 10 карточек.

Требует:
  * поднятый локально backend на http://localhost:8000;
  * выполнен `python -m scripts.perf_seed` для данных;
  * рабочий аккаунт (admin@lg.ru / пароль из .env, либо через --email/--password).

Запуск:
  PYTHONPATH=. python -m scripts.perf_bench
Параметры:
  --base-url   адрес бэка (default http://localhost:8000)
  --email      логин (default admin@lg.ru)
  --password   пароль (default из .env ADMIN_PASSWORD, либо 'change-me')
  --iterations число повторов на сценарий (default 30)
  --warmup     число прогревочных запросов (default 3)
"""
from __future__ import annotations

import argparse
import asyncio
import os
import statistics
import time
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class Scenario:
    name: str
    method: str
    path: str
    params: dict[str, Any] | None = None
    json_body: Any | None = None
    # Если задан — берётся id из ответа предыдущего сценария с этим именем.
    needs_candidate_id: bool = False
    needs_vacancy_id: bool = False


SCENARIOS: list[Scenario] = [
    Scenario("list_candidates_default", "GET", "/api/v1/candidates", {"pageSize": 50}),
    Scenario(
        "list_candidates_kanban", "GET", "/api/v1/candidates",
        {"pageSize": 200, "archived": "false"},
    ),
    Scenario(
        "list_candidates_search", "GET", "/api/v1/candidates",
        {"search": "Тестовый", "pageSize": 50},
    ),
    Scenario(
        "list_candidates_filtered", "GET", "/api/v1/candidates",
        {"grade": "Senior", "engagementType": "outstaff", "pageSize": 50},
    ),
    Scenario("list_vacancies_kanban", "GET", "/api/v1/vacancies", {"pageSize": 200}),
    Scenario(
        "list_candidates_by_vacancy", "GET", "/api/v1/candidates",
        {"pageSize": 200}, needs_vacancy_id=True,
    ),
    Scenario("get_candidate", "GET", "/api/v1/candidates/{id}", needs_candidate_id=True),
    Scenario("get_vacancy", "GET", "/api/v1/vacancies/{id}", needs_vacancy_id=True),
]


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    f, c = int(k), min(int(k) + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


async def login(client: httpx.AsyncClient, base_url: str, email: str, password: str) -> str:
    r = await client.post(
        f"{base_url}/api/v1/auth/login",
        json={"email": email, "password": password},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()["accessToken"]


async def pick_seed_ids(client: httpx.AsyncClient, base_url: str, headers: dict[str, str]) -> tuple[str, str]:
    """Берём первый кандидат + первая вакансия — для get-сценариев."""
    r = await client.get(
        f"{base_url}/api/v1/candidates", params={"pageSize": 1}, headers=headers,
    )
    r.raise_for_status()
    cid = r.json()["items"][0]["id"]
    r = await client.get(
        f"{base_url}/api/v1/vacancies", params={"pageSize": 1}, headers=headers,
    )
    r.raise_for_status()
    vid = r.json()["items"][0]["id"]
    return cid, vid


async def measure(
    client: httpx.AsyncClient,
    base_url: str,
    headers: dict[str, str],
    sc: Scenario,
    cid: str,
    vid: str,
    iterations: int,
    warmup: int,
) -> dict[str, float]:
    path = sc.path.replace("{id}", cid if sc.needs_candidate_id else vid)
    params = dict(sc.params or {})
    if sc.needs_vacancy_id and "{id}" not in sc.path:
        params["vacancyId"] = vid

    async def one() -> float:
        t0 = time.perf_counter()
        r = await client.request(
            sc.method, f"{base_url}{path}", params=params, json=sc.json_body, headers=headers
        )
        r.raise_for_status()
        return (time.perf_counter() - t0) * 1000

    for _ in range(warmup):
        await one()
    samples = [await one() for _ in range(iterations)]
    return {
        "p50": percentile(samples, 0.5),
        "p95": percentile(samples, 0.95),
        "min": min(samples),
        "max": max(samples),
        "n": len(samples),
    }


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default=os.environ.get("PERF_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--email", default=os.environ.get("PERF_EMAIL", "admin@lg.ru"))
    parser.add_argument("--password", default=os.environ.get("PERF_PASSWORD", "change-me"))
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--warmup", type=int, default=3)
    args = parser.parse_args()

    async with httpx.AsyncClient(timeout=30) as client:
        token = await login(client, args.base_url, args.email, args.password)
        headers = {"Authorization": f"Bearer {token}"}
        cid, vid = await pick_seed_ids(client, args.base_url, headers)
        print(f"seed candidate_id={cid} vacancy_id={vid}\n")

        print(f"{'scenario':<32}{'p50, ms':>10}{'p95, ms':>10}{'min':>8}{'max':>8}{'n':>5}")
        print("-" * 73)
        for sc in SCENARIOS:
            try:
                m = await measure(client, args.base_url, headers, sc, cid, vid, args.iterations, args.warmup)
                print(
                    f"{sc.name:<32}{m['p50']:>10.1f}{m['p95']:>10.1f}"
                    f"{m['min']:>8.1f}{m['max']:>8.1f}{m['n']:>5}"
                )
            except httpx.HTTPStatusError as e:
                print(f"{sc.name:<32} FAILED: {e.response.status_code} {e.response.text[:80]}")


if __name__ == "__main__":
    asyncio.run(main())
