"""SMTP-отправка писем.

Используем стандартный `smtplib` через `asyncio.to_thread` — это избавляет от
лишней зависимости (`aiosmtplib`) и работает с любым SMTP-провайдером. На проде
ожидаем Яндекс 360 для бизнеса: `smtp.yandex.ru:465` + ящик `noreply@lachevsky.group`
+ «пароль приложения» из Яндекс ID.

Без настроенного SMTP отправка вырождается в лог в stdout — это и для dev
удобно (можно скопировать ссылку), и для безопасной деградации в проде.
"""
from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.core.config import get_settings

log = logging.getLogger(__name__)


def _build_message(
    *,
    sender: str,
    sender_name: str,
    to: str,
    subject: str,
    text_body: str,
    html_body: str | None,
) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((sender_name, sender))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=sender.split("@", 1)[-1] or "localhost")
    msg.set_content(text_body, charset="utf-8")
    if html_body:
        msg.add_alternative(html_body, subtype="html")
    return msg


def _send_blocking(
    *,
    host: str,
    port: int,
    use_ssl: bool,
    user: str,
    password: str,
    timeout: float,
    msg: EmailMessage,
) -> None:
    """Синхронная отправка через smtplib — выполняется в thread-pool."""
    context = ssl.create_default_context()
    if use_ssl:
        with smtplib.SMTP_SSL(host, port, timeout=timeout, context=context) as smtp:
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as smtp:
            smtp.ehlo()
            smtp.starttls(context=context)
            smtp.ehlo()
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)


async def send_email(
    *,
    to: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> bool:
    """Отправить письмо. Возвращает True, если реально ушло.

    Если SMTP не настроен — логируем превью и возвращаем False. Эндпоинты могут
    использовать возвращаемое значение, чтобы решить, показывать ли админу invite-
    ссылку в ответе (fallback для dev/staging).
    """
    settings = get_settings()
    if not settings.smtp_host or not settings.smtp_user:
        log.warning(
            "SMTP not configured — email NOT sent. Preview:\n"
            "  to=%s\n  subject=%s\n  body=%s",
            to,
            subject,
            text_body,
        )
        return False

    sender = settings.smtp_from or settings.smtp_user
    msg = _build_message(
        sender=sender,
        sender_name=settings.smtp_from_name,
        to=to,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )

    try:
        await asyncio.to_thread(
            _send_blocking,
            host=settings.smtp_host,
            port=settings.smtp_port,
            use_ssl=settings.smtp_use_ssl,
            user=settings.smtp_user,
            password=settings.smtp_password,
            timeout=settings.smtp_timeout_seconds,
            msg=msg,
        )
    except (smtplib.SMTPException, OSError) as e:
        log.error("SMTP send failed: %s", e, exc_info=True)
        return False
    return True


# ── Шаблоны писем ──────────────────────────────────────────────────────────


def render_invite_email(*, full_name: str, invite_url: str, ttl_days: int) -> tuple[str, str, str]:
    """Возвращает (subject, text, html) для приглашения нового пользователя."""
    subject = "Приглашение в CRM ЛГ Интеграция"
    text = (
        f"Здравствуйте, {full_name}!\n\n"
        f"Для вас создана учётная запись в CRM ЛГ Интеграция.\n"
        f"Чтобы задать пароль и активировать аккаунт, перейдите по ссылке:\n\n"
        f"{invite_url}\n\n"
        f"Ссылка действительна {ttl_days} дней. Если вы не ждали этого письма — "
        f"просто проигнорируйте его, учётная запись останется неактивной.\n\n"
        f"— ЛГ Интеграция"
    )
    html = f"""<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>{subject}</title></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;color:#0f172a">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08)">
    <tr><td style="padding:28px 32px 8px">
      <div style="display:inline-flex;align-items:center;gap:10px;font-weight:700;color:#0f172a">
        <span style="display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;background:#0f172a;color:#fff;border-radius:6px;font-size:12px">ЛГ</span>
        <span>ЛГ Интеграция · CRM</span>
      </div>
    </td></tr>
    <tr><td style="padding:8px 32px 0">
      <h1 style="font-size:20px;font-weight:600;margin:8px 0 12px">Здравствуйте, {full_name}!</h1>
      <p style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 16px">
        Для вас создана учётная запись в CRM ЛГ Интеграция.
        Чтобы задать пароль и активировать аккаунт, нажмите кнопку ниже.
      </p>
    </td></tr>
    <tr><td style="padding:8px 32px 4px">
      <a href="{invite_url}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:14px;font-weight:600">
        Задать пароль
      </a>
    </td></tr>
    <tr><td style="padding:18px 32px 8px">
      <p style="font-size:12.5px;line-height:1.5;color:#64748b;margin:0">
        Или скопируйте ссылку:<br>
        <span style="word-break:break-all;color:#0f172a">{invite_url}</span>
      </p>
    </td></tr>
    <tr><td style="padding:18px 32px 28px;border-top:1px solid #e2e8f0;margin-top:16px">
      <p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:16px 0 0">
        Ссылка действительна {ttl_days} дней. Если вы не ждали этого письма — просто проигнорируйте его,
        учётная запись останется неактивной.
      </p>
    </td></tr>
  </table>
</body>
</html>"""
    return subject, text, html
