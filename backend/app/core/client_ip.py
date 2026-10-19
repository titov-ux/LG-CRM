"""IP клиента за reverse-proxy.

За nginx доверяем только тому, что дописал сам прокси:
  • `X-Real-IP` — nginx ставит его из `$remote_addr` и перезаписывает
    клиентское значение (`proxy_set_header X-Real-IP $remote_addr`);
  • ПОСЛЕДНИЙ элемент `X-Forwarded-For` — его дописывает nginx
    (`$proxy_add_x_forwarded_for`).
Левые элементы `X-Forwarded-For` присылает сам клиент — по ним нельзя
считать лимиты попыток входа или писать IP в доказательную базу.

`request.client.host` — только запасной вариант: uvicorn с
`--proxy-headers --forwarded-allow-ips=*` подставляет туда ЛЕВЫЙ элемент XFF.
"""
from __future__ import annotations

import ipaddress

from starlette.requests import Request


def trusted_client_ip(request: Request) -> str | None:
    raw = (
        request.headers.get("X-Real-IP", "").strip()
        or request.headers.get("X-Forwarded-For", "").split(",")[-1].strip()
        or (request.client.host if request.client else "")
    )
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return None
