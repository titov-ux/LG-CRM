"""Маппер ответа hh /resumes/{id} → CreateCandidateRequest.

Перекладываем только то, что есть в модели Candidate. Контакты могут быть
скрыты (employer без paid access) — в этом случае оставляем None, пользователь
дозаполнит вручную.

Полная схема ответа hh: github.com/hhru/api/blob/master/docs/employer_resumes.md
"""
from __future__ import annotations

import logging
import re
from datetime import date
from typing import Any

from app.modules.candidates.schemas import (
    CandidateCertification,
    CandidateEducation,
    CandidateExperience,
    CandidateLanguage,
    CreateCandidateRequest,
    SkillCategory,
    LanguageLevel,
)
from app.modules.vacancies.models import Grade, WorkFormat

logger = logging.getLogger(__name__)


# hh уровни языка → наш Literal
_LANG_LEVEL_MAP: dict[str, LanguageLevel] = {
    "a1": "A1",
    "a2": "A2",
    "b1": "B1",
    "b2": "B2",
    "c1": "C1",
    "c2": "C2",
    "l1": "родной",  # «Родной» — hh использует id='l1'
    "native": "родной",
}


def _full_name(payload: dict[str, Any]) -> str:
    parts = [
        (payload.get("last_name") or "").strip(),
        (payload.get("first_name") or "").strip(),
        (payload.get("middle_name") or "").strip(),
    ]
    name = " ".join(p for p in parts if p)
    if name:
        return name
    title = (payload.get("title") or "").strip()
    return title or "Без имени"


def _to_month(value: str | None) -> str:
    """hh даёт даты в формате YYYY-MM-DD; нам нужен YYYY-MM."""
    if not value:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})", value)
    return m.group(0) if m else ""


def _parse_birthday(value: Any) -> date | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _contact_value(payload: dict[str, Any], contact_type: str) -> str | None:
    """contact: [{type:{id:'cell'|'home'|'email'}, value:..., comment:...}]."""
    for c in payload.get("contact") or []:
        t = (c or {}).get("type") or {}
        if (t.get("id") or "").lower() == contact_type:
            v = c.get("value")
            if isinstance(v, dict):
                # для cell/home value = {country, city, number, formatted}
                return (v.get("formatted") or "").strip() or None
            if isinstance(v, str):
                return v.strip() or None
    return None


def _telegram(payload: dict[str, Any]) -> str | None:
    """В hh нет отдельного поля telegram — ищем по site[].url."""
    for site in payload.get("site") or []:
        url = (site or {}).get("url") or ""
        if "t.me/" in url or "@" in url:
            return url.strip()
        kind = ((site or {}).get("type") or {}).get("id") or ""
        if kind.lower() == "telegram":
            return url.strip() or None
    return None


def _experience(payload: dict[str, Any]) -> list[CandidateExperience]:
    out: list[CandidateExperience] = []
    for i, e in enumerate(payload.get("experience") or []):
        e = e or {}
        out.append(
            CandidateExperience(
                id=f"exp-{i}",
                company=(e.get("company") or "").strip(),
                position=(e.get("position") or "").strip(),
                start_month=_to_month(e.get("start")),
                end_month=_to_month(e.get("end")) or None,
                project=None,
                achievements=_split_lines(e.get("description")),
                stack=[],
            )
        )
    return out


def _split_lines(text: str | None) -> list[str]:
    """hh description приходит HTML/plain — снимаем теги и режем по строкам."""
    if not text:
        return []
    # быстрый strip HTML
    cleaned = re.sub(r"<[^>]+>", "\n", text)
    cleaned = re.sub(r"&[a-z]+;", " ", cleaned, flags=re.IGNORECASE)
    items = [line.strip(" •-—\t") for line in cleaned.splitlines()]
    return [i for i in items if len(i) > 3]


