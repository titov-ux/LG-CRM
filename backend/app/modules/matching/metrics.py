"""Лёгкие in-process метрики AI-скоринга.

В проекте нет Prometheus, поэтому наблюдаемость держим на двух уровнях:
  • структурный лог на каждый расчёт (latency, cache_hit, ai_enriched) —
    его агрегирует логовый пайплайн / Sentry;
  • простые счётчики в памяти процесса (`SCORING_METRICS`) — удобно дёрнуть
    в тестах и при желании отдать в будущем `/metrics`-эндпоинте.

Счётчики НЕ потокобезопасны строго, но для GIL-инкрементов int этого достаточно
(потеря отдельного тика в редкой гонке некритична для наблюдаемости).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger("app.matching.scoring")


@dataclass
class ScoringMetrics:
    cache_hits: int = 0
    llm_calls: int = 0          # успешных обогащений LLM
    cheap_fallbacks: int = 0    # LLM недоступен → детерминированный фоллбэк
    errors: int = 0            # 4xx/обрыв от LLM (проброшено в эндпоинт)
    llm_latency_ms_total: float = 0.0

    @property
    def llm_avg_latency_ms(self) -> float:
        return self.llm_latency_ms_total / self.llm_calls if self.llm_calls else 0.0

    def snapshot(self) -> dict[str, float]:
        return {
            "cache_hits": self.cache_hits,
            "llm_calls": self.llm_calls,
            "cheap_fallbacks": self.cheap_fallbacks,
            "errors": self.errors,
            "llm_avg_latency_ms": round(self.llm_avg_latency_ms, 1),
        }

    def reset(self) -> None:
        self.cache_hits = 0
        self.llm_calls = 0
        self.cheap_fallbacks = 0
        self.errors = 0
        self.llm_latency_ms_total = 0.0


SCORING_METRICS = ScoringMetrics()


def record_cache_hit() -> None:
    SCORING_METRICS.cache_hits += 1
    logger.info("scoring.cache_hit", extra={"scoring_event": "cache_hit"})


def record_llm(latency_ms: float) -> None:
    SCORING_METRICS.llm_calls += 1
    SCORING_METRICS.llm_latency_ms_total += latency_ms
    logger.info(
        "scoring.llm_ok latency_ms=%.0f",
        latency_ms,
        extra={"scoring_event": "llm_ok", "latency_ms": round(latency_ms, 1)},
    )


def record_cheap_fallback(latency_ms: float) -> None:
    SCORING_METRICS.cheap_fallbacks += 1
    logger.warning(
        "scoring.cheap_fallback latency_ms=%.0f",
        latency_ms,
        extra={"scoring_event": "cheap_fallback", "latency_ms": round(latency_ms, 1)},
    )


def record_error() -> None:
    SCORING_METRICS.errors += 1
    logger.warning("scoring.error", extra={"scoring_event": "error"})


__all__ = [
    "SCORING_METRICS",
    "ScoringMetrics",
    "record_cache_hit",
    "record_cheap_fallback",
    "record_error",
    "record_llm",
]
