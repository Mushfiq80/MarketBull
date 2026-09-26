"""Conviction — how reliable the evidence behind a score is.

**Conviction is not the probability of profit.** It measures source authority,
freshness, completeness, agreement between sources, and — where sample size
permits — how well comparable past outputs were calibrated. The UI copy is
constrained to match; see babull-docs/skills/babull-quant/SKILL.md.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from decimal import Decimal
from typing import Any

from .types import FactorValue

AUTHORITY_SCORE = {
    "official_filing": 100.0,
    "regulator": 100.0,
    "exchange": 95.0,
    "company_statement": 80.0,
    "reputable_media": 55.0,
    "analyst": 45.0,
    "social": 10.0,
    "unknown": 25.0,
}


@dataclass(slots=True)
class ConvictionBreakdown:
    sourceAuthority: float
    freshness: float
    completeness: float
    agreement: float
    historicalCalibration: float | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def score(
    *,
    factors: dict[str, FactorValue],
    source_authorities: list[str],
    data_age_days: float | None,
    conflicting_sources: int,
    historical_calibration: float | None = None,
    freshness_budget_days: float = 3.0,
) -> tuple[Decimal, ConvictionBreakdown]:
    """Return (conviction 0-100, breakdown)."""

    # --- source authority ------------------------------------------------
    authority = (
        sum(AUTHORITY_SCORE.get(a, 25.0) for a in source_authorities) / len(source_authorities)
        if source_authorities
        else 25.0
    )

    # --- freshness --------------------------------------------------------
    if data_age_days is None:
        freshness = 20.0
    elif data_age_days <= freshness_budget_days:
        freshness = 100.0
    else:
        # Linear decay to zero over ten budgets.
        over = (data_age_days - freshness_budget_days) / (freshness_budget_days * 10)
        freshness = max(0.0, 100.0 * (1.0 - over))

    # --- completeness -----------------------------------------------------
    total = len(factors) or 1
    usable = sum(1 for f in factors.values() if f.usable)
    completeness = usable / total * 100.0

    # --- agreement --------------------------------------------------------
    agreement = max(0.0, 100.0 - conflicting_sources * 25.0)

    # --- weighted blend ---------------------------------------------------
    # Completeness is weighted highest: a score built on a third of its factors
    # is the most common way these systems mislead.
    weights = {
        "authority": 0.20,
        "freshness": 0.20,
        "completeness": 0.35,
        "agreement": 0.15,
        "calibration": 0.10,
    }

    blended = (
        authority * weights["authority"]
        + freshness * weights["freshness"]
        + completeness * weights["completeness"]
        + agreement * weights["agreement"]
    )

    if historical_calibration is None:
        # Redistribute the calibration weight rather than assuming a value.
        blended = blended / (1.0 - weights["calibration"])
    else:
        blended += historical_calibration * weights["calibration"]

    breakdown = ConvictionBreakdown(
        sourceAuthority=round(authority, 2),
        freshness=round(freshness, 2),
        completeness=round(completeness, 2),
        agreement=round(agreement, 2),
        historicalCalibration=None if historical_calibration is None else round(historical_calibration, 2),
    )
    return Decimal(str(round(min(100.0, max(0.0, blended)), 4))), breakdown
