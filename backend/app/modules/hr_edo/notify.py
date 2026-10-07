"""Письма и уведомления кадрового ЭДО.

* Сотруднику — письмо со ссылкой на портал (SMS на этом шаге не шлём: SMS —
  только код). Если сотрудник — пользователь CRM, дополнительно уведомление
  `hr_document` в CRM и Telegram (через outbox notifications).
* Кадровику (автор документа) — «подписан» / «отказ».

Письма оформлены в той же семье, что приглашение в CRM
(integrations/email.py::render_invite_email).
"""
from __future__ import annotations

import html
import logging
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.integrations.email import send_email
from app.modules.notifications import service as notifications_service
from app.modules.notifications.models import NotificationEntityType, NotificationKind

log = logging.getLogger(__name__)


def portal_url(raw_token: str) -> str:
    return f"{get_settings().app_base_url.rstrip('/')}/sign/{raw_token}"


def my_docs_url() -> str:
    return f"{get_settings().app_base_url.rstrip('/')}/my-docs"


def _render(*, title: str, greeting: str, paragraphs: list[str], button: str | None, url: str | None, footer: str) -> str:
    esc = html.escape
    body = "".join(
        f'<p style="font-size:14px;line-height:1.55;color:#334155;margin:0 0 12px">{p}</p>' for p in paragraphs
    )
    button_html = ""
    if button and url:
        button_html = (
            f'<tr><td style="padding:8px 32px 4px"><a href="{esc(url)}" style="display:inline-block;'
            f"background:#0f172a;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;"
            f'font-size:14px;font-weight:600">{esc(button)}</a></td></tr>'
            f'<tr><td style="padding:14px 32px 4px"><p style="font-size:12.5px;line-height:1.5;color:#64748b;margin:0">'
            f'Или скопируйте ссылку:<br><span style="word-break:break-all;color:#0f172a">{esc(url)}</span></p></td></tr>'
        )
    company = esc(get_settings().hr_edo_company_short)
    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><title>{esc(title)}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,sans-serif;color:#0f172a">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,.08)">
    <tr><td style="padding:24px 32px 8px">
      <div style="display:inline-flex;align-items:center;gap:10px;font-weight:700;color:#0f172a">
        <span style="display:inline-flex;width:32px;height:32px;align-items:center;justify-content:center;background:#0f172a;color:#fff;border-radius:6px;font-size:12px">ЛГ</span>
        <span>{company} · Кадровые документы</span>
      </div>
    </td></tr>
    <tr><td style="padding:8px 32px 0">
      <h1 style="font-size:20px;font-weight:600;margin:8px 0 12px">{esc(greeting)}</h1>
      {body}
    </td></tr>
    {button_html}
    <tr><td style="padding:18px 32px 28px;border-top:1px solid #e2e8f0">
      <p style="font-size:12px;line-height:1.5;color:#94a3b8;margin:16px 0 0">{esc(footer)}</p>
    </td></tr>
  </table>
