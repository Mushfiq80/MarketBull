"""Market Regime Engine.

Two outputs that are never merged:

1. ``classify`` — the CURRENT state, using only data available by ``as_of``.
2. ``forecast`` — probabilities of entering another state over a future horizon.
   Gated on calibration; returns ``uncalibrated`` until Brier/log-loss pass.

Plus ``cycle_dating`` (separate module) which produces 20% rise/fall benchmark
labels for research comparison only — never the live label.
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from ..config import load_model_config
from ..errors import UncalibratedModelError
from ..logging import get_logger

logger = get_logger(__name__)

STATES = [
    "bear",
    "late_bear_stress",
    "early_recovery",
    "confirmed_recovery",
    "bull",
    "strong_bull",
    "late_bull_distribution",
    "bear_transition",
]


@dataclass(slots=True)
class RegimeInputs:
    """Everything the classifier may see. All must be as-of-safe."""

    session_date: date
    index_closes: list[float]  # DSEX, oldest → newest
    breadth_pct_above_ma50: float | None = None
    breadth_advance_decline: float | None = None
    new_highs: int | None = None
    new_lows: int | None = None
    turnover_percentile: float | None = None
    turnover_concentration_top10: float | None = None
    aggregate_earnings_growth: float | None = None
    market_valuation_percentile: float | None = None
    policy_rate: float | None = None
    inflation: float | None = None
    fx_reserves_change: float | None = None
    private_credit_growth: float | None = None
    used_sample_data: bool = False


@dataclass(slots=True)
class RegimeResult:
    state: str
    state_score: Decimal
    factor_contributions: dict[str, float | None]
    effective_weights: dict[str, float]
    missing_series: list[str]
    data_completeness: Decimal
    confidence: Decimal
    transition_watch: list[dict[str, Any]]
    model_version: str
    config_hash: str
    used_sample_data: bool


# --------------------------------------------------------------------------
# dimension scores — each returns 0-100 or None
# --------------------------------------------------------------------------


def _trend_score(closes: list[float]) -> float | None:
    if len(closes) < 60:
        return None
    price = closes[-1]

    def sma(n: int) -> float | None:
        return sum(closes[-n:]) / n if len(closes) >= n else None

    ma50, ma200 = sma(50), sma(200)
    peak = max(closes[-250:]) if len(closes) >= 250 else max(closes)
    drawdown = (peak - price) / peak if peak else 0.0

    score = 0.0
    components = 0
    if ma50 is not None:
        score += 100.0 if price > ma50 else 0.0
        components += 1
    if ma200 is not None:
        score += 100.0 if price > ma200 else 0.0
        components += 1
    if ma50 is not None and ma200 is not None:
        score += 100.0 if ma50 > ma200 else 0.0
        components += 1
    # Drawdown penalty: a 30%+ drawdown is a bear signature regardless of MAs.
    score += max(0.0, 100.0 - drawdown * 333.0)
    components += 1
    return score / components if components else None


def _breadth_score(i: RegimeInputs) -> float | None:
    parts: list[float] = []
    if i.breadth_pct_above_ma50 is not None:
        parts.append(min(100.0, max(0.0, i.breadth_pct_above_ma50)))
    if i.breadth_advance_decline is not None:
        # advance/decline ratio → 0-100; 1.0 is neutral
        parts.append(min(100.0, max(0.0, 50.0 * i.breadth_advance_decline)))
    if i.new_highs is not None and i.new_lows is not None:
        total = i.new_highs + i.new_lows
        parts.append(100.0 * i.new_highs / total if total else 50.0)
    return sum(parts) / len(parts) if parts else None


def _liquidity_score(i: RegimeInputs) -> float | None:
    parts: list[float] = []
    if i.turnover_percentile is not None:
        parts.append(min(100.0, max(0.0, i.turnover_percentile)))
    if i.turnover_concentration_top10 is not None:
        # High concentration means a narrow, speculative rally — penalised.
        parts.append(max(0.0, 100.0 - i.turnover_concentration_top10 * 150.0))
    return sum(parts) / len(parts) if parts else None


def _earnings_valuation_score(i: RegimeInputs) -> float | None:
    parts: list[float] = []
    if i.aggregate_earnings_growth is not None:
        parts.append(min(100.0, max(0.0, 50.0 + i.aggregate_earnings_growth * 2.0)))
    if i.market_valuation_percentile is not None:
        # Cheap is supportive; expensive is not — but expensive-and-growing
        # differs from expensive-and-deteriorating, hence both components.
        parts.append(100.0 - min(100.0, max(0.0, i.market_valuation_percentile)))
    return sum(parts) / len(parts) if parts else None


def _macro_score(i: RegimeInputs) -> float | None:
    parts: list[float] = []
    if i.policy_rate is not None:
        parts.append(max(0.0, 100.0 - i.policy_rate * 6.0))
    if i.inflation is not None:
        parts.append(max(0.0, 100.0 - i.inflation * 6.0))
    if i.fx_reserves_change is not None:
        parts.append(min(100.0, max(0.0, 50.0 + i.fx_reserves_change * 5.0)))
    if i.private_credit_growth is not None:
        parts.append(min(100.0, max(0.0, i.private_credit_growth * 5.0)))
    return sum(parts) / len(parts) if parts else None


# --------------------------------------------------------------------------


def classify(inputs: RegimeInputs, config: dict[str, Any] | None = None) -> RegimeResult:
    cfg = config or load_model_config("regime")
    weights: dict[str, float] = cfg["weights"]

    dimensions: dict[str, float | None] = {
        "trend": _trend_score(inputs.index_closes),
        "breadth": _breadth_score(inputs),
        "liquidity": _liquidity_score(inputs),
        "earnings_valuation": _earnings_valuation_score(inputs),
        "macro": _macro_score(inputs),
    }

    missing = [k for k, v in dimensions.items() if v is None]
    used = {k: weights[k] for k, v in dimensions.items() if v is not None}
    total_weight = sum(used.values())

    if total_weight == 0:
        return RegimeResult(
            state="indeterminate",
            state_score=Decimal("0"),
            factor_contributions=dimensions,
            effective_weights={},
            missing_series=missing,
            data_completeness=Decimal("0"),
            confidence=Decimal("0"),
            transition_watch=[],
            model_version=cfg["version"],
            config_hash=cfg["_hash"],
            used_sample_data=inputs.used_sample_data,
        )

    # Effective weights are RECORDED, not silently renormalized away.
    effective = {k: round(w / total_weight, 6) for k, w in used.items()}
    composite = sum(dimensions[k] * w for k, w in effective.items())  # type: ignore[operator]

    state = _state_from(composite, dimensions, inputs, cfg)
    completeness = len(used) / len(weights) * 100

    # Confidence falls with missing series and with a composite sitting near a
    # band boundary, where small data changes would flip the label.
    boundary_distance = _distance_to_boundary(composite, cfg)
    confidence = min(100.0, completeness * 0.7 + boundary_distance * 0.3)

    return RegimeResult(
        state=state,
        state_score=Decimal(str(round(composite, 4))),
        factor_contributions=dimensions,
        effective_weights=effective,
        missing_series=missing,
        data_completeness=Decimal(str(round(completeness, 2))),
        confidence=Decimal(str(round(confidence, 2))),
        transition_watch=_transition_watch(composite, dimensions, inputs, cfg),
        model_version=cfg["version"],
        config_hash=cfg["_hash"],
        used_sample_data=inputs.used_sample_data,
    )


def _bands(cfg: dict[str, Any]) -> list[tuple[float, str]]:
    return sorted(((float(v), k) for k, v in cfg["bands"].items()), key=lambda t: t[0])


def _state_from(
    composite: float,
    dimensions: dict[str, float | None],
    inputs: RegimeInputs,
    cfg: dict[str, Any],
) -> str:
    bands = _bands(cfg)
    base = bands[0][1]
    for threshold, name in bands:
        if composite >= threshold:
            base = name

    trend = dimensions.get("trend")
    breadth = dimensions.get("breadth")

    # Distribution: strong index, weak participation. Classic late-cycle shape,
    # and common on DSE where a handful of large caps can carry the index.
    if base in {"bull", "strong_bull"} and breadth is not None and breadth < 40:
        return "late_bull_distribution"

    # Transition out of a bear: price improving before breadth confirms.
    if base == "early_recovery" and trend is not None and trend > 60 and (breadth or 0) > 50:
        return "confirmed_recovery"

    # Deteriorating from a bull without yet being a bear.
    if base == "bull" and trend is not None and trend < 45:
        return "bear_transition"

    if base == "bear" and trend is not None and trend < 25:
        return "late_bear_stress"

    return base


def _distance_to_boundary(composite: float, cfg: dict[str, Any]) -> float:
    thresholds = [t for t, _ in _bands(cfg)]
    if not thresholds:
        return 50.0
    nearest = min(abs(composite - t) for t in thresholds)
    return min(100.0, nearest * 8.0)


def _transition_watch(
    composite: float,
    dimensions: dict[str, float | None],
    inputs: RegimeInputs,
    cfg: dict[str, Any],
) -> list[dict[str, Any]]:
    """Conditions that would confirm or weaken a transition.

    Deliberately a checklist, not a prediction. The Bull Market Watch screen
    shows exactly this — no promised start date.
    """
    watch: list[dict[str, Any]] = []
    breadth = dimensions.get("breadth")
    trend = dimensions.get("trend")
    liquidity = dimensions.get("liquidity")

    watch.append(
        {
            "condition": "Breadth above 50% of eligible stocks over their 50-session average",
            "met": bool(breadth is not None and breadth >= 50),
            "direction": "confirms",
            "detail": "Broad participation, not an index carried by a few large caps."
            if breadth is not None
            else "Breadth data unavailable for this session.",
        }
    )
    watch.append(
        {
            "condition": "DSEX above its 200-session moving average",
            "met": bool(trend is not None and trend >= 60),
            "direction": "confirms",
            "detail": "Primary trend filter." if trend is not None else "Insufficient index history.",
        }
    )
    watch.append(
        {
            "condition": "Turnover in the upper half of its trailing distribution",
            "met": bool(liquidity is not None and liquidity >= 50),
            "direction": "confirms",
            "detail": "Rising participation rather than a thin drift.",
        }
    )
    watch.append(
        {
            "condition": "Turnover concentration in the top 10 names below 40%",
            "met": bool(
                inputs.turnover_concentration_top10 is not None
                and inputs.turnover_concentration_top10 < 0.40
            ),
            "direction": "confirms",
            "detail": "Guards against a narrow speculative rally reading as a recovery.",
        }
    )
    watch.append(
        {
            "condition": "New 52-week lows exceeding new highs",
            "met": bool(
                inputs.new_lows is not None
                and inputs.new_highs is not None
                and inputs.new_lows > inputs.new_highs
            ),
            "direction": "weakens",
            "detail": "Deterioration beneath the index level.",
        }
    )
    return watch


def forecast(
    snapshot_id: str,
    horizon_sessions: int,
    *,
    calibration: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Transition probabilities.

    Raises ``UncalibratedModelError`` until a calibration record exists. A
    probability that has never been checked against outcomes is not a
    probability — it is a number with a percent sign, and shipping one would be
    exactly the kind of false precision this product exists to avoid.
    """
    if not calibration or calibration.get("state") != "calibrated":
        raise UncalibratedModelError(
            "Regime transition probabilities are not calibrated yet. "
            "Run the calibration backtest and record Brier/log-loss before enabling this output.",
            snapshot_id=snapshot_id,
            horizon_sessions=horizon_sessions,
        )
    return calibration.get("forecasts", [])
