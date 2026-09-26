"""Historical bull/bear cycle dating (Pagan–Sossounov style).

Produces BENCHMARK LABELS FOR RESEARCH COMPARISON ONLY. These never drive the
live regime label — they are hindsight by construction, since a turning point is
only identifiable after the fact.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date


@dataclass(slots=True)
class CyclePhase:
    start: date
    end: date | None
    label: str  # "bull" | "bear"
    peak_to_trough_pct: float | None


def date_cycles(
    dates: list[date],
    closes: list[float],
    *,
    threshold: float = 0.20,
    min_phase_sessions: int = 60,
) -> list[CyclePhase]:
    """Label cycles using the conventional 20% rise/fall rule.

    The convention is a benchmark, not a definition — different studies date DSE
    cycles differently, and thresholds chosen to fit one famous crash tell you
    nothing out of sample.
    """
    if len(closes) < min_phase_sessions * 2 or len(dates) != len(closes):
        return []

    phases: list[CyclePhase] = []
    pivot_idx = 0
    pivot_price = closes[0]
    direction: str | None = None

    for i, price in enumerate(closes):
        if direction is None:
            if price >= pivot_price * (1 + threshold):
                direction = "bull"
                pivot_idx, pivot_price = i, price
            elif price <= pivot_price * (1 - threshold):
                direction = "bear"
                pivot_idx, pivot_price = i, price
            else:
                if price > pivot_price:
                    pivot_price = price
                continue

        if direction == "bull":
            if price > pivot_price:
                pivot_idx, pivot_price = i, price
            elif price <= pivot_price * (1 - threshold) and i - pivot_idx >= min_phase_sessions:
                phases.append(
                    CyclePhase(
                        start=dates[max(0, pivot_idx - 1)],
                        end=dates[i],
                        label="bull",
                        peak_to_trough_pct=round((price - pivot_price) / pivot_price * 100, 2),
                    )
                )
                direction = "bear"
                pivot_idx, pivot_price = i, price
        else:
            if price < pivot_price:
                pivot_idx, pivot_price = i, price
            elif price >= pivot_price * (1 + threshold) and i - pivot_idx >= min_phase_sessions:
                phases.append(
                    CyclePhase(
                        start=dates[max(0, pivot_idx - 1)],
                        end=dates[i],
                        label="bear",
                        peak_to_trough_pct=round((price - pivot_price) / pivot_price * 100, 2),
                    )
                )
                direction = "bull"
                pivot_idx, pivot_price = i, price

    if direction is not None:
        phases.append(
            CyclePhase(start=dates[pivot_idx], end=None, label=direction, peak_to_trough_pct=None)
        )
    return phases


def label_for(phases: list[CyclePhase], when: date) -> str | None:
    for p in phases:
        if p.start <= when and (p.end is None or when <= p.end):
            return p.label
    return None
