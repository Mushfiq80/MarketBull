"""Portfolio exposure and risk.

Every estimate carries a sample-size warning. With DSE's history and liquidity,
a correlation computed from 30 overlapping observations is not a correlation —
it is noise with a decimal point, and it is labelled as such.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

MIN_OBSERVATIONS_FOR_CORRELATION = 60


@dataclass(slots=True)
class ExposureBucket:
    key: str
    label: str
    value: Decimal
    weight_pct: Decimal


@dataclass(slots=True)
class PortfolioRisk:
    total_value: Decimal
    priced_value: Decimal
    unpriced_value: Decimal
    unpriced_positions: list[str]
    by_sector: list[ExposureBucket]
    by_liquidity: list[ExposureBucket]
    concentration_top1: Decimal | None
    concentration_top5: Decimal | None
    herfindahl: Decimal | None
    estimated_days_to_liquidate: Decimal | None
    scenario_results: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


def analyse(
    holdings: list[dict[str, Any]],
    *,
    scenarios: list[dict[str, Any]] | None = None,
) -> PortfolioRisk:
    warnings: list[str] = []

    priced = [h for h in holdings if h.get("market_value") is not None and h.get("valuation_state") == "available"]
    unpriced = [h for h in holdings if h not in priced]

    priced_value = sum((Decimal(str(h["market_value"])) for h in priced), Decimal("0"))
    unpriced_value = sum(
        (Decimal(str(h.get("total_cost") or 0)) for h in unpriced), Decimal("0")
    )

    if unpriced:
        warnings.append(
            f"{len(unpriced)} position(s) could not be priced (suspended, stale or unavailable). "
            "They are excluded from percentages and shown separately at cost."
        )

    total = priced_value
    if total <= 0:
        return PortfolioRisk(
            total_value=Decimal("0"),
            priced_value=Decimal("0"),
            unpriced_value=unpriced_value,
            unpriced_positions=[str(h.get("ticker")) for h in unpriced],
            by_sector=[],
            by_liquidity=[],
            concentration_top1=None,
            concentration_top5=None,
            herfindahl=None,
            estimated_days_to_liquidate=None,
            scenario_results=[],
            warnings=warnings + ["No priced positions — exposure cannot be computed."],
        )

    # --- sector exposure ---------------------------------------------------
    sector_totals: dict[str, Decimal] = {}
    for h in priced:
        key = str(h.get("sector") or "UNCLASSIFIED")
        sector_totals[key] = sector_totals.get(key, Decimal("0")) + Decimal(str(h["market_value"]))

    by_sector = [
        ExposureBucket(key=k, label=k.title(), value=v, weight_pct=(v / total * Decimal(100)).quantize(Decimal("0.01")))
        for k, v in sorted(sector_totals.items(), key=lambda kv: -kv[1])
    ]

    # --- liquidity buckets -------------------------------------------------
    buckets: dict[str, Decimal] = {"liquid": Decimal("0"), "moderate": Decimal("0"), "thin": Decimal("0"), "unknown": Decimal("0")}
    for h in priced:
        days = h.get("days_to_liquidate")
        value = Decimal(str(h["market_value"]))
        if days is None:
            buckets["unknown"] += value
        elif float(days) <= 3:
            buckets["liquid"] += value
        elif float(days) <= 15:
            buckets["moderate"] += value
        else:
            buckets["thin"] += value

    by_liquidity = [
        ExposureBucket(
            key=k,
            label={"liquid": "Liquid (≤3 sessions)", "moderate": "Moderate (4–15)", "thin": "Thin (>15)", "unknown": "Unknown"}[k],
            value=v,
            weight_pct=(v / total * Decimal(100)).quantize(Decimal("0.01")),
        )
        for k, v in buckets.items()
        if v > 0
    ]

    if buckets["thin"] / total > Decimal("0.3"):
        warnings.append(
            f"{buckets['thin'] / total:.0%} of the portfolio sits in names estimated to take more "
            "than 15 sessions to liquidate at conservative participation."
        )

    # --- concentration ------------------------------------------------------
    weights = sorted((Decimal(str(h["market_value"])) / total for h in priced), reverse=True)
    top1 = (weights[0] * Decimal(100)).quantize(Decimal("0.01")) if weights else None
    top5 = (sum(weights[:5]) * Decimal(100)).quantize(Decimal("0.01")) if weights else None
    hhi = (sum(w * w for w in weights) * Decimal(10000)).quantize(Decimal("0.01")) if weights else None

    if top1 is not None and top1 > Decimal("25"):
        warnings.append(f"Largest position is {top1}% of the priced portfolio.")

    # --- days to liquidate the whole book ----------------------------------
    days_values = [float(h["days_to_liquidate"]) for h in priced if h.get("days_to_liquidate") is not None]
    est_days = Decimal(str(round(max(days_values), 2))) if days_values else None

    # --- scenarios ----------------------------------------------------------
    scenario_results: list[dict[str, Any]] = []
    for scenario in scenarios or _default_scenarios():
        shocked = Decimal("0")
        for h in priced:
            sector = str(h.get("sector") or "UNCLASSIFIED")
            shock = Decimal(str(scenario["shocks"].get(sector, scenario.get("default_shock", -0.10))))
            shocked += Decimal(str(h["market_value"])) * (Decimal("1") + shock)
        change = (shocked - total) / total * Decimal(100)
        scenario_results.append(
            {
                "name": scenario["name"],
                "description": scenario["description"],
                "portfolioValue": str(shocked.quantize(Decimal("0.01"))),
                "changePct": str(change.quantize(Decimal("0.01"))),
                "assumptions": scenario["shocks"],
            }
        )

    return PortfolioRisk(
        total_value=total,
        priced_value=priced_value,
        unpriced_value=unpriced_value,
        unpriced_positions=[str(h.get("ticker")) for h in unpriced],
        by_sector=by_sector,
        by_liquidity=by_liquidity,
        concentration_top1=top1,
        concentration_top5=top5,
        herfindahl=hhi,
        estimated_days_to_liquidate=est_days,
        scenario_results=scenario_results,
        warnings=warnings,
    )


def correlation_matrix(returns_by_ticker: dict[str, list[float]]) -> dict[str, Any]:
    """Pairwise correlations with an explicit sample-size gate."""
    tickers = sorted(returns_by_ticker)
    matrix: dict[str, dict[str, float | None]] = {}
    warnings: list[str] = []

    for a in tickers:
        matrix[a] = {}
        for b in tickers:
            xs, ys = returns_by_ticker[a], returns_by_ticker[b]
            n = min(len(xs), len(ys))
            if n < MIN_OBSERVATIONS_FOR_CORRELATION:
                matrix[a][b] = None
                continue
            try:
                matrix[a][b] = round(statistics.correlation(xs[-n:], ys[-n:]), 4)
            except (statistics.StatisticsError, ValueError):
                matrix[a][b] = None

    thin = [t for t in tickers if len(returns_by_ticker[t]) < MIN_OBSERVATIONS_FOR_CORRELATION]
    if thin:
        warnings.append(
            f"{len(thin)} holding(s) have fewer than {MIN_OBSERVATIONS_FOR_CORRELATION} return "
            "observations; their correlations are omitted rather than estimated from too little data."
        )
    return {"matrix": matrix, "warnings": warnings, "minObservations": MIN_OBSERVATIONS_FOR_CORRELATION}


def _default_scenarios() -> list[dict[str, Any]]:
    """Scenarios grounded in what actually moves this market."""
    return [
        {
            "name": "Broad market decline",
            "description": "DSEX falls 15%; all sectors move with it.",
            "default_shock": -0.15,
            "shocks": {},
        },
        {
            "name": "Rate shock",
            "description": "Policy tightening: banks and NBFIs re-rate, leveraged industrials fall harder.",
            "default_shock": -0.08,
            "shocks": {"BANK": -0.12, "FINANCIAL INSTITUTIONS": -0.15, "ENGINEERING": -0.12, "CEMENT": -0.12},
        },
        {
            "name": "FX and import cost shock",
            "description": "Taka depreciation raises input costs for import-dependent manufacturers.",
            "default_shock": -0.06,
            "shocks": {"PHARMACEUTICALS & CHEMICALS": -0.10, "TEXTILE": -0.12, "CEMENT": -0.14, "FUEL & POWER": -0.10},
        },
        {
            "name": "Liquidity withdrawal",
            "description": "Turnover collapses; thin names fall furthest.",
            "default_shock": -0.12,
            "shocks": {"MUTUAL FUNDS": -0.18, "MISCELLANEOUS": -0.20},
        },
    ]
