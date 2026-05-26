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
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from app.core.config import get_settings

log = logging.getLogger(__name__)

ASSETS_DIR = Path(__file__).resolve().parent / "assets"


@dataclass(frozen=True)
class InlineImage:
    """Inline-вложение, на которое HTML ссылается через `cid:<cid>`.

    Используем именно CID, а не data: URI — Mail.ru / Gmail / Outlook надёжнее
    рендерят CID-вложения, а data: URI часто режется или скрывается под
    «загрузить изображения».
    """

    cid: str        # без угловых скобок, например "bubbles@lg"
    path: Path      # путь к файлу в ASSETS_DIR
    mime_main: str  # "image"
    mime_sub: str   # "jpeg" / "png"


def _build_message(
    *,
    sender: str,
    sender_name: str,
    to: str,
    subject: str,
    text_body: str,
    html_body: str | None,
    inline_images: tuple[InlineImage, ...] = (),
) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((sender_name, sender))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=sender.split("@", 1)[-1] or "localhost")
    msg.set_content(text_body, charset="utf-8")
    if html_body:
        msg.add_alternative(html_body, subtype="html")
        # Inline-картинки добавляются как related-части HTML-альтернативы,
        # иначе они приедут как обычные attachment и не подтянутся по cid.
        if inline_images:
            html_part = msg.get_payload()[-1]
            for img in inline_images:
                data = img.path.read_bytes()
                html_part.add_related(
                    data,
                    maintype=img.mime_main,
                    subtype=img.mime_sub,
                    cid=f"<{img.cid}>",
                    filename=img.path.name,
                )
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
    inline_images: tuple[InlineImage, ...] = (),
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
        inline_images=inline_images,
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


# Статичный «снимок» фона LoginPage/InvitePage: размытые цветные пузыри в той
# же палитре, что в frontend/.../BubbleBackdrop.tsx. Картинка прегенерируется
# офлайн (скрипт см. в Git-истории файла) и коммитится как ассет — рендерится
# во всех клиентах, включая Mail.ru, где CSS-фильтры и SVG-анимации режутся.
INVITE_BUBBLES_IMAGE = InlineImage(
    cid="bubbles@lg-invite",
    path=ASSETS_DIR / "email_bubbles.jpg",
    mime_main="image",
    mime_sub="jpeg",
)


def render_invite_email(
    *, full_name: str, invite_url: str, ttl_days: int
) -> tuple[str, str, str, tuple[InlineImage, ...]]:
    """Возвращает (subject, text, html, inline_images) для приглашения нового
    пользователя.

    HTML-шаблон оформлен в той же визуальной семье, что и страницы LoginPage /
    InvitePage: «стеклянная» белая карточка поверх размытых цветных пузырей.
    Сами пузыри — это inline-картинка, см. [[INVITE_BUBBLES_IMAGE]]. Если
    клиент по какой-то причине не подтянет CID — карточка останется белой
    с фоном #f8fafc, и письмо будет читаемо.
    """
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
    bubbles_cid = INVITE_BUBBLES_IMAGE.cid
    html = f"""<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>{subject}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;color:#0f172a">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08)">
    <tr><td style="padding:0;line-height:0;font-size:0">
      <img src="cid:{bubbles_cid}" alt="" width="560" height="180" style="display:block;width:100%;height:auto;max-width:560px;border:0;outline:none;text-decoration:none">
    </td></tr>
    <tr><td style="padding:24px 32px 8px">
      <div style="display:inline-flex;align-items:center;gap:10px;font-weight:700;color:#0f172a">
        <span style="display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;background:#0f172a;color:#fff;border-radius:6px;font-size:12px">ЛГ</span>
        <span>ЛГ Интеграция · SaaS</span>
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
    <tr><td style="padding:18px 32px 28px;border-top:1px solid #e2e8f0">
      <p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:16px 0 0">
        Ссылка действительна {ttl_days} дней. Если вы не ждали этого письма — просто проигнорируйте его,
        учётная запись останется неактивной.
      </p>
    </td></tr>
  </table>
</body>
</html>"""
    return subject, text, html, (INVITE_BUBBLES_IMAGE,)