</body></html>"""


async def _send(to: str | None, subject: str, text: str, html_body: str) -> bool:
    if not to:
        return False
    try:
        return await send_email(to=to, subject=subject, text_body=text, html_body=html_body)
    except Exception:
        log.exception("hr_edo: email send failed")
        return False


def _first_name(full_name: str) -> str:
    parts = full_name.split()
    # «Иванов Иван Иванович» → «Иван Иванович»; «Иван» → «Иван».
    return " ".join(parts[1:]) if len(parts) >= 2 else full_name


async def email_consent_invite(*, to: str | None, full_name: str, url: str) -> bool:
    ttl = get_settings().hr_edo_link_ttl_days
    subject = "Переход на кадровый электронный документооборот"
    paragraphs = [
        "Компания переходит на кадровый электронный документооборот: трудовые документы можно будет подписывать с телефона кодом из SMS.",
        "По ссылке — пакет документов: согласие на КЭДО и соглашение об электронной подписи. "
        "Его нужно подписать до первого электронного документа: на бумаге, Госключом или своей УКЭП.",
        "Если вы не хотите переходить на электронный документооборот — ничего делать не нужно, документы останутся бумажными.",
    ]
    text = (
        f"Здравствуйте, {_first_name(full_name)}!\n\n" + "\n\n".join(paragraphs) + f"\n\n{url}\n\nСсылка действует {ttl} дней."
    )
    body = _render(
        title=subject,
        greeting=f"Здравствуйте, {_first_name(full_name)}!",
        paragraphs=[html.escape(p) for p in paragraphs],
        button="Открыть документы",
        url=url,
        footer=f"Ссылка действует {ttl} дней. Вход подтверждается кодом из SMS.",
    )
    return await _send(to, subject, text, body)


async def email_get_signature(*, to: str | None, full_name: str, url: str) -> bool:
    subject = "Получите электронную подпись"
    paragraphs = [
        "Ваше согласие на кадровый электронный документооборот зарегистрировано.",
        "Перейдите по ссылке и нажмите «Получить подпись»: мы отправим код на номер из соглашения, "
        "и вы сможете подписывать документы с телефона.",
    ]
    text = f"Здравствуйте, {_first_name(full_name)}!\n\n" + "\n\n".join(paragraphs) + f"\n\n{url}"
    body = _render(
        title=subject,
        greeting=f"Здравствуйте, {_first_name(full_name)}!",
        paragraphs=[html.escape(p) for p in paragraphs],
        button="Получить подпись",
        url=url,
        footer="Никому не сообщайте коды из SMS — даже сотрудникам компании.",
    )
    return await _send(to, subject, text, body)


async def email_key_issued(*, to: str | None, full_name: str, fingerprint: str, issued_at: str) -> bool:
    subject = "Электронная подпись выпущена"
    groups = " ".join(fingerprint[i : i + 4] for i in range(0, len(fingerprint), 4))
    paragraphs = [
        f"Ваша усиленная неквалифицированная электронная подпись выпущена {html.escape(issued_at)}.",
        f"Отпечаток открытого ключа (ГОСТ Р 34.11-2012):<br><b style=\"font-family:monospace;word-break:break-all\">{html.escape(groups)}</b>",
        "Сохраните это письмо: по отпечатку можно проверить, что документ подписан именно вашим ключом.",
    ]
    text = (
        f"Здравствуйте, {_first_name(full_name)}!\n\nЭлектронная подпись выпущена {issued_at}.\n"
        f"Отпечаток открытого ключа: {groups}\n\nСохраните это письмо."
    )
    body = _render(
        title=subject,
        greeting=f"Здравствуйте, {_first_name(full_name)}!",
        paragraphs=paragraphs,
        button=None,
        url=None,
        footer="Если вы не выпускали подпись — срочно сообщите кадровику.",
    )
    return await _send(to, subject, text, body)


async def email_documents_to_sign(*, to: str | None, full_name: str, titles: list[str], url: str, reminder: bool = False) -> bool:
    subject = "Напоминание: документы ждут подписи" if reminder else "Документы на подпись"
    items = "".join(f"<li>{html.escape(t)}</li>" for t in titles)
    paragraphs = [
        ("Напоминаем: " if reminder else "")
        + ("вам направлены документы на подпись:" if len(titles) > 1 else "вам направлен документ на подпись:"),
        f'<ul style="margin:0;padding-left:18px">{items}</ul>',
        "Откройте документы, ознакомьтесь до конца и подпишите кодом из SMS. Если не согласны — можно отказаться с указанием причины.",
    ]
    text = (
        f"Здравствуйте, {_first_name(full_name)}!\n\n"
        + ("Напоминаем: " if reminder else "")
        + "документы на подпись:\n- "
        + "\n- ".join(titles)
        + f"\n\n{url}"
    )
    body = _render(
        title=subject,
        greeting=f"Здравствуйте, {_first_name(full_name)}!",
        paragraphs=paragraphs,
        button="Открыть документы",
        url=url,
        footer="Коды подтверждения приходят только по SMS. Никому их не сообщайте.",
    )
    return await _send(to, subject, text, body)


async def notify_user(
    db: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    text: str,
    document_id: uuid.UUID | None,
    target: str = "my",
) -> None:
    """`target`: куда ведёт уведомление во фронте — `my` («Мои документы»,
    сотруднику) или `hr` («Кадровые документы», кадровику)."""
    if user_id is None:
        return
    await notifications_service.notify(
        db,
        recipient_id=user_id,
        kind=NotificationKind.hr_document,
        text=text,
        entity_type=NotificationEntityType.hr_document if document_id else None,
        entity_id=document_id,
        payload={"target": target},
    )
