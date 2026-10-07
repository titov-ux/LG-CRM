"""Тест-законник: юридические инварианты матрицы типов кадровых документов.

Правила из ТК РФ (ст. 22.1–22.3) — см. docs/plan-hr-edo.md. Если тест упал
после правки `doc_types.py`, это не «сломанный тест», а изменение правовой
позиции: согласуйте с юристом.
"""
from __future__ import annotations

from pathlib import Path

from app.modules.hr_edo.doc_types import (
    CONSENT_PACKAGE,
    DOC_TYPES,
    DOC_TYPES_BY_CODE,
    EMPLOYER_UKEP_REQUIRED,
    UPLOAD_ONLY,
)

TEMPLATES = Path(__file__).resolve().parents[1] / "app" / "modules" / "hr_edo" / "templates"


def test_codes_unique_and_prefixes_unique() -> None:
    codes = [t.code for t in DOC_TYPES]
    assert len(codes) == len(set(codes))
    prefixes = [t.number_prefix for t in DOC_TYPES]
    assert len(prefixes) == len(set(prefixes)), "сквозная нумерация по типу требует уникальных префиксов"


def test_consent_package_cannot_be_signed_with_unep_lg() -> None:
    """Соглашения об УНЭП ещё нет — пакет согласия подписывается вне системы."""
    t = DOC_TYPES_BY_CODE[CONSENT_PACKAGE]
    assert "unep_lg" not in t.employee_sig
    assert set(t.employee_sig) <= {"gosklyuch", "ukep", "paper"}


def test_paper_only_types_are_paper_and_upload_only() -> None:
    """Ч. 3 ст. 22.1 ТК: увольнение, трудовые книжки, Н-1, инструктажи — только бумага."""
    paper = {t.code for t in DOC_TYPES if t.paper_only}
    assert {"order_dismissal", "work_book", "accident_act", "ot_briefing"} <= paper
    for code in paper:
        t = DOC_TYPES_BY_CODE[code]
        assert t.employee_sig == ("paper",), code
        assert t.template == UPLOAD_ONLY, code


def test_part1_documents_require_employer_ukep() -> None:
    """Ч. 1 ст. 22.3 ТК: трудовой договор, допсоглашения и др. — только УКЭП работодателя."""
    present = EMPLOYER_UKEP_REQUIRED & set(DOC_TYPES_BY_CODE)
    assert {"employment_contract", "supplementary_agreement"} <= present
    for code in present:
        assert DOC_TYPES_BY_CODE[code].employer_sig == "ukep", code


def test_strict_group_allows_unep_lg_only_by_agreement() -> None:
    """Ч. 4 ст. 22.3: договор, допсоглашение, перевод, увольнение — УНЭП по соглашению сторон."""
    for code in ("employment_contract", "supplementary_agreement", "transfer_consent", "resignation_request"):
        t = DOC_TYPES_BY_CODE[code]
        assert t.strict_group, code
        assert "unep_lg" in t.employee_sig, code


def test_gph_types_are_not_labor_and_not_in_stage_1() -> None:
    for t in DOC_TYPES:
        if t.code.startswith("gph_"):
            assert t.contour == "gph"
            assert t.stage >= 3


def test_every_template_exists_and_fields_are_consistent() -> None:
    for t in DOC_TYPES:
        if t.template != UPLOAD_ONLY:
            assert (TEMPLATES / t.template).is_file(), t.template
        keys = [f.key for f in t.fields]
        assert len(keys) == len(set(keys)), t.code
        for f in t.fields:
            if f.type == "select":
                assert f.options, f"{t.code}.{f.key}: select без вариантов"


def test_retention_years_positive() -> None:
    for t in DOC_TYPES:
        assert t.retention_years > 0, t.code
