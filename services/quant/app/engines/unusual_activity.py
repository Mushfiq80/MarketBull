"""Unusual activity detector.

Reports the STATISTICAL FACT and nothing more. It never infers manipulation,
insider trading, or wrongdoing — that requires an authoritative finding, and
BABull is not one.

Wording is generated from templates so that no code path can produce an
accusation. See the language table in babull-docs/skills/babull-quant/SKILL.md.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any


@dataclass(slots=True)
class Observation:
    kind: str
    magnitude: Decimal
    baseline_description: str
    observation: str
    corresponding_disclosure_id: str | None = None


DETECTOR_VERSION = "1.0.0"


def detect(
    *,
    session_date: date,
    turnovers: list[Decimal],
    closes: list[Decimal],
    volumes: list[Decimal],
    disclosure_in_window_id: str | None = None,
    turnover_multiple_threshold: Decimal = Decimal("5"),
    return_sigma_threshold: float = 3.0,
) -> list[Observation]:
    out: list[Observation] = []

    # --- turnover vs its rolling median ---------------------------------
    if len(turnovers) >= 21:
        current = turnovers[-1]
        history = [float(t) for t in turnovers[:-1][-60:]]
        baseline = Decimal(str(statistics.median(history))) if history else None
        if baseline and baseline > 0:
            multiple = current / baseline
            if multiple >= turnover_multiple_threshold:
                out.append(
                    Observation(
                        kind="volume",
                        magnitude=multiple,
                        baseline_description=f"median turnover of the prior {len(history)} sessions",
                        observation=(
                            f"Turnover was {multiple:.1f}× its {len(history)}-session median "
                            f"on {session_date.isoformat()}."
                            + (
                                " A disclosure was published in the same window."
                                if disclosure_in_window_id
                                else " No corresponding disclosure was found in the same window."
                            )
                        ),
                        corresponding_disclosure_id=disclosure_in_window_id,
                    )
                )

    # --- return vs its own volatility ------------------------------------
    if len(closes) >= 30:
        rets = [
            float((b - a) / a)
            for a, b in zip(closes, closes[1:])
            if a and a != 0
        ]
        if len(rets) >= 20:
            sd = statistics.pstdev(rets[:-1]) if len(rets) > 2 else 0.0
            latest = rets[-1]
            if sd > 0:
                sigma = abs(latest) / sd
                if sigma >= return_sigma_threshold:
                    direction = "rose" if latest > 0 else "fell"
                    out.append(
                        Observation(
                            kind="price_move",
                            magnitude=Decimal(str(round(sigma, 4))),
                            baseline_description="trailing realized volatility of daily returns",
                            observation=(
                                f"Price {direction} {abs(latest) * 100:.2f}% on "
                                f"{session_date.isoformat()}, about {sigma:.1f}× its trailing "
                                "daily volatility."
                                + (
                                    " A disclosure was published in the same window."
                                    if disclosure_in_window_id
                                    else " No corresponding disclosure was found in the same window."
                                )
                            ),
                            corresponding_disclosure_id=disclosure_in_window_id,
                        )
                    )

    # --- concentration: activity in an otherwise dormant name -------------
    if len(volumes) >= 40:
        recent = volumes[-20:]
        prior = volumes[-40:-20]
        active_recent = sum(1 for v in recent if v and v > 0)
        active_prior = sum(1 for v in prior if v and v > 0)
        if active_prior <= 3 and active_recent >= 12:
            out.append(
                Observation(
                    kind="event_pattern",
                    magnitude=Decimal(active_recent - active_prior),
                    baseline_description="count of sessions with any trade, 20-session windows",
                    observation=(
                        f"Traded in {active_recent} of the last 20 sessions, against "
                        f"{active_prior} of the 20 before that."
                    ),
                    corresponding_disclosure_id=disclosure_in_window_id,
                )
            )

    return out
