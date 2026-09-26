"""Backtest metrics, including the ones that matter for a RANKING rather than a
strategy: rank IC, bucket spread, stability and turnover."""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass, asdict
from typing import Any


@dataclass(slots=True)
class ReturnMetrics:
    gross_return: float
    net_return: float
    benchmark_return: float
    excess_return: float
    max_drawdown: float
    volatility: float
    downside_deviation: float
    hit_rate: float
    turnover: float
    sample_size: int
    ci_low: float | None
    ci_high: float | None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def cumulative_return(period_returns: list[float]) -> float:
    total = 1.0
    for r in period_returns:
        total *= 1 + r
    return total - 1


def max_drawdown(equity_curve: list[float]) -> float:
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]
    worst = 0.0
    for v in equity_curve:
        peak = max(peak, v)
        if peak > 0:
            worst = max(worst, (peak - v) / peak)
    return worst


def downside_deviation(period_returns: list[float], threshold: float = 0.0) -> float:
    below = [min(0.0, r - threshold) for r in period_returns]
    if len(below) < 2:
        return 0.0
    return math.sqrt(sum(b * b for b in below) / len(below))


def bootstrap_ci(
    period_returns: list[float], *, iterations: int = 1000, alpha: float = 0.05, seed: int = 7
) -> tuple[float | None, float | None]:
    """Confidence interval on cumulative return.

    Reported always — a point estimate from 30 observations without an interval
    is the most common way a backtest overstates what it found.
    """
    import random

    if len(period_returns) < 20:
        return None, None
    rng = random.Random(seed)
    samples: list[float] = []
    n = len(period_returns)
    for _ in range(iterations):
        draw = [period_returns[rng.randrange(n)] for _ in range(n)]
        samples.append(cumulative_return(draw))
    samples.sort()
    lo = samples[int(iterations * alpha / 2)]
    hi = samples[int(iterations * (1 - alpha / 2))]
    return round(lo, 6), round(hi, 6)


def compute_return_metrics(
    *,
    gross_period_returns: list[float],
    net_period_returns: list[float],
    benchmark_period_returns: list[float],
    equity_curve: list[float],
    turnover: float,
) -> ReturnMetrics:
    gross = cumulative_return(gross_period_returns)
    net = cumulative_return(net_period_returns)
    bench = cumulative_return(benchmark_period_returns)
    vol = statistics.pstdev(net_period_returns) * math.sqrt(12) if len(net_period_returns) > 1 else 0.0
    wins = sum(1 for r in net_period_returns if r > 0)
    lo, hi = bootstrap_ci(net_period_returns)

    return ReturnMetrics(
        gross_return=round(gross, 6),
        net_return=round(net, 6),
        benchmark_return=round(bench, 6),
        excess_return=round(net - bench, 6),
        max_drawdown=round(max_drawdown(equity_curve), 6),
        volatility=round(vol, 6),
        downside_deviation=round(downside_deviation(net_period_returns), 6),
        hit_rate=round(wins / len(net_period_returns), 6) if net_period_returns else 0.0,
        turnover=round(turnover, 6),
        sample_size=len(net_period_returns),
        ci_low=lo,
        ci_high=hi,
    )


def rank_information_coefficient(
    scores: dict[str, float], forward_returns: dict[str, float]
) -> tuple[float | None, int]:
    """Spearman rank correlation between score and subsequent return.

    This, not the headline return, is the honest test of a RANKING model.
    """
    common = sorted(set(scores) & set(forward_returns))
    if len(common) < 10:
        return None, len(common)

    def ranks(values: list[float]) -> list[float]:
        order = sorted(range(len(values)), key=lambda i: values[i])
        out = [0.0] * len(values)
        for rank, idx in enumerate(order):
            out[idx] = float(rank)
        return out

    s = ranks([scores[k] for k in common])
    r = ranks([forward_returns[k] for k in common])
    try:
        return round(statistics.correlation(s, r), 6), len(common)
    except (statistics.StatisticsError, ValueError):
        return None, len(common)


def bucket_spread(
    scores: dict[str, float], forward_returns: dict[str, float], buckets: int = 5
) -> dict[str, Any]:
    """Average forward return by score bucket, plus the top-minus-bottom spread."""
    common = sorted(set(scores) & set(forward_returns), key=lambda k: scores[k], reverse=True)
    if len(common) < buckets * 3:
        return {"buckets": [], "spread": None, "n": len(common), "note": "too few names to bucket"}

    size = len(common) // buckets
    rows: list[dict[str, Any]] = []
    for b in range(buckets):
        start = b * size
        end = (b + 1) * size if b < buckets - 1 else len(common)
        members = common[start:end]
        avg = statistics.fmean(forward_returns[k] for k in members)
        rows.append({"bucket": b + 1, "n": len(members), "avgForwardReturn": round(avg, 6)})

    spread = rows[0]["avgForwardReturn"] - rows[-1]["avgForwardReturn"]
    return {"buckets": rows, "spread": round(spread, 6), "n": len(common)}


def ranking_stability(previous: dict[str, int], current: dict[str, int], top_n: int = 20) -> float:
    """Overlap between consecutive top-N lists. A ranking that churns completely
    every rebalance is noise, whatever its backtest return says."""
    prev_top = {k for k, v in previous.items() if v <= top_n}
    cur_top = {k for k, v in current.items() if v <= top_n}
    if not prev_top:
        return 0.0
    return round(len(prev_top & cur_top) / len(prev_top), 6)
