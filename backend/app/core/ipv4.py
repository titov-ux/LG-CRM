"""Принудительный IPv4 для исходящих соединений.

Зачем: на VM/контейнере есть IPv6-адрес, но нет маршрута наружу по IPv6.
DNS отдаёт и A, и AAAA (например, `api.telegram.org`), а glibc/httpx по
умолчанию предпочитают IPv6 — и коннект падает с `[Errno 101] Network is
unreachable`. Самый надёжный кросс-библиотечный способ это вылечить —
отбрасывать IPv6-адреса на уровне резолва: тогда любой клиент (httpx, asyncpg,
boto3 и т.п.) увидит только IPv4.

Включается флагом `force_ipv4_egress` (см. config) на старте приложения.
Идемпотентно: повторный вызов ничего не ломает.
"""
from __future__ import annotations

import logging
import socket

log = logging.getLogger(__name__)

_PATCHED = False


def force_ipv4() -> None:
    """Обернуть `socket.getaddrinfo`, чтобы он не возвращал IPv6-адреса."""
    global _PATCHED
    if _PATCHED:
        return

    _orig_getaddrinfo = socket.getaddrinfo

    def _ipv4_only(host, port, family=0, *args, **kwargs):
        results = _orig_getaddrinfo(host, port, family, *args, **kwargs)
        filtered = [r for r in results if r[0] == socket.AF_INET]
        # Если IPv4-адресов нет вовсе (host только по IPv6) — отдаём как есть,
        # чтобы не превращать «нет IPv4» в пустой список и непонятную ошибку.
        return filtered or results

    socket.getaddrinfo = _ipv4_only  # type: ignore[assignment]
    _PATCHED = True
    log.info("network: forcing IPv4 egress (getaddrinfo strips IPv6)")