def _education(payload: dict[str, Any]) -> list[CandidateEducation]:
    out: list[CandidateEducation] = []
    edu = (payload.get("education") or {}).get("primary") or []
    for i, e in enumerate(edu):
        e = e or {}
        year = e.get("year")
        try:
            year_int = int(year) if year else 0
        except (TypeError, ValueError):
            year_int = 0
        if year_int <= 0:
            continue
        out.append(
            CandidateEducation(
                id=f"edu-{i}",
                degree=((payload.get("education") or {}).get("level") or {}).get("name") or "Высшее",
                institution=(e.get("name") or "").strip(),
                city=None,
                graduation_year=year_int,
                specialty=(e.get("result") or "").strip() or None,
            )
        )
    return out


def _certifications(payload: dict[str, Any]) -> list[CandidateCertification]:
    out: list[CandidateCertification] = []
    for i, c in enumerate(payload.get("certificate") or []):
        c = c or {}
        title = (c.get("title") or "").strip()
        if not title:
            continue
        out.append(
            CandidateCertification(
                id=f"cert-{i}",
                title=title,
                issuer=(c.get("owner") or {}).get("title", "") if isinstance(c.get("owner"), dict) else (c.get("owner") or ""),
                period=(c.get("achieved_at") or "")[:7] or None,
            )
        )
    return out


def _languages(payload: dict[str, Any]) -> list[CandidateLanguage]:
    out: list[CandidateLanguage] = []
    for lang in payload.get("language") or []:
        lang = lang or {}
        name = (lang.get("name") or "").strip()
        if not name:
            continue
        level_raw = (lang.get("level") or {}).get("id") or ""
        level = _LANG_LEVEL_MAP.get(level_raw.lower(), "B1")
        out.append(CandidateLanguage(language=name, level=level))
    return out


def _stack(payload: dict[str, Any]) -> list[str]:
    """skill_set — массив строк-тегов. key_skills устарел, но иногда встречается."""
    raw = payload.get("skill_set") or payload.get("key_skills") or []
    out: list[str] = []
    for item in raw:
        if isinstance(item, str):
            v = item.strip()
        elif isinstance(item, dict):
            v = (item.get("name") or item.get("title") or "").strip()
        else:
            continue
        if v and v not in out:
            out.append(v)
    return out[:50]


def _experience_years(payload: dict[str, Any]) -> float:
    months = ((payload.get("total_experience") or {}).get("months")) or 0
    try:
        return round(float(months) / 12.0, 1)
    except (TypeError, ValueError):
        return 0.0


def _location(payload: dict[str, Any]) -> str:
    area = payload.get("area") or {}
    return (area.get("name") or "").strip()


def _role(payload: dict[str, Any]) -> str:
    title = (payload.get("title") or "").strip()
    if title:
        return title
    roles = payload.get("professional_roles") or []
    if roles:
        return (roles[0].get("name") or "").strip()
    return ""


def _summary(payload: dict[str, Any]) -> str | None:
    # «О себе» в hh — поле `skills` (текстовое, не путать со skill_set).
    s = (payload.get("skills") or "").strip()
    return s or None


def map_hh_resume_to_candidate(payload: dict[str, Any]) -> CreateCandidateRequest:
    """Главный mapper: hh resume payload → DTO для service.create_candidate."""
    return CreateCandidateRequest(
        full_name=_full_name(payload),
        role=_role(payload),
        # engagement/employment/format AI/hh не подсказывают — оставляем дефолты
        grade=Grade.middle,
        experience_years=_experience_years(payload),
        stack=_stack(payload),
        format=WorkFormat.hybrid,
        location=_location(payload),
        telegram=_telegram(payload),
        phone=_contact_value(payload, "cell") or _contact_value(payload, "home"),
        email=_contact_value(payload, "email"),  # type: ignore[arg-type]
        birthday=_parse_birthday(payload.get("birth_date")),
        summary=_summary(payload),
        skill_categories=[SkillCategory(id="cat-0", name="Навыки", items=_stack(payload))]
        if _stack(payload)
        else None,
        experience=_experience(payload) or None,
        education=_education(payload) or None,
        certifications=_certifications(payload) or None,
        languages=_languages(payload) or None,
    )
