"""Benchmarks.

A strategy that beats nothing is not a result. Every run reports against DSEX,
the equal-weighted eligible universe, and a deliberately naive transparent rule
— because a factor model that cannot beat "hold the index" or "buy the 20 most
liquid names" has not earned its complexity.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from ...db import fetch_all


@dataclass(slots=True)
class BenchmarkSeries:
    name: str
    period_returns: list[float]
    description: str


def dsex_returns(rebalance_dates: list[date]) -> BenchmarkSeries:
    rows = fetch_all(
        """
        select session_date, close
          from index_observations
         where symbol = 'DSEX'
           and session_date = any(:dates)
         order by session_date
        """,
        dates=rebalance_dates,
    )
    closes = [float(r["close"]) for r in rows if r["close"] is not None]
    return BenchmarkSeries(
        name="DSEX",
        period_returns=_to_returns(closes),
        description="Broad market index, the default comparison.",
    )


def equal_weight_universe(
    rebalance_dates: list[date],
    universe_by_date: dict[date, list[str]],
) -> BenchmarkSeries:
    """Equal-weight the eligible universe. This is the benchmark a factor model
    must beat to justify existing at all."""
    period_returns: list[float] = []
    for previous, current in zip(rebalance_dates, rebalance_dates[1:]):
        members = universe_by_date.get(previous, [])
        if not members:
            period_returns.append(0.0)
            continue
        rows = fetch_all(
            """
            with start_px as (
              select instrument_id, close from market_bars
               where session_date = :start and adjustment_basis = 'corporate_action_adjusted'
                 and instrument_id = any(cast(:ids as uuid[]))
            ), end_px as (
              select instrument_id, close from market_bars
               where session_date = :end and adjustment_basis = 'corporate_action_adjusted'
                 and instrument_id = any(cast(:ids as uuid[]))
            )
            select s.instrument_id, s.close as start_close, e.close as end_close
              from start_px s join end_px e on e.instrument_id = s.instrument_id
            """,
            start=previous,
            end=current,
            ids=members,
        )
        rets = [
            float((Decimal(str(r["end_close"])) - Decimal(str(r["start_close"]))) / Decimal(str(r["start_close"])))
            for r in rows
            if r["start_close"] and float(r["start_close"]) > 0 and r["end_close"] is not None
        ]
        period_returns.append(statistics.fmean(rets) if rets else 0.0)

    return BenchmarkSeries(
        name="Equal-weight eligible universe",
        period_returns=period_returns,
        description="Equal weight across every name that passed the eligibility gates.",
    )


def naive_liquidity_rule(
    rebalance_dates: list[date],
    top_n: int = 20,
) -> BenchmarkSeries:
    """Hold the N most liquid names, equally weighted. Transparent and stupid on
    purpose — if the model cannot beat this, say so."""
    period_returns: list[float] = []
    for previous, current in zip(rebalance_dates, rebalance_dates[1:]):
        rows = fetch_all(
            """
            with liquid as (
              select instrument_id
                from market_bars
               where session_date = :start and adjustment_basis = 'raw'
               order by turnover desc nulls last
               limit :top_n
            )
            select b1.close as start_close, b2.close as end_close
              from liquid l
              join market_bars b1 on b1.instrument_id = l.instrument_id
                   and b1.session_date = :start and b1.adjustment_basis = 'corporate_action_adjusted'
              join market_bars b2 on b2.instrument_id = l.instrument_id
                   and b2.session_date = :end and b2.adjustment_basis = 'corporate_action_adjusted'
            """,
            start=previous,
            end=current,
            top_n=top_n,
        )
        rets = [
            float((Decimal(str(r["end_close"])) - Decimal(str(r["start_close"]))) / Decimal(str(r["start_close"])))
            for r in rows
            if r["start_close"] and float(r["start_close"]) > 0 and r["end_close"] is not None
        ]
        period_returns.append(statistics.fmean(rets) if rets else 0.0)

    return BenchmarkSeries(
        name=f"Top-{top_n} by turnover",
        period_returns=period_returns,
        description="Naive transparent rule: hold the most liquid names, equally weighted.",
    )


def _to_returns(values: list[float]) -> list[float]:
    return [(b - a) / a for a, b in zip(values, values[1:]) if a]
