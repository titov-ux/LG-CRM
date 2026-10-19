"""Быстрая проверка внешних интеграций после деплоя (без побочных эффектов).

    docker compose ... exec -T backend python -m scripts.check_integrations
"""
from __future__ import annotations

import smtplib
import ssl

import httpx

from app.core.config import get_settings

s = get_settings()


def line(name: str, ok: bool | None, msg: str) -> None:
    mark = {True: "✔", False: "✘", None: "–"}[ok]
    print(f"  {mark} {name}: {msg}")


def smtp() -> None:
    if not s.smtp_password:
        return line("Почта (SMTP)", None, "не настроено")
    try:
        if s.smtp_use_ssl:
            srv = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=15, context=ssl.create_default_context())
        else:
            srv = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
            srv.starttls(context=ssl.create_default_context())
        srv.login(s.smtp_user, s.smtp_password)
        srv.quit()
        line("Почта (SMTP)", True, f"вход {s.smtp_user} успешен")
    except Exception as e:  # noqa: BLE001
        line("Почта (SMTP)", False, repr(e)[:200])


def yandex_gpt() -> None:
    if not s.yandex_api_key:
        return line("YandexGPT", None, "не настроено")
    try:
        r = httpx.post(
            f"{s.yandex_ai_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Api-Key {s.yandex_api_key}", "OpenAI-Project": s.yandex_folder_id},
            json={"model": f"gpt://{s.yandex_folder_id}/{s.yandex_ai_model}",
                  "messages": [{"role": "user", "content": "Ответь одним словом: ок"}], "max_tokens": 5},
            timeout=30,
        )
        line("YandexGPT", r.status_code == 200, f"HTTP {r.status_code} {r.text[:150] if r.status_code != 200 else ''}")
    except Exception as e:  # noqa: BLE001
        line("YandexGPT", False, repr(e)[:200])


def telegram() -> None:
    if not s.telegram_bot_token:
        return line("Telegram", None, "не настроено")
    base = (s.telegram_api_base or "https://api.telegram.org").rstrip("/")
    try:
        r = httpx.get(f"{base}/bot{s.telegram_bot_token}/getMe", timeout=15,
                      proxy=s.telegram_api_proxy or None)
        ok = r.status_code == 200 and r.json().get("ok")
        line("Telegram", bool(ok), f"@{r.json().get('result', {}).get('username')}" if ok else f"HTTP {r.status_code} {r.text[:150]}")
        if ok:
            w = httpx.get(f"{base}/bot{s.telegram_bot_token}/getWebhookInfo", timeout=15,
                          proxy=s.telegram_api_proxy or None).json().get("result", {})
            line("Telegram webhook", bool(w.get("url")), f"{w.get('url') or 'не зарегистрирован'} {w.get('last_error_message') or ''}")
    except Exception as e:  # noqa: BLE001
        line("Telegram", False, repr(e)[:200])


def hh() -> None:
    if not s.hh_client_id:
        return line("hh.ru", None, "не настроено")
    line("hh.ru", True, "ключи приложения заданы — подключите аккаунт в CRM: Настройки → Интеграции")


def s3() -> None:
    try:
        import boto3
        from botocore.client import Config
        c = boto3.client("s3", endpoint_url=s.s3_endpoint, region_name=s.s3_region,
                         aws_access_key_id=s.s3_access_key, aws_secret_access_key=s.s3_secret_key,
                         config=Config(signature_version="s3v4"))
        c.head_bucket(Bucket=s.s3_bucket)
        line("S3 (файлы)", True, s.s3_bucket)
    except Exception as e:  # noqa: BLE001
        line("S3 (файлы)", False, repr(e)[:200])


if __name__ == "__main__":
    for f in (s3, smtp, yandex_gpt, telegram, hh):
        f()
