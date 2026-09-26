"""Walk-forward backtest runner.

Chronological only. Never shuffled. Every guard runs and every guard raises.
Negative results are recorded, not discarded — an experiment registry that only
contains winners is a marketing document, not research.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from ...db import connection, fetch_all, fetch_one
from ...errors import BaBullError, InsufficientDataError
from ...logging import get_logger, log
from . import benchmarks as B
from . import metrics as M
from . import universe as U
from .execution import CostModel, next_executable_session, simulate_fill
from .guards import (
    CorporateActionGuard,
    ExecutionGuard,
    GuardOutcome,
    GuardReport,
    LookaheadGuard,
    MultipleTestingGuard,
    SampleDataGuard,
    SurvivorshipGuard,
)

logger = get_logger(__name__)


@dataclass(slots=True)
class BacktestConfig:
    name: str
    hypothesis: str
    horizon: str
    period_from: date
    period_to: date
    rebalance: str = "monthly"          # monthly | quarterly
    top_n: int = 20
    min_median_turnover: Decimal = Decimal("500000")
    model_version: str = "fox-0.1.0"
    initial_capital: Decimal = Decimal("10000000")
    costs: CostModel = field(default_factory=CostModel)
    max_participation: Decimal = Decimal("0.10")
    require_delisted_history: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "hypothesis": self.hypothesis,
            "horizon": self.horizon,
            "periodFrom": str(self.period_from),
            "periodTo": str(self.period_to),
            "rebalance": self.rebalance,
            "topN": self.top_n,
            "minMedianTurnover": str(self.min_median_turnover),
            "modelVersion": self.model_version,
            "initialCapital": str(self.initial_capital),
            "maxParticipation": str(self.max_participation),
            "costs": {
                "brokerageBps": str(self.costs.brokerage_bps),
                "exchangeFeeBps": str(self.costs.exchange_fee_bps),
                "regulatoryFeeBps": str(self.costs.regulatory_fee_bps),
                "sellTaxBps": str(self.costs.sell_tax_bps),
                "baseSlippageBps": str(self.costs.base_slippage_bps),
            },
        }


@dataclass(slots=True)
class BacktestOutcome:
    run_id: str
    status: str
    guard_report: GuardReport
    blocked_reason: str | None = None
    slices: dict[str, M.ReturnMetrics] = field(default_factory=dict)
    rank_ic: float | None = None
    rank_ic_n: int = 0
    bucket_spread: dict[str, Any] = field(default_factory=dict)
    stability: float | None = None
    benchmarks: dict[str, float] = field(default_factory=dict)
    limitations: list[str] = field(default_factory=list)
    interpretation: str = ""


def run(cfg: BacktestConfig) -> BacktestOutcome:
    run_id = str(uuid.uuid4())
    guards = GuardReport()
    attempt = _attempt_number(cfg)

    _record_run_start(run_id, cfg, attempt)

    try:
        outcome = _execute(run_id, cfg, guards, attempt)
    except BaBullError as exc:
        guards.outcomes.append(GuardOutcome(exc.code, False, exc.message))
        _record_run_blocked(run_id, exc.message, guards)
        log(logger, "warning", "backtest blocked", run_id=run_id, code=exc.code, message=exc.message)
        return BacktestOutcome(
            run_id=run_id,
            status="blocked",
            guard_report=guards,
            blocked_reason=exc.message,
        )

    _record_results(run_id, outcome)
    return outcome


# --------------------------------------------------------------------------


def _execute(run_id: str, cfg: BacktestConfig, guards: GuardReport, attempt: int) -> BacktestOutcome:
    guards.outcomes.append(MultipleTestingGuard().check(attempt))

    calendar = U.trading_calendar(cfg.period_from, cfg.period_to)
    if len(calendar) < 60:
        raise InsufficientDataError(
            f"Only {len(calendar)} trading sessions available between {cfg.period_from} and "
            f"{cfg.period_to}. Ingest more history before backtesting.",
        )

    rebalance_dates = _rebalance_dates(calendar, cfg.rebalance)
    if len(rebalance_dates) < 4:
        raise InsufficientDataError(
            f"Only {len(rebalance_dates)} rebalance points in the window — too few to conclude anything."
        )

    # --- one sample-data sweep over the whole window ----------------------
    window_rows = fetch_all(
        """
        select source_id, quality, session_date
          from market_bars
         where session_date between :start and :end
         limit 200000
        """,
        start=cfg.period_from,
        end=cfg.period_to,
    )
    guards.outcomes.append(SampleDataGuard().check(window_rows))

    equity = float(cfg.initial_capital)
    equity_curve: list[float] = [equity]
    gross_returns: list[float] = []
    net_returns: list[float] = []
    turnover_total = 0.0
    previous_ranks: dict[str, int] = {}
    stability_samples: list[float] = []
    all_scores: dict[str, float] = {}
    all_forward: dict[str, float] = {}
    universe_by_date: dict[date, list[str]] = {}
    regime_by_period: list[str] = []

    for idx, (decision_date, exit_date) in enumerate(zip(rebalance_dates, rebalance_dates[1:])):
        decision_time = datetime.combine(decision_date, time(23, 59), tzinfo=timezone.utc)

        members = U.reconstruct(
            decision_date,
            min_median_turnover=cfg.min_median_turnover,
        )
        guards_survivorship = SurvivorshipGuard().check(
            [
                {
                    "listing_status": m.listing_status,
                    "delisting_date": m.delisting_date,
                }
                for m in members
            ],
            decision_date,
            require_delisted_present=cfg.require_delisted_history and idx == 0,
        )
        if idx == 0:
            guards.outcomes.append(guards_survivorship)

        universe_by_date[decision_date] = [m.instrument_id for m in members]
        if not members:
            gross_returns.append(0.0)
            net_returns.append(0.0)
            equity_curve.append(equity)
            continue

        scores = _scores_as_of(decision_date, cfg.horizon, cfg.model_version, [m.instrument_id for m in members])
        if idx == 0:
            guards.outcomes.append(
                LookaheadGuard().check(
                    [{"published_at": s["as_of"]} for s in scores],
                    decision_time,
                )
            )
        if not scores:
            gross_returns.append(0.0)
            net_returns.append(0.0)
            equity_curve.append(equity)
            continue

        selected = scores[: cfg.top_n]
        fill_session = next_executable_session(decision_date, calendar)
        if fill_session is None:
            break
        if idx == 0:
            guards.outcomes.append(
                ExecutionGuard().check(decision_time, fill_session, decision_date)
            )

        position_value = Decimal(str(equity)) / Decimal(len(selected))
        period_gross = 0.0
        period_cost = 0.0
        filled_count = 0

        for row in selected:
            entry_bar = _bar(row["instrument_id"], fill_session)
            exit_bar = _bar(row["instrument_id"], exit_date)
            if entry_bar is None or exit_bar is None:
                continue

            if idx == 0:
                actions = fetch_all(
                    """
                    select action_type, ex_date from corporate_actions
                     where instrument_id = cast(:iid as uuid)
                       and ex_date between :start and :end
                    """,
                    iid=row["instrument_id"],
                    start=fill_session,
                    end=exit_date,
                )
                guards.outcomes.append(
                    CorporateActionGuard().check(
                        [{"adjustment_basis": "corporate_action_adjusted", "session_date": fill_session}],
                        actions,
                    )
                )

            fill = simulate_fill(
                side="buy",
                target_value=position_value,
                session_date=fill_session,
                bar=entry_bar,
                trading_state=entry_bar.get("trading_state", "normal"),
                median_turnover=row.get("median_turnover"),
                costs=cfg.costs,
                max_participation=cfg.max_participation,
            )
            if not fill.filled or fill.price is None:
                continue

            exit_price = exit_bar.get("close")
            if exit_price is None:
                continue

            filled_count += 1
            entry = float(fill.price)
            exit_p = float(exit_price)
            position_return = (exit_p - entry) / entry if entry else 0.0
            period_gross += position_return
            # Round-trip cost, expressed against the position.
            period_cost += float(cfg.costs.round_trip_bps()) / 10000.0
            turnover_total += 1.0

            all_scores[f"{row['instrument_id']}:{decision_date}"] = float(row["composite"])
            all_forward[f"{row['instrument_id']}:{decision_date}"] = position_return

        if filled_count == 0:
            gross_returns.append(0.0)
            net_returns.append(0.0)
            equity_curve.append(equity)
            continue

        gross = period_gross / filled_count
        net = gross - period_cost / filled_count
        gross_returns.append(gross)
        net_returns.append(net)
        equity *= 1 + net
        equity_curve.append(equity)

        ranks = {r["instrument_id"]: i + 1 for i, r in enumerate(selected)}
        if previous_ranks:
            stability_samples.append(M.ranking_stability(previous_ranks, ranks, cfg.top_n))
        previous_ranks = ranks

        regime_by_period.append(_regime_at(decision_date) or "unknown")

    if not net_returns:
        raise InsufficientDataError(
            "No period produced a fill. Check that price data and score snapshots exist for this window."
        )

    dsex = B.dsex_returns(rebalance_dates)
    equal_weight = B.equal_weight_universe(rebalance_dates, universe_by_date)
    naive = B.naive_liquidity_rule(rebalance_dates, top_n=cfg.top_n)

    overall = M.compute_return_metrics(
        gross_period_returns=gross_returns,
        net_period_returns=net_returns,
        benchmark_period_returns=_align(dsex.period_returns, len(net_returns)),
        equity_curve=equity_curve,
        turnover=turnover_total / max(1, len(net_returns)),
    )

    slices: dict[str, M.ReturnMetrics] = {"overall": overall}
    for regime in sorted(set(regime_by_period)):
        idxs = [i for i, r in enumerate(regime_by_period) if r == regime]
        if len(idxs) < 3:
            continue
        slices[f"regime:{regime}"] = M.compute_return_metrics(
            gross_period_returns=[gross_returns[i] for i in idxs],
            net_period_returns=[net_returns[i] for i in idxs],
            benchmark_period_returns=[_align(dsex.period_returns, len(net_returns))[i] for i in idxs],
            equity_curve=equity_curve,
            turnover=turnover_total / max(1, len(idxs)),
        )

    rank_ic, ic_n = M.rank_information_coefficient(all_scores, all_forward)
    spread = M.bucket_spread(all_scores, all_forward)
    stability = round(sum(stability_samples) / len(stability_samples), 6) if stability_samples else None

    limitations = _limitations(cfg, len(net_returns), ic_n)
    interpretation = _interpret(overall, dsex, equal_weight, naive, rank_ic, ic_n)

    return BacktestOutcome(
        run_id=run_id,
        status="succeeded",
        guard_report=guards,
        slices=slices,
        rank_ic=rank_ic,
        rank_ic_n=ic_n,
        bucket_spread=spread,
        stability=stability,
        benchmarks={
            dsex.name: M.cumulative_return(dsex.period_returns),
            equal_weight.name: M.cumulative_return(equal_weight.period_returns),
            naive.name: M.cumulative_return(naive.period_returns),
        },
        limitations=limitations,
        interpretation=interpretation,
    )


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _rebalance_dates(calendar: list[date], frequency: str) -> list[date]:
    if not calendar:
        return []
    step = {"monthly": 1, "quarterly": 3}.get(frequency, 1)
    out: list[date] = []
    seen: set[tuple[int, int]] = set()
    for d in calendar:
        key = (d.year, (d.month - 1) // step)
        if key not in seen:
            seen.add(key)
            out.append(d)
    return out


def _scores_as_of(
    session_date: date, horizon: str, model_version: str, instrument_ids: list[str]
) -> list[dict[str, Any]]:
    if not instrument_ids:
        return []
    return fetch_all(
        """
        select s.instrument_id::text as instrument_id,
               s.composite,
               s.as_of,
               s.gate_state
          from score_snapshots s
         where s.session_date = :session_date
           and s.horizon = cast(:horizon as horizon)
           and s.model_version = :model_version
           and s.gate_state = 'eligible'
           and s.composite is not null
           and s.instrument_id = any(cast(:ids as uuid[]))
         order by s.composite desc
        """,
        session_date=session_date,
        horizon=horizon,
        model_version=model_version,
        ids=instrument_ids,
    )


def _bar(instrument_id: str, session_date: date) -> dict[str, Any] | None:
    return fetch_one(
        """
        select b.close, b.turnover, b.volume, b.limit_bound,
               coalesce(ts.state, 'normal') as trading_state
          from market_bars b
          left join trading_status ts
                 on ts.instrument_id = b.instrument_id
                and ts.session_date = b.session_date
         where b.instrument_id = cast(:iid as uuid)
           and b.session_date = :session_date
           and b.adjustment_basis = 'corporate_action_adjusted'
         limit 1
        """,
        iid=instrument_id,
        session_date=session_date,
    )


def _regime_at(session_date: date) -> str | None:
    row = fetch_one(
        """
        select state::text as state from regime_snapshots
         where session_date <= :d order by session_date desc limit 1
        """,
        d=session_date,
    )
    return row["state"] if row else None


def _align(series: list[float], length: int) -> list[float]:
    if len(series) >= length:
        return series[:length]
    return series + [0.0] * (length - len(series))


def _attempt_number(cfg: BacktestConfig) -> int:
    row = fetch_one(
        "select count(*)::int as n from backtest_runs where hypothesis = :h",
        h=cfg.hypothesis,
    )
    return int(row["n"]) + 1 if row else 1


def _limitations(cfg: BacktestConfig, periods: int, ic_n: int) -> list[str]:
    out = [
        "Costs are estimates, not quoted broker terms — replace with actual rates before relying on net figures.",
        "Circuit-limit detection is heuristic until published limit bands are ingested.",
        "Fills assume a maximum 10% participation of session turnover; larger size would not fill.",
    ]
    if periods < 24:
        out.append(f"Only {periods} rebalance periods — far too few to distinguish skill from luck.")
    if ic_n < 200:
        out.append(f"Rank IC computed on {ic_n} observations; treat as indicative only.")
    out.append(
        "DSE has a small number of independent market cycles in the available history. "
        "Regime-sliced results in particular are based on very few episodes."
    )
    return out


def _interpret(
    overall: M.ReturnMetrics,
    dsex: B.BenchmarkSeries,
    equal_weight: B.BenchmarkSeries,
    naive: B.BenchmarkSeries,
    rank_ic: float | None,
    ic_n: int,
) -> str:
    """Plain-language verdict, including when the verdict is 'this did not work'."""
    bench = M.cumulative_return(dsex.period_returns)
    ew = M.cumulative_return(equal_weight.period_returns)
    nv = M.cumulative_return(naive.period_returns)
    best_bench = max(bench, ew, nv)

    parts: list[str] = []
    parts.append(
        f"Net cumulative return {overall.net_return:.1%} against DSEX {bench:.1%}, "
        f"equal-weight universe {ew:.1%} and the naive liquidity rule {nv:.1%}."
    )

    if overall.net_return <= best_bench:
        parts.append(
            "The strategy did NOT beat its best benchmark. Recorded as a negative result."
        )
    elif overall.ci_low is not None and overall.ci_low <= best_bench:
        parts.append(
            f"It beat the best benchmark on the point estimate, but the 95% confidence interval "
            f"({overall.ci_low:.1%} to {overall.ci_high:.1%}) includes it — not a distinguishable edge."
        )
    else:
        parts.append("It beat the best benchmark, and the confidence interval excludes it.")

    if rank_ic is None:
        parts.append(f"Rank IC could not be computed ({ic_n} paired observations).")
    else:
        parts.append(
            f"Rank IC {rank_ic:.3f} on {ic_n} observations — "
            + (
                "no meaningful rank-return relationship."
                if abs(rank_ic) < 0.02
                else "a weak but present rank-return relationship."
                if abs(rank_ic) < 0.05
                else "a notable rank-return relationship for an equity ranking."
            )
        )
    return " ".join(parts)


# --------------------------------------------------------------------------
# persistence
# --------------------------------------------------------------------------


def _record_run_start(run_id: str, cfg: BacktestConfig, attempt: int) -> None:
    from ...config import config_hash

    with connection() as conn:
        conn.execute(
            text(
                """
                insert into backtest_runs
                  (id, name, hypothesis, config, config_hash, model_version,
                   universe_definition, period_from, period_to, horizon,
                   rebalance_frequency, status, attempt_number)
                values
                  (:id, :name, :hypothesis, cast(:config as jsonb), :config_hash, :model_version,
                   :universe, :period_from, :period_to, cast(:horizon as horizon),
                   :rebalance, 'running', :attempt)
                """
            ),
            {
                "id": run_id,
                "name": cfg.name,
                "hypothesis": cfg.hypothesis,
                "config": json.dumps(cfg.to_dict()),
                "config_hash": config_hash(cfg.to_dict()),
                "model_version": cfg.model_version,
                "universe": f"eligible, median turnover >= {cfg.min_median_turnover}",
                "period_from": cfg.period_from,
                "period_to": cfg.period_to,
                "horizon": cfg.horizon,
                "rebalance": cfg.rebalance,
                "attempt": attempt,
            },
        )


def _record_run_blocked(run_id: str, reason: str, guards: GuardReport) -> None:
    with connection() as conn:
        conn.execute(
            text(
                """
                update backtest_runs
                   set status = 'blocked', blocked_reason = :reason,
                       guard_results = cast(:guards as jsonb), finished_at = now()
                 where id = :id
                """
            ),
            {"id": run_id, "reason": reason, "guards": json.dumps(guards.to_dict())},
        )


def _record_results(run_id: str, outcome: BacktestOutcome) -> None:
    with connection() as conn:
        conn.execute(
            text(
                """
                update backtest_runs
                   set status = :status, finished_at = now(),
                       guard_results = cast(:guards as jsonb)
                 where id = :id
                """
            ),
            {"id": run_id, "status": outcome.status, "guards": json.dumps(outcome.guard_report.to_dict())},
        )
        for slice_key, m in outcome.slices.items():
            conn.execute(
                text(
                    """
                    insert into backtest_results
                      (run_id, slice_key, gross_return, net_return, benchmark_return, benchmark_name,
                       excess_return, max_drawdown, volatility, downside_deviation, turnover, hit_rate,
                       rank_ic, top_bottom_spread, sample_size, ci_low, ci_high, interpretation,
                       limitations)
                    values
                      (:run_id, :slice_key, :gross, :net, :bench, 'DSEX', :excess, :dd, :vol, :dsd,
                       :turnover, :hit, :ic, :spread, :n, :ci_low, :ci_high, :interpretation,
                       cast(:limitations as jsonb))
                    on conflict (run_id, slice_key) do nothing
                    """
                ),
                {
                    "run_id": run_id,
                    "slice_key": slice_key,
                    "gross": m.gross_return,
                    "net": m.net_return,
                    "bench": m.benchmark_return,
                    "excess": m.excess_return,
                    "dd": m.max_drawdown,
                    "vol": m.volatility,
                    "dsd": m.downside_deviation,
                    "turnover": m.turnover,
                    "hit": m.hit_rate,
                    "ic": outcome.rank_ic if slice_key == "overall" else None,
                    "spread": outcome.bucket_spread.get("spread") if slice_key == "overall" else None,
                    "n": m.sample_size,
                    "ci_low": m.ci_low,
                    "ci_high": m.ci_high,
                    "interpretation": outcome.interpretation if slice_key == "overall" else None,
                    "limitations": json.dumps(outcome.limitations),
                },
            )
