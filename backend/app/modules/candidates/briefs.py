"""Сериализация кандидата и вакансии в компактный текстовый бриф для LLM.

Общий код для AI-фич, работающих с парой кандидат↔вакансия:
  • адаптация резюме под вакансию (`candidates/resume_ai.py`);
  • скоринг соответствия (`matching/ai.py`).

Брифы намеренно отдают не весь объект, а только релевантные поля, чтобы модель
не отвлекалась на recruiterId/ratesMonth/служебные поля.
"""
from __future__ import annotations

from typing import Any


def candidate_brief(candidate_dict: dict[str, Any]) -> str:
    """Сериализовать кандидата в компактный текстовый бриф для LLM.

    Ожидает camelCase-словарь (как `Candidate` DTO с by_alias=True), где
    резюме-поля (skillCategories, experience, ...) лежат на верхнем уровне.
    """
    parts: list[str] = []
    parts.append(f"ФИО: {candidate_dict.get('fullName', '')}")
    parts.append(f"Должность: {candidate_dict.get('role', '')}")
    if candidate_dict.get("grade"):
        parts.append(f"Грейд: {candidate_dict['grade']}")
    if candidate_dict.get("experienceYears") is not None:
        parts.append(f"Опыт (лет): {candidate_dict['experienceYears']}")
    if candidate_dict.get("format"):
        parts.append(f"Формат работы: {candidate_dict['format']}")
    if candidate_dict.get("location"):
        parts.append(f"Локация: {candidate_dict['location']}")
    if candidate_dict.get("summary"):
        parts.append("Сопроводительное:\n" + candidate_dict["summary"])
    if candidate_dict.get("stack"):
        parts.append("Плоский стек: " + ", ".join(candidate_dict["stack"]))
    if candidate_dict.get("skillCategories"):
        sc_lines = []
        for cat in candidate_dict["skillCategories"]:
            sc_lines.append(f"  • {cat.get('name', '')}: {', '.join(cat.get('items', []))}")
        parts.append("Категории навыков:\n" + "\n".join(sc_lines))
    if candidate_dict.get("experience"):
        exp_lines = []
        for i, e in enumerate(candidate_dict["experience"]):
            head = f"[{i}] {e.get('company', '')} — {e.get('position', '')}"
            period = f"{e.get('startMonth', '')} … {e.get('endMonth') or 'сейчас'}"
            exp_lines.append(f"{head} ({period})")
            if e.get("project"):
                exp_lines.append(f"    проект: {e['project']}")
            if e.get("achievements"):
                for a in e["achievements"]:
                    exp_lines.append(f"    - {a}")
            if e.get("stack"):
                exp_lines.append(f"    стек: {', '.join(e['stack'])}")
        parts.append("Опыт работы:\n" + "\n".join(exp_lines))
    return "\n\n".join(parts)


def vacancy_brief(vacancy_dict: dict[str, Any]) -> str:
    """Сериализовать вакансию в компактный текстовый бриф для LLM."""
    parts: list[str] = []
    parts.append(f"Должность: {vacancy_dict.get('title', '')}")
    if vacancy_dict.get("grade"):
        parts.append(f"Грейд: {vacancy_dict['grade']}")
    if vacancy_dict.get("format"):
        parts.append(f"Формат работы: {vacancy_dict['format']}")
    if vacancy_dict.get("stack"):
        parts.append("Требуемый стек: " + ", ".join(vacancy_dict["stack"]))
    if vacancy_dict.get("description"):
        parts.append("Описание:\n" + vacancy_dict["description"])
    if vacancy_dict.get("requirements"):
        parts.append("Требования:\n" + vacancy_dict["requirements"])
    return "\n\n".join(parts)


__all__ = ["candidate_brief", "vacancy_brief"]
