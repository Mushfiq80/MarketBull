"""FOX scoring engine.

Pillars:
  F — Fundamentals      what the business is worth and how healthy it is
  O — Opportunity       what could drive revaluation
  X — eXposure & Risk   what can go wrong   (stored inverted as Xq)

Every weight is configuration (``app/config/models/fox.yaml``), never code, and
a score carries the hash of the config that produced it.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from ..config import load_model_config
from ..logging import get_logger
from . import factors as F
from .types import Availability, FactorContext, FactorValue, PillarResult

logger = get_logger(__name__)
ZERO = Decimal("0")


@dataclass(slots=True)
class FoxScore:
    fundamentals: Decimal | None
    opportunity: Decimal | None
    exposure_quality: Decimal | None
    composite: Decimal | None
    effective_weights: dict[str, float]
    factor_values: dict[str, float | None]
    pillars: dict[str, PillarResult]
    data_completeness: Decimal
    used_sample_data: bool
    model_version: str
    config_hash: str


def _pillar(
    pillar: str,
    weights: dict[str, float],
    values: dict[str, FactorValue],
) -> PillarResult:
    """Weighted mean over AVAILABLE factors only.

    When a factor is unavailable its weight is dropped and the remainder is
    rescaled — but the weights actually used are recorded, so the renormalization
    is never silent.
    """
    used: dict[str, float] = {}
    total_weight = 0.0
    accumulated = 0.0

    for name, weight in weights.items():
        value = values.get(name)
        if value is None or not value.usable or value.normalized is None:
            continue
        used[name] = weight
        total_weight += weight
        accumulated += float(value.normalized) * weight

    factor_values = {
        name: (float(v.normalized) if v.normalized is not None else None) for name, v in values.items()
    }

    if total_weight == 0:
        return PillarResult(
            pillar=pillar,
            score=None,
            effective_weights={},
            factor_values=factor_values,
            available_count=0,
            total_count=len(weights),
            reason="no_available_factors",
        )

    # Require a minimum share of the intended weight, otherwise the pillar is
    # built on too little to mean anything.
    intended = sum(weights.values()) or 1.0
    coverage = total_weight / intended
    if coverage < 0.4:
        return PillarResult(
            pillar=pillar,
            score=None,
            effective_weights={k: round(v / total_weight, 6) for k, v in used.items()},
            factor_values=factor_values,
            available_count=len(used),
            total_count=len(weights),
            reason=f"insufficient_factor_coverage:{coverage:.0%}",
        )

    score = Decimal(str(round(accumulated / total_weight, 6)))
    return PillarResult(
        pillar=pillar,
        score=score,
        effective_weights={k: round(v / total_weight, 6) for k, v in used.items()},
        factor_values=factor_values,
        available_count=len(used),
        total_count=len(weights),
    )


def score(
    ctx: FactorContext,
    normalized_factors: dict[str, FactorValue],
    *,
    horizon: str,
    config: dict[str, Any] | None = None,
) -> FoxScore:
    cfg = config or load_model_config("fox")
    horizon_cfg = cfg["horizons"][horizon]
    pillar_weights = horizon_cfg["pillar_weights"]
    factor_weights = horizon_cfg["factor_weights"]

    f_result = _pillar("F", factor_weights.get("F", {}), normalized_factors)
    o_result = _pillar("O", factor_weights.get("O", {}), normalized_factors)
    x_result = _pillar("X", factor_weights.get("X", {}), normalized_factors)

    # X factors are all `lower_better`, so percentile_rank already inverted them:
    # a high normalized X value means LOW measured exposure. That is Xq directly.
    xq = x_result.score

    parts: list[tuple[str, Decimal, float]] = []
    if f_result.score is not None:
        parts.append(("F", f_result.score, float(pillar_weights["F"])))
    if o_result.score is not None:
        parts.append(("O", o_result.score, float(pillar_weights["O"])))
    if xq is not None:
        parts.append(("Xq", xq, float(pillar_weights["X"])))

    composite: Decimal | None = None
    effective_pillar_weights: dict[str, float] = {}
    if parts:
        weight_sum = sum(w for _, _, w in parts)
        if weight_sum > 0:
            composite = Decimal(
                str(round(sum(float(v) * w for _, v, w in parts) / weight_sum, 6))
            )
            effective_pillar_weights = {name: round(w / weight_sum, 6) for name, _, w in parts}

    all_factor_values: dict[str, float | None] = {}
    for result in (f_result, o_result, x_result):
        all_factor_values.update(result.factor_values)

    usable = sum(1 for v in normalized_factors.values() if v.usable)
    completeness = (
        Decimal(str(round(usable / len(normalized_factors) * 100, 4))) if normalized_factors else ZERO
    )

    return FoxScore(
        fundamentals=f_result.score,
        opportunity=o_result.score,
        exposure_quality=xq,
        composite=composite,
        effective_weights={
            "pillars": effective_pillar_weights,
            "F": f_result.effective_weights,
            "O": o_result.effective_weights,
            "X": x_result.effective_weights,
        },
        factor_values=all_factor_values,
        pillars={"F": f_result, "O": o_result, "X": x_result},
        data_completeness=completeness,
        used_sample_data=any(v.used_sample_data for v in normalized_factors.values()),
        model_version=cfg["version"],
        config_hash=cfg["_hash"],
    )
