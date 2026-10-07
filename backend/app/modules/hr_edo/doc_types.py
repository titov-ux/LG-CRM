"""Юридическая матрица типов кадровых документов.

Справочник живёт в коде, а не в БД: это правила ТК РФ (ст. 22.1–22.3) и
приказа Росархива № 236, редактировать их из UI нельзя. Единая точка правки
при изменении закона — этот файл. Инварианты фиксирует тест-законник
`tests/test_hr_doc_types_matrix.py`:

* `paper_only`-типы (ч. 3 ст. 22.1) нельзя отправить на электронную подпись;
* `edo_consent_package` нельзя подписать УНЭП ЛГ — соглашения об УНЭП ещё нет;
* документы из ч. 1 ст. 22.3 работодатель подписывает только УКЭП.

`fields` — поля шаблона для формы создания (CreateDocumentDialog) и
предзаполнения из карточки сотрудника. Это метаданные шаблона, а не права.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

Contour = Literal["labor", "gph"]
EmployeeAction = Literal["none", "acknowledge", "sign"]
SigTypeCode = Literal["unep_lg", "gosklyuch", "ukep", "paper"]
EmployerSig = Literal["none", "ukep"]
SignOrder = Literal["employer_first", "employee_first", "parallel"]
FieldType = Literal["text", "textarea", "date", "money", "number", "select"]

# Шаблон, который не рендерится из HTML: документ загружается готовым PDF/сканом.
UPLOAD_ONLY = "upload_only"


@dataclass(frozen=True)
class FieldSpec:
    key: str
    label: str
    type: FieldType = "text"
    required: bool = False
    # Откуда предзаполнить: `employee.position`, `employee.hired_at`, `today`, …
    default_from: str | None = None
    default: str | None = None
    options: tuple[str, ...] = ()
    placeholder: str | None = None
    hint: str | None = None


@dataclass(frozen=True)
class DocType:
    code: str
    title: str
    # Префикс сквозной нумерации по типу и году: `ТД-2026-0007`.
    number_prefix: str
    contour: Contour
    employee_action: EmployeeAction
    employee_sig: tuple[SigTypeCode, ...]
    employer_sig: EmployerSig
    sign_order: SignOrder
    # Срок хранения, лет (приказ Росархива № 236). Сверить с юристом.
    retention_years: int
    # Имя HTML-шаблона в `templates/` или UPLOAD_ONLY.
    template: str
    # Код вида документа для `wredc_data.xml` (справочник к приказу Минтруда
    # № 578н). Заполняется на Этапе 2 вместе с evidence.zip — угадывать коды
    # справочника нельзя.
    mintrud_kind: str | None = None
    # Ч. 3 ст. 22.1 ТК: только бумага. Скан можно загрузить для учёта.
    paper_only: bool = False
    # Ч. 4 ст. 22.3 ТК: работник подписывает УНЭП только по соглашению сторон
    # (у нас — соглашение в пакете согласия на КЭДО).
    strict_group: bool = False
    # С какого этапа тип доступен в UI (ГПХ — Этап 3).
    stage: int = 1
    description: str = ""
    fields: tuple[FieldSpec, ...] = field(default_factory=tuple)

    @property
    def is_upload_only(self) -> bool:
        return self.template == UPLOAD_ONLY

    @property
    def needs_employer_signature(self) -> bool:
        return self.employer_sig == "ukep"

    @property
    def employee_signs(self) -> bool:
        return self.employee_action != "none"

    @property
    def allows_unep_lg(self) -> bool:
        return "unep_lg" in self.employee_sig


# Ч. 1 ст. 22.3 ТК РФ: эти документы работодатель подписывает только УКЭП.
EMPLOYER_UKEP_REQUIRED: frozenset[str] = frozenset(
    {
        "employment_contract",
        "supplementary_agreement",
        "material_liability_agreement",
        "training_agreement",
        "order_disciplinary",
        "notice_art74",
    }
)

_LABOR_SIGS: tuple[SigTypeCode, ...] = ("unep_lg", "gosklyuch", "ukep", "paper")
_PAPER: tuple[SigTypeCode, ...] = ("paper",)

_F_POSITION = FieldSpec(
    "position", "Должность", required=True, default_from="employee.position"
)
_F_START = FieldSpec(
    "start_date", "Дата начала работы", "date", required=True, default_from="employee.hired_at"
)
_F_SALARY = FieldSpec(
    "salary", "Оклад, ₽ в месяц (до вычета НДФЛ)", "money", required=True, placeholder="150 000"
)
_F_VACATION_TYPE = FieldSpec(
    "vacation_type",
    "Вид отпуска",
    "select",
    required=True,
    default="ежегодный оплачиваемый",
    options=(
        "ежегодный оплачиваемый",
        "без сохранения заработной платы",
        "учебный",
    ),
)
_F_VAC_START = FieldSpec("vacation_start", "Первый день отпуска", "date", required=True)
_F_VAC_END = FieldSpec("vacation_end", "Последний день отпуска", "date", required=True)
_F_VAC_DAYS = FieldSpec("vacation_days", "Календарных дней", "number", required=True)


DOC_TYPES: tuple[DocType, ...] = (
    DocType(
        code="edo_consent_package",
        title="Пакет согласия на КЭДО",
        number_prefix="СОГ",
        contour="labor",
        employee_action="sign",
        # Соглашения об УНЭП ещё нет — только Госключ, своя УКЭП или бумага.
        employee_sig=("gosklyuch", "ukep", "paper"),
        employer_sig="none",
        sign_order="employee_first",
        retention_years=50,
        template="edo_consent_package.html",
        description=(
            "Уведомление о переходе, согласие на КЭДО, соглашение об УНЭП ЛГ с порядком "
            "проверки и номером телефона, согласие на обработку ПДн и на поручение "
            "обработки SMS-провайдеру. Формируется кнопкой «Пригласить в КЭДО»."
        ),
    ),
    DocType(
        code="employment_contract",
        title="Трудовой договор",
        number_prefix="ТД",
        contour="labor",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="ukep",
        sign_order="employer_first",
        retention_years=50,
        template="employment_contract.html",
        strict_group=True,
        fields=(
            _F_POSITION,
            _F_START,
            FieldSpec(
                "contract_kind",
                "Срок договора",
                "select",
                required=True,
                default="бессрочный",
                options=("бессрочный", "срочный"),
            ),
            FieldSpec("end_date", "Дата окончания (для срочного)", "date"),
            _F_SALARY,
            FieldSpec("probation", "Испытательный срок", default="3 месяца"),
            FieldSpec(
                "work_place",
                "Место работы",
                "select",
                required=True,
                default="дистанционно",
                options=("дистанционно", "офис", "гибрид"),
            ),
            FieldSpec(
                "work_schedule",
                "Режим работы",
                default="пятидневная рабочая неделя, 40 часов",
            ),
            FieldSpec("vacation_days", "Ежегодный отпуск, календарных дней", "number", default="28"),
        ),
    ),
    DocType(
        code="supplementary_agreement",
        title="Дополнительное соглашение",
        number_prefix="ДС",
        contour="labor",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="ukep",
        sign_order="employer_first",
        retention_years=50,
        template="supplementary_agreement.html",
        strict_group=True,
        fields=(
            FieldSpec("contract_number", "Номер трудового договора", required=True),
            FieldSpec("contract_date", "Дата трудового договора", "date", required=True),
            FieldSpec("effective_date", "Дата вступления в силу", "date", required=True),
            FieldSpec(
                "changes",
                "Изменения условий (по пункту на строку)",
                "textarea",
                required=True,
                placeholder="Пункт 5.1 изложить в редакции: …",
            ),
        ),
    ),
    DocType(
        code="transfer_consent",
        title="Согласие на перевод",
        number_prefix="СП",
        contour="labor",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="none",
        sign_order="employee_first",
        retention_years=50,
        template=UPLOAD_ONLY,
        strict_group=True,
    ),
    DocType(
        code="resignation_request",
        title="Заявление об увольнении",
        number_prefix="ЗУ",
        contour="labor",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="none",
        sign_order="employee_first",
        retention_years=50,
        template=UPLOAD_ONLY,
        strict_group=True,
        description=(
            "Подписывается так же, как остальные, но кадровик подтверждает волеизъявление "
            "звонком или по видеосвязи (дело 9-го КСОЮ 8Г-10825/2022)."
        ),
    ),
    DocType(
        code="order_hire",
        title="Приказ о приёме на работу",
        number_prefix="ПР",
        contour="labor",
        employee_action="acknowledge",
        employee_sig=_LABOR_SIGS,
        employer_sig="ukep",
        sign_order="employer_first",
        retention_years=50,
        template="order_hire.html",
        fields=(
            _F_POSITION,
            _F_START,
            _F_SALARY,
            FieldSpec("probation", "Испытательный срок", default="3 месяца"),
            FieldSpec("contract_number", "Номер трудового договора", required=True),
            FieldSpec("contract_date", "Дата трудового договора", "date", required=True, default_from="today"),
            FieldSpec(
                "work_conditions",
                "Условия приёма, характер работы",
                default="основное место работы, дистанционная работа, полная занятость",
            ),
        ),
    ),
    DocType(
        code="vacation_request",
        title="Заявление на отпуск",
        number_prefix="ЗО",
        contour="labor",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="none",
        sign_order="employee_first",
        retention_years=5,
        template="vacation_request.html",
        fields=(_F_VACATION_TYPE, _F_VAC_START, _F_VAC_END, _F_VAC_DAYS),
    ),
    DocType(
        code="order_vacation",
        title="Приказ о предоставлении отпуска",
        number_prefix="ПО",
        contour="labor",
        employee_action="acknowledge",
        employee_sig=_LABOR_SIGS,
        employer_sig="ukep",
        sign_order="employer_first",
        retention_years=5,
        template="order_vacation.html",
        fields=(
            _F_POSITION,
            _F_VACATION_TYPE,
            _F_VAC_START,
            _F_VAC_END,
            _F_VAC_DAYS,
            FieldSpec("period", "За период работы", placeholder="с 01.10.2025 по 30.09.2026"),
        ),
    ),
    DocType(
        code="lna_acknowledgment",
        title="Ознакомление с ЛНА",
        number_prefix="ЛНА",
        contour="labor",
        employee_action="acknowledge",
        employee_sig=_LABOR_SIGS,
        employer_sig="none",
        sign_order="employee_first",
        retention_years=50,
        template="lna_acknowledgment.html",
        fields=(
            FieldSpec(
                "lna_title",
                "Локальный нормативный акт",
                required=True,
                placeholder="Положение о кадровом электронном документообороте",
            ),
            FieldSpec("lna_number", "Номер ЛНА"),
            FieldSpec("lna_date", "Дата утверждения ЛНА", "date", required=True),
        ),
    ),
    DocType(
        code="vacation_schedule",
        title="График отпусков (ознакомление)",
        number_prefix="ГО",
        contour="labor",
        employee_action="acknowledge",
        employee_sig=_LABOR_SIGS,
        employer_sig="ukep",
        sign_order="employer_first",
        retention_years=3,
        template=UPLOAD_ONLY,
    ),
    DocType(
        code="pd_consent",
        title="Согласие на обработку ПДн",
        number_prefix="ПДН",
        contour="labor",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="none",
        sign_order="employee_first",
        retention_years=3,
        template=UPLOAD_ONLY,
    ),
    # ── Только бумага (ч. 3 ст. 22.1 ТК) ─────────────────────────────
    DocType(
        code="order_dismissal",
        title="Приказ об увольнении",
        number_prefix="ПУ",
        contour="labor",
        employee_action="acknowledge",
        employee_sig=_PAPER,
        employer_sig="none",
        sign_order="employer_first",
        retention_years=50,
        template=UPLOAD_ONLY,
        paper_only=True,
        description=(
            "Только на бумаге. Для удалённых работников — ещё и копия заказным письмом "
            "в течение 3 рабочих дней (ст. 312.8 ТК)."
        ),
    ),
    DocType(
        code="work_book",
        title="Трудовая книжка / сведения ЭТК",
        number_prefix="ТК",
        contour="labor",
        employee_action="none",
        employee_sig=_PAPER,
        employer_sig="none",
        sign_order="employer_first",
        retention_years=50,
        template=UPLOAD_ONLY,
        paper_only=True,
    ),
    DocType(
        code="accident_act",
        title="Акт о несчастном случае (Н-1)",
        number_prefix="Н1",
        contour="labor",
        employee_action="none",
        employee_sig=_PAPER,
        employer_sig="none",
        sign_order="employer_first",
        retention_years=45,
        template=UPLOAD_ONLY,
        paper_only=True,
    ),
    DocType(
        code="ot_briefing",
        title="Инструктаж по охране труда",
        number_prefix="ОТ",
        contour="labor",
        employee_action="acknowledge",
        employee_sig=_PAPER,
        employer_sig="none",
        sign_order="employer_first",
        retention_years=45,
        template=UPLOAD_ONLY,
        paper_only=True,
    ),
    # ── ГПХ с ИП и СМЗ — не КЭДО, Этап 3 ─────────────────────────────
    DocType(
        code="gph_edo_agreement",
        title="Соглашение об ЭДО (ГПХ)",
        number_prefix="СЭДО",
        contour="gph",
        employee_action="sign",
        employee_sig=("gosklyuch", "ukep", "paper"),
        employer_sig="ukep",
        sign_order="employer_first",
        retention_years=5,
        template=UPLOAD_ONLY,
        stage=3,
    ),
    DocType(
        code="gph_contract",
        title="Договор оказания услуг (ГПХ)",
        number_prefix="ДУ",
        contour="gph",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="ukep",
        sign_order="employer_first",
        retention_years=5,
        template=UPLOAD_ONLY,
        stage=3,
    ),
    DocType(
        code="gph_act",
        title="Акт оказанных услуг (ГПХ)",
        number_prefix="АКТ",
        contour="gph",
        employee_action="sign",
        employee_sig=_LABOR_SIGS,
        employer_sig="ukep",
        sign_order="employee_first",
        retention_years=5,
        template=UPLOAD_ONLY,
        stage=3,
    ),
)

DOC_TYPES_BY_CODE: dict[str, DocType] = {t.code: t for t in DOC_TYPES}

CONSENT_PACKAGE = "edo_consent_package"


def get_doc_type(code: str) -> DocType | None:
    return DOC_TYPES_BY_CODE.get(code)
