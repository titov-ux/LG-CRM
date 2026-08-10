"""Лёгкие in-process метрики AI-скрининга (Этап 6).

Паттерн как у matching/metrics: структурные логи + счётчики в памяти.
Алерты (p95 STT > 5 с, всплеск ai_unavailable) — в docs/sentry-setup.md
и docs/runbook.md.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger("app.screening.metrics")


@dataclass
class ScreeningMetrics:
    stt_finals: int = 0
    stt_latency_ms_total: float = 0.0
    stt_latency_ms_max: float = 0.0
    stt_errors: int = 0
    ai_agent_ok: int = 0
    ai_agent_unavailable: int = 0
    ai_agent_bad_request: int = 0
    ai_agent_errors: int = 0
    ai_report_ok: int = 0
    ai_report_fallback: int = 0
    ai_report_errors: int = 0
    retention_purged: int = 0
    max_duration_stops: int = 0
    # Скользящее окно последних латентностей для грубого p95 в snapshot.
    _latency_window: list[float] = field(default_factory=list)

    def snapshot(self) -> dict[str, float | int]:
        window = sorted(self._latency_window)
        p95 = 0.0
        if window:
            idx = min(len(window) - 1, int(len(window) * 0.95))
            p95 = window[idx]
        avg = (
            self.stt_latency_ms_total / self.stt_finals if self.stt_finals else 0.0
        )
        return {
            "stt_finals": self.stt_finals,
            "stt_avg_latency_ms": round(avg, 1),
            "stt_p95_latency_ms": round(p95, 1),
            "stt_max_latency_ms": round(self.stt_latency_ms_max, 1),
            "stt_errors": self.stt_errors,
            "ai_agent_ok": self.ai_agent_ok,
            "ai_agent_unavailable": self.ai_agent_unavailable,
            "ai_agent_bad_request": self.ai_agent_bad_request,
            "ai_agent_errors": self.ai_agent_errors,
            "ai_report_ok": self.ai_report_ok,
            "ai_report_fallback": self.ai_report_fallback,
            "ai_report_errors": self.ai_report_errors,
            "retention_purged": self.retention_purged,
            "max_duration_stops": self.max_duration_stops,
        }

    def reset(self) -> None:
        self.stt_finals = 0
        self.stt_latency_ms_total = 0.0
        self.stt_latency_ms_max = 0.0
        self.stt_errors = 0
        self.ai_agent_ok = 0
        self.ai_agent_unavailable = 0
        self.ai_agent_bad_request = 0
        self.ai_agent_errors = 0
        self.ai_report_ok = 0
        self.ai_report_fallback = 0
        self.ai_report_errors = 0
        self.retention_purged = 0
        self.max_duration_stops = 0
        self._latency_window.clear()


SCREENING_METRICS = ScreeningMetrics()
_LATENCY_WINDOW_MAX = 500


def record_stt_final(latency_ms: float | None) -> None:
    SCREENING_METRICS.stt_finals += 1
    if latency_ms is None:
        return
    ms = float(latency_ms)
    SCREENING_METRICS.stt_latency_ms_total += ms
    if ms > SCREENING_METRICS.stt_latency_ms_max:
        SCREENING_METRICS.stt_latency_ms_max = ms
    window = SCREENING_METRICS._latency_window
    window.append(ms)
    if len(window) > _LATENCY_WINDOW_MAX:
        del window[: len(window) - _LATENCY_WINDOW_MAX]
    logger.info(
        "screening.stt_final latency_ms=%.0f",
        ms,
        extra={"screening_event": "stt_final", "latency_ms": round(ms, 1)},
    )


def record_stt_error(reason: str = "stt_error") -> None:
    SCREENING_METRICS.stt_errors += 1
    logger.warning(
        "screening.stt_error reason=%s",
        reason,
        extra={"screening_event": "stt_error", "reason": reason},
    )


def record_ai_agent_ok() -> None:
    SCREENING_METRICS.ai_agent_ok += 1
    logger.info("screening.ai_agent_ok", extra={"screening_event": "ai_agent_ok"})


def record_ai_agent_unavailable() -> None:
    SCREENING_METRICS.ai_agent_unavailable += 1
    logger.warning(
        "screening.ai_agent_unavailable",
        extra={"screening_event": "ai_agent_unavailable"},
    )


def record_ai_agent_bad_request() -> None:
    SCREENING_METRICS.ai_agent_bad_request += 1
    logger.error(
        "screening.ai_agent_bad_request",
        extra={"screening_event": "ai_agent_bad_request"},
    )


def record_ai_agent_error() -> None:
    SCREENING_METRICS.ai_agent_errors += 1
    logger.warning(
        "screening.ai_agent_error",
        extra={"screening_event": "ai_agent_error"},
    )


def record_ai_report_ok() -> None:
    SCREENING_METRICS.ai_report_ok += 1
    logger.info("screening.ai_report_ok", extra={"screening_event": "ai_report_ok"})


def record_ai_report_fallback() -> None:
    SCREENING_METRICS.ai_report_fallback += 1
    logger.warning(
        "screening.ai_report_fallback",
        extra={"screening_event": "ai_report_fallback"},
    )


def record_ai_report_error() -> None:
    SCREENING_METRICS.ai_report_errors += 1
    logger.error(
        "screening.ai_report_error",
        extra={"screening_event": "ai_report_error"},
    )


def record_retention_purged(count: int) -> None:
    SCREENING_METRICS.retention_purged += count
    logger.info(
        "screening.retention_purged count=%d",
        count,
        extra={"screening_event": "retention_purged", "count": count},
    )


def record_max_duration_stop() -> None:
    SCREENING_METRICS.max_duration_stops += 1
    logger.warning(
        "screening.max_duration_stop",
        extra={"screening_event": "max_duration_stop"},
    )


__all__ = [
    "SCREENING_METRICS",
    "ScreeningMetrics",
    "record_ai_agent_bad_request",
    "record_ai_agent_error",
    "record_ai_agent_ok",
    "record_ai_agent_unavailable",
    "record_ai_report_error",
    "record_ai_report_fallback",
    "record_ai_report_ok",
    "record_max_duration_stop",
    "record_retention_purged",
    "record_stt_error",
    "record_stt_final",
]
