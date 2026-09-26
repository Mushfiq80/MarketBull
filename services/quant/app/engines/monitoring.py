"""Drift monitoring.

A model that was validated once and never watched is a model you are trusting on
faith. These detectors turn silent degradation into a row in
``drift_observations`` and, past threshold, a data-quality issue.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class DriftResult:
    kind: str
    metric: str
    value: float
    baseline: float | None
    statistic: float
    breached: bool
    detail: dict[str, Any]


def population_stability_index(baseline: list[float], current: list[float], bins: int = 10) -> float:
    """PSI — the standard feature-drift statistic. >0.25 is a material shift."""
    if len(baseline) < 20 or len(current) < 20:
        return 0.0
    lo, hi = min(baseline), max(baseline)
    if hi <= lo:
        return 0.0
    width = (hi - lo) / bins
    psi = 0.0
    for b in range(bins):
        low = lo + b * width
        high = low + width if b < bins - 1 else float("inf")
        base_share = sum(1 for v in baseline if low <= v < high) / len(baseline)
        cur_share = sum(1 for v in current if low <= v < high) / len(current)
        base_share = max(base_share, 1e-6)
        cur_share = max(cur_share, 1e-6)
        psi += (cur_share - base_share) * math.log(cur_share / base_share)
    return round(psi, 6)


def score_distribution_drift(baseline: list[float], current: list[float]) -> DriftResult:
    psi = population_stability_index(baseline, current)
    return DriftResult(
        kind="score_distribution",
        metric="psi",
        value=psi,
        baseline=None,
        statistic=psi,
        breached=psi > 0.25,
        detail={
            "baselineMean": round(statistics.fmean(baseline), 4) if baseline else None,
            "currentMean": round(statistics.fmean(current), 4) if current else None,
            "interpretation": "PSI above 0.25 indicates the score distribution has shifted materially.",
        },
    )


def coverage_drift(available: int, total: int, *, baseline_ratio: float = 0.85) -> DriftResult:
    ratio = available / total if total else 0.0
    return DriftResult(
        kind="coverage",
        metric="factor_coverage",
        value=round(ratio, 4),
        baseline=baseline_ratio,
        statistic=round(baseline_ratio - ratio, 4),
        breached=ratio < baseline_ratio * 0.8,
        detail={
            "available": available,
            "total": total,
            "interpretation": "Falling factor coverage means scores are being built on less data.",
        },
    )


def source_lag_drift(lag_minutes: float, budget_minutes: float) -> DriftResult:
    ratio = lag_minutes / budget_minutes if budget_minutes else 0.0
    return DriftResult(
        kind="data",
        metric="source_lag_ratio",
        value=round(ratio, 4),
        baseline=1.0,
        statistic=round(ratio - 1.0, 4),
        breached=ratio > 1.0,
        detail={"lagMinutes": lag_minutes, "budgetMinutes": budget_minutes},
    )
