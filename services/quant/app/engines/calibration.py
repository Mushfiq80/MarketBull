"""Forecast calibration.

A probability is only a probability once it has been checked against outcomes.
These are the checks; until they pass, the API returns MODEL_UNCALIBRATED.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class CalibrationReport:
    brier_score: float
    log_loss: float
    sample_size: int
    reliability_bins: list[dict[str, Any]]
    calibrated: bool
    reasons: list[str]


def brier(probabilities: list[float], outcomes: list[int]) -> float:
    return sum((p - o) ** 2 for p, o in zip(probabilities, outcomes)) / len(probabilities)


def log_loss(probabilities: list[float], outcomes: list[int], eps: float = 1e-12) -> float:
    total = 0.0
    for p, o in zip(probabilities, outcomes):
        clipped = min(1 - eps, max(eps, p))
        total += -(o * math.log(clipped) + (1 - o) * math.log(1 - clipped))
    return total / len(probabilities)


def reliability(probabilities: list[float], outcomes: list[int], bins: int = 10) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for b in range(bins):
        low, high = b / bins, (b + 1) / bins
        selected = [(p, o) for p, o in zip(probabilities, outcomes) if low <= p < high or (b == bins - 1 and p == 1.0)]
        if not selected:
            out.append({"bin": f"{low:.1f}-{high:.1f}", "n": 0, "predicted": None, "observed": None})
            continue
        out.append(
            {
                "bin": f"{low:.1f}-{high:.1f}",
                "n": len(selected),
                "predicted": round(sum(p for p, _ in selected) / len(selected), 4),
                "observed": round(sum(o for _, o in selected) / len(selected), 4),
            }
        )
    return out


def assess(
    probabilities: list[float],
    outcomes: list[int],
    *,
    min_sample: int = 200,
    max_brier: float = 0.22,
    max_calibration_gap: float = 0.15,
) -> CalibrationReport:
    """Decide whether a forecast model may publish probabilities at all."""
    reasons: list[str] = []
    n = len(probabilities)

    if n == 0 or n != len(outcomes):
        return CalibrationReport(1.0, 99.0, n, [], False, ["no_paired_outcomes"])

    b = brier(probabilities, outcomes)
    ll = log_loss(probabilities, outcomes)
    bins = reliability(probabilities, outcomes)

    calibrated = True
    if n < min_sample:
        calibrated = False
        reasons.append(f"sample_size {n} below the minimum {min_sample} — too few to conclude anything")
    if b > max_brier:
        calibrated = False
        reasons.append(f"brier_score {b:.4f} above the maximum {max_brier}")

    worst_gap = 0.0
    for row in bins:
        if row["n"] and row["predicted"] is not None and row["observed"] is not None:
            worst_gap = max(worst_gap, abs(row["predicted"] - row["observed"]))
    if worst_gap > max_calibration_gap:
        calibrated = False
        reasons.append(f"worst reliability-bin gap {worst_gap:.3f} above {max_calibration_gap}")

    if calibrated:
        reasons.append("calibration criteria met")

    return CalibrationReport(
        brier_score=round(b, 6),
        log_loss=round(ll, 6),
        sample_size=n,
        reliability_bins=bins,
        calibrated=calibrated,
        reasons=reasons,
    )
