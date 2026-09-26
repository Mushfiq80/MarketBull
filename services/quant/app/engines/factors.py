"""Factor library.

Every factor declares its direction, its minimum observations, its freshness
budget and its sector applicability. A factor that cannot be computed returns
``FactorValue.unavailable`` with a reason — never 0.0, never NaN.

Caveats encoded here come from methodology §3 and from what the DSE market
actually looks like: thin trading, circuit limits, suspensions, and sectors
whose ratios are not comparable.
"""

from __future__ import annotations

import math
import statistics
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal, DivisionByZero, InvalidOperation
from typing import Any

from ..logging import get_logger
from .types import Availability, Direction, FactorContext, FactorValue

logger = get_logger(__name__)

ZERO = Decimal("0")


# --------------------------------------------------------------------------
# registry
# --------------------------------------------------------------------------


@dataclass(slots=True)
class FactorSpec:
    name: str
    pillar: str
    direction: Direction
    fn: Callable[[FactorContext], FactorValue]
    min_observations: int = 1
    max_staleness_days: int | None = None
    #: "all", or an explicit list of scorecard templates this applies to.
    sectors: str | list[str] = "all"
    description: str = ""


REGISTRY: dict[str, FactorSpec] = {}


def factor(
    *,
    name: str,
    pillar: str,
    direction: Direction,
    min_observations: int = 1,
    max_staleness_days: int | None = None,
    sectors: str | list[str] = "all",
    description: str = "",
) -> Callable[[Callable[[FactorContext], FactorValue]], Callable[[FactorContext], FactorValue]]:
    def decorate(fn: Callable[[FactorContext], FactorValue]):
        REGISTRY[name] = FactorSpec(
            name=name,
            pillar=pillar,
            direction=direction,
            fn=fn,
            min_observations=min_observations,
            max_staleness_days=max_staleness_days,
            sectors=sectors,
            description=description or (fn.__doc__ or "").strip().split("\n")[0],
        )
        return fn

    return decorate


def applicable(spec: FactorSpec, template: str) -> bool:
    return spec.sectors == "all" or template in spec.sectors


def compute(name: str, ctx: FactorContext) -> FactorValue:
    spec = REGISTRY.get(name)
    if spec is None:
        return FactorValue.unavailable(name, "unknown_factor")
    if not applicable(spec, ctx.scorecard_template):
        return FactorValue.not_applicable(name, f"sector template '{ctx.scorecard_template}'")
    try:
        value = spec.fn(ctx)
    except (InvalidOperation, DivisionByZero, ZeroDivisionError) as exc:
        return FactorValue.unavailable(name, f"arithmetic_error: {exc}")
    value.used_sample_data = value.used_sample_data or ctx.used_sample_data
    return value


def compute_all(ctx: FactorContext, pillar: str | None = None) -> dict[str, FactorValue]:
    out: dict[str, FactorValue] = {}
    for name, spec in REGISTRY.items():
        if pillar and spec.pillar != pillar:
            continue
        out[name] = compute(name, ctx)
    return out


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _pct_change(newer: Decimal, older: Decimal) -> Decimal | None:
    if older == 0:
        return None
    return (newer - older) / abs(older) * Decimal(100)


def _safe_div(a: Decimal | None, b: Decimal | None) -> Decimal | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


def _median(values: list[Decimal]) -> Decimal | None:
    if not values:
        return None
    return Decimal(str(statistics.median([float(v) for v in values])))


def _stdev(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    return statistics.pstdev(values)


def _returns(closes: list[Decimal]) -> list[float]:
    out: list[float] = []
    for prev, cur in zip(closes, closes[1:]):
        if prev and prev != 0:
            out.append(float((cur - prev) / prev))
    return out


# ==========================================================================
# F — Fundamentals
# ==========================================================================


@factor(
    name="revenue_growth_yoy",
    pillar="F",
    direction="higher_better",
    max_staleness_days=400,
    description="Year-over-year revenue growth using comparable fiscal periods.",
)
def revenue_growth_yoy(ctx: FactorContext) -> FactorValue:
    rows = ctx.financial("revenue", periods=5)
    if len(rows) < 2:
        return FactorValue.unavailable("revenue_growth_yoy", "need_two_comparable_periods", observations_used=len(rows))
    current, prior = rows[0], rows[1]
    # Comparable periods only — comparing a quarter to a year is meaningless.
    if current.get("period_type") != prior.get("period_type"):
        return FactorValue.unavailable("revenue_growth_yoy", "period_types_differ")
    newer = Decimal(str(current["value"])) if current.get("value") is not None else None
    older = Decimal(str(prior["value"])) if prior.get("value") is not None else None
    if newer is None or older is None:
        return FactorValue.unavailable("revenue_growth_yoy", "null_reported_value")
    change = _pct_change(newer, older)
    if change is None:
        return FactorValue.unavailable("revenue_growth_yoy", "prior_period_zero")
    return FactorValue("revenue_growth_yoy", raw=change, observations_used=2)


@factor(
    name="eps_growth_yoy",
    pillar="F",
    # A near-zero or negative base makes growth ratios nonsense, so this factor
    # is NOT monotonic and must not be naively ranked.
    direction="non_monotonic",
    max_staleness_days=400,
    description="Year-over-year EPS growth; unreliable off a near-zero base.",
)
def eps_growth_yoy(ctx: FactorContext) -> FactorValue:
    rows = ctx.financial("eps_basic", periods=5)
    if len(rows) < 2:
        return FactorValue.unavailable("eps_growth_yoy", "need_two_periods", observations_used=len(rows))
    newer_raw, older_raw = rows[0].get("value"), rows[1].get("value")
    if newer_raw is None or older_raw is None:
        return FactorValue.unavailable("eps_growth_yoy", "null_reported_value")
    newer, older = Decimal(str(newer_raw)), Decimal(str(older_raw))
    if abs(older) < Decimal("0.05"):
        return FactorValue.unavailable(
            "eps_growth_yoy", "prior_eps_near_zero_ratio_meaningless", observations_used=2
        )
    if older < 0:
        return FactorValue.unavailable("eps_growth_yoy", "prior_eps_negative_ratio_misleading")
    return FactorValue("eps_growth_yoy", raw=_pct_change(newer, older), observations_used=2)


@factor(
    name="operating_margin",
    pillar="F",
    direction="higher_better",
    sectors=["industrial", "general", "holding"],
    description="Operating income / revenue. Not meaningful for financial institutions.",
)
def operating_margin(ctx: FactorContext) -> FactorValue:
    revenue = ctx.latest_financial("revenue")
    operating = ctx.latest_financial("operating_income")
    ratio = _safe_div(operating, revenue)
    if ratio is None:
        return FactorValue.unavailable("operating_margin", "missing_revenue_or_operating_income")
    return FactorValue("operating_margin", raw=ratio * Decimal(100))


@factor(name="net_margin", pillar="F", direction="higher_better", description="Net income / revenue.")
def net_margin(ctx: FactorContext) -> FactorValue:
    revenue = ctx.latest_financial("revenue")
    net = ctx.latest_financial("net_income")
    ratio = _safe_div(net, revenue)
    if ratio is None:
        return FactorValue.unavailable("net_margin", "missing_revenue_or_net_income")
    return FactorValue("net_margin", raw=ratio * Decimal(100))


@factor(name="roe", pillar="F", direction="higher_better", description="Return on equity.")
def roe(ctx: FactorContext) -> FactorValue:
    net = ctx.latest_financial("net_income")
    equity = ctx.latest_financial("total_equity")
    if equity is not None and equity <= 0:
        return FactorValue.unavailable("roe", "negative_or_zero_equity_makes_roe_meaningless")
    ratio = _safe_div(net, equity)
    if ratio is None:
        return FactorValue.unavailable("roe", "missing_net_income_or_equity")
    return FactorValue("roe", raw=ratio * Decimal(100))


@factor(name="roa", pillar="F", direction="higher_better", description="Return on assets.")
def roa(ctx: FactorContext) -> FactorValue:
    net = ctx.latest_financial("net_income")
    assets = ctx.latest_financial("total_assets")
    ratio = _safe_div(net, assets)
    if ratio is None:
        return FactorValue.unavailable("roa", "missing_net_income_or_assets")
    return FactorValue("roa", raw=ratio * Decimal(100))


@factor(
    name="cash_conversion",
    pillar="F",
    direction="higher_better",
    sectors=["industrial", "general", "holding"],
    min_observations=3,
    description="Multi-period operating cash flow / net income. One year is too noisy.",
)
def cash_conversion(ctx: FactorContext) -> FactorValue:
    ocf_rows = ctx.financial("operating_cash_flow", periods=3)
    ni_rows = ctx.financial("net_income", periods=3)
    if len(ocf_rows) < 3 or len(ni_rows) < 3:
        return FactorValue.unavailable(
            "cash_conversion",
            "needs_three_periods_single_year_too_noisy",
            observations_used=min(len(ocf_rows), len(ni_rows)),
        )
    ocf = sum((Decimal(str(r["value"])) for r in ocf_rows if r.get("value") is not None), ZERO)
    ni = sum((Decimal(str(r["value"])) for r in ni_rows if r.get("value") is not None), ZERO)
    if ni <= 0:
        return FactorValue.unavailable("cash_conversion", "cumulative_net_income_not_positive")
    return FactorValue("cash_conversion", raw=(ocf / ni) * Decimal(100), observations_used=3)


@factor(
    name="net_debt_to_equity",
    pillar="F",
    direction="lower_better",
    sectors=["industrial", "general", "holding"],
    description="Net debt / equity. Deposits are not debt, so financials are excluded.",
)
def net_debt_to_equity(ctx: FactorContext) -> FactorValue:
    debt = ctx.latest_financial("total_debt")
    cash = ctx.latest_financial("cash_and_equivalents") or ZERO
    equity = ctx.latest_financial("total_equity")
    if debt is None or equity is None:
        return FactorValue.unavailable("net_debt_to_equity", "missing_debt_or_equity")
    if equity <= 0:
        return FactorValue.unavailable("net_debt_to_equity", "non_positive_equity")
    return FactorValue("net_debt_to_equity", raw=(debt - cash) / equity)


@factor(
    name="interest_coverage",
    pillar="F",
    direction="higher_better",
    sectors=["industrial", "general", "holding"],
    description="EBIT / interest expense.",
)
def interest_coverage(ctx: FactorContext) -> FactorValue:
    ebit = ctx.latest_financial("operating_income")
    interest = ctx.latest_financial("interest_expense")
    if ebit is None or interest is None:
        return FactorValue.unavailable("interest_coverage", "missing_ebit_or_interest")
    if interest == 0:
        return FactorValue.unavailable("interest_coverage", "no_interest_expense_ratio_undefined")
    return FactorValue("interest_coverage", raw=ebit / abs(interest))


@factor(name="pe", pillar="F", direction="lower_better", description="Price / earnings on trailing EPS.")
def pe(ctx: FactorContext) -> FactorValue:
    closes = ctx.bars(1).closes()
    eps = ctx.latest_financial("eps_basic")
    if not closes:
        return FactorValue.unavailable("pe", "no_price")
    if eps is None:
        return FactorValue.unavailable("pe", "no_eps")
    if eps <= 0:
        # Not "expensive" — undefined. Reporting a negative P/E as a score input
        # would rank a loss-maker as cheap.
        return FactorValue.unavailable("pe", "non_positive_eps_pe_undefined")
    return FactorValue("pe", raw=closes[-1] / eps)


@factor(name="pb", pillar="F", direction="lower_better", description="Price / book value per share.")
def pb(ctx: FactorContext) -> FactorValue:
    closes = ctx.bars(1).closes()
    bvps = ctx.latest_financial("book_value_per_share")
    if not closes:
        return FactorValue.unavailable("pb", "no_price")
    if bvps is None or bvps <= 0:
        return FactorValue.unavailable("pb", "missing_or_non_positive_book_value")
    return FactorValue("pb", raw=closes[-1] / bvps)


@factor(name="dividend_yield", pillar="F", direction="higher_better", description="Trailing dividend yield.")
def dividend_yield(ctx: FactorContext) -> FactorValue:
    closes = ctx.bars(1).closes()
    dps = ctx.latest_financial("dividend_per_share")
    if not closes or dps is None:
        return FactorValue.unavailable("dividend_yield", "missing_price_or_dividend")
    if closes[-1] == 0:
        return FactorValue.unavailable("dividend_yield", "zero_price")
    return FactorValue("dividend_yield", raw=(dps / closes[-1]) * Decimal(100))


# --- sector-specific F factors -------------------------------------------


@factor(
    name="net_interest_margin",
    pillar="F",
    direction="higher_better",
    sectors=["bank", "nbfi"],
    description="Net interest income / earning assets.",
)
def net_interest_margin(ctx: FactorContext) -> FactorValue:
    nii = ctx.latest_financial("net_interest_income")
    assets = ctx.latest_financial("earning_assets") or ctx.latest_financial("total_assets")
    ratio = _safe_div(nii, assets)
    if ratio is None:
        return FactorValue.unavailable("net_interest_margin", "missing_nii_or_assets")
    return FactorValue("net_interest_margin", raw=ratio * Decimal(100))


@factor(
    name="npl_ratio",
    pillar="F",
    direction="lower_better",
    sectors=["bank", "nbfi"],
    description="Non-performing loans / gross loans. The single most load-bearing bank metric here.",
)
def npl_ratio(ctx: FactorContext) -> FactorValue:
    npl = ctx.latest_financial("non_performing_loans")
    loans = ctx.latest_financial("gross_loans")
    ratio = _safe_div(npl, loans)
    if ratio is None:
        return FactorValue.unavailable("npl_ratio", "missing_npl_or_gross_loans")
    return FactorValue("npl_ratio", raw=ratio * Decimal(100))


@factor(
    name="provision_coverage",
    pillar="F",
    direction="higher_better",
    sectors=["bank", "nbfi"],
    description="Loan loss provisions / non-performing loans.",
)
def provision_coverage(ctx: FactorContext) -> FactorValue:
    provisions = ctx.latest_financial("loan_loss_provisions")
    npl = ctx.latest_financial("non_performing_loans")
    ratio = _safe_div(provisions, npl)
    if ratio is None:
        return FactorValue.unavailable("provision_coverage", "missing_provisions_or_npl")
    return FactorValue("provision_coverage", raw=ratio * Decimal(100))


@factor(
    name="capital_adequacy",
    pillar="F",
    direction="higher_better",
    sectors=["bank", "nbfi"],
    description="Total capital adequacy ratio as reported.",
)
def capital_adequacy(ctx: FactorContext) -> FactorValue:
    car = ctx.latest_financial("capital_adequacy_ratio")
    if car is None:
        return FactorValue.unavailable("capital_adequacy", "not_reported")
    return FactorValue("capital_adequacy", raw=car)


@factor(
    name="combined_ratio",
    pillar="F",
    direction="lower_better",
    sectors=["insurance"],
    description="Claims ratio + expense ratio. Below 100 means underwriting profit.",
)
def combined_ratio(ctx: FactorContext) -> FactorValue:
    claims = ctx.latest_financial("claims_ratio")
    expense = ctx.latest_financial("expense_ratio")
    if claims is None or expense is None:
        return FactorValue.unavailable("combined_ratio", "missing_claims_or_expense_ratio")
    return FactorValue("combined_ratio", raw=claims + expense)


# ==========================================================================
# O — Opportunity
# ==========================================================================


def _relative_strength(ctx: FactorContext, window: int, name: str) -> FactorValue:
    # Limit-bound sessions are excluded: a circuit-capped move is not a signal
    # about demand, it is a signal about the circuit.
    series = ctx.bars(window + 1, exclude_limit_bound=True)
    bench = ctx.benchmark(window + 1)
    closes = series.closes()
    bench_closes = bench.closes()
    if len(closes) < window + 1:
        return FactorValue.unavailable(name, "insufficient_price_history", observations_used=len(closes))
    if len(bench_closes) < window + 1:
        return FactorValue.unavailable(name, "insufficient_benchmark_history")

    stock = _pct_change(closes[-1], closes[0])
    market = _pct_change(bench_closes[-1], bench_closes[0])
    if stock is None or market is None:
        return FactorValue.unavailable(name, "zero_base_price")
    return FactorValue(name, raw=stock - market, observations_used=window)


@factor(name="rs_21", pillar="O", direction="higher_better", min_observations=22,
        description="21-session return minus DSEX.")
def rs_21(ctx: FactorContext) -> FactorValue:
    return _relative_strength(ctx, 21, "rs_21")


@factor(name="rs_63", pillar="O", direction="higher_better", min_observations=64,
        description="63-session return minus DSEX.")
def rs_63(ctx: FactorContext) -> FactorValue:
    return _relative_strength(ctx, 63, "rs_63")


@factor(name="rs_126", pillar="O", direction="higher_better", min_observations=127,
        description="126-session return minus DSEX.")
def rs_126(ctx: FactorContext) -> FactorValue:
    return _relative_strength(ctx, 126, "rs_126")


@factor(
    name="trend_structure",
    pillar="O",
    direction="higher_better",
    min_observations=200,
    description="Moving-average alignment, slope and position within the trailing range.",
)
def trend_structure(ctx: FactorContext) -> FactorValue:
    series = ctx.bars(200, exclude_limit_bound=True)
    closes = series.closes()
    if len(closes) < 60:
        return FactorValue.unavailable("trend_structure", "insufficient_history", observations_used=len(closes))

    def sma(n: int) -> Decimal | None:
        if len(closes) < n:
            return None
        window = closes[-n:]
        return sum(window, ZERO) / Decimal(len(window))

    ma20, ma50, ma200 = sma(20), sma(50), sma(200)
    price = closes[-1]
    score = ZERO
    components = 0

    if ma20 is not None:
        score += Decimal(25) if price > ma20 else ZERO
        components += 1
    if ma50 is not None:
        score += Decimal(25) if price > ma50 else ZERO
        components += 1
    if ma200 is not None:
        score += Decimal(25) if price > ma200 else ZERO
        components += 1
    if ma20 is not None and ma50 is not None:
        score += Decimal(25) if ma20 > ma50 else ZERO
        components += 1

    if components == 0:
        return FactorValue.unavailable("trend_structure", "no_moving_averages_available")
    # Rescale to 0-100 on the components that existed.
    return FactorValue(
        "trend_structure",
        raw=score * Decimal(4) / Decimal(components),
        observations_used=len(closes),
    )


@factor(
    name="turnover_ratio",
    pillar="O",
    direction="higher_better",
    min_observations=60,
    description="Current turnover vs its rolling MEDIAN — robust to one-off block trades.",
)
def turnover_ratio(ctx: FactorContext) -> FactorValue:
    series = ctx.bars(61)
    turnovers = series.turnovers()
    if len(turnovers) < 21:
        return FactorValue.unavailable("turnover_ratio", "insufficient_turnover_history", observations_used=len(turnovers))
    current = turnovers[-1]
    baseline = _median(turnovers[:-1])
    if baseline is None or baseline == 0:
        return FactorValue.unavailable("turnover_ratio", "zero_baseline_turnover")
    return FactorValue("turnover_ratio", raw=current / baseline, observations_used=len(turnovers))


@factor(
    name="active_session_ratio",
    pillar="O",
    direction="higher_better",
    min_observations=60,
    description="Fraction of recent sessions with any trade. The thin-name detector.",
)
def active_session_ratio(ctx: FactorContext) -> FactorValue:
    series = ctx.bars(60)
    if series.count == 0:
        return FactorValue.unavailable("active_session_ratio", "no_sessions")
    active = series.active_session_count()
    return FactorValue(
        "active_session_ratio",
        raw=Decimal(active) / Decimal(series.count) * Decimal(100),
        observations_used=series.count,
    )


@factor(
    name="catalyst_proximity",
    pillar="O",
    direction="higher_better",
    description="Days to the next verified upcoming event. Only confirmed documents count.",
)
def catalyst_proximity(ctx: FactorContext) -> FactorValue:
    upcoming = [
        e
        for e in ctx.events
        if e.get("claim_status") == "confirmed_document" and e.get("event_at") and e["event_at"] > ctx.as_of
    ]
    if not upcoming:
        return FactorValue.unavailable("catalyst_proximity", "no_confirmed_upcoming_events")
    nearest = min(upcoming, key=lambda e: e["event_at"])
    days = (nearest["event_at"] - ctx.as_of).days
    # Closer is better, decaying over a quarter.
    score = max(ZERO, Decimal(100) - Decimal(days) * Decimal("1.1"))
    return FactorValue("catalyst_proximity", raw=score, observations_used=len(upcoming))


# ==========================================================================
# X — eXposure & Risk  (higher raw = MORE exposure; inverted into Xq later)
# ==========================================================================


@factor(
    name="liquidity_risk",
    pillar="X",
    direction="lower_better",
    min_observations=60,
    description="Days to liquidate a notional position at conservative participation.",
)
def liquidity_risk(ctx: FactorContext) -> FactorValue:
    series = ctx.bars(60)
    turnovers = series.turnovers()
    if len(turnovers) < 20:
        return FactorValue.unavailable("liquidity_risk", "insufficient_turnover_history", observations_used=len(turnovers))
    median_turnover = _median(turnovers)
    if median_turnover is None or median_turnover == 0:
        # A name that does not trade is maximally illiquid, not unknown.
        return FactorValue("liquidity_risk", raw=Decimal(999), reason="no_turnover_in_window", observations_used=len(turnovers))

    # Notional position sized for a retail-to-small-institutional investor, and
    # a conservative 10% participation cap — DSE books are thin.
    notional = Decimal("5000000")  # BDT 50 lakh
    participation = Decimal("0.10")
    days = notional / (median_turnover * participation)
    return FactorValue("liquidity_risk", raw=days, observations_used=len(turnovers))


@factor(
    name="realized_vol_63",
    pillar="X",
    direction="lower_better",
    min_observations=64,
    description="Annualised realized volatility over 63 sessions.",
)
def realized_vol_63(ctx: FactorContext) -> FactorValue:
    closes = ctx.bars(64, exclude_limit_bound=True).closes()
    if len(closes) < 30:
        return FactorValue.unavailable("realized_vol_63", "insufficient_history", observations_used=len(closes))
    rets = _returns(closes)
    sd = _stdev(rets)
    if sd is None:
        return FactorValue.unavailable("realized_vol_63", "cannot_compute_stdev")
    annualised = sd * math.sqrt(250) * 100
    return FactorValue("realized_vol_63", raw=Decimal(str(round(annualised, 6))), observations_used=len(closes))


@factor(
    name="max_drawdown_252",
    pillar="X",
    direction="lower_better",
    min_observations=120,
    description="Trailing peak-to-trough decline over ~1 year.",
)
def max_drawdown_252(ctx: FactorContext) -> FactorValue:
    closes = ctx.bars(252).closes()
    if len(closes) < 60:
        return FactorValue.unavailable("max_drawdown_252", "insufficient_history", observations_used=len(closes))
    peak = closes[0]
    worst = ZERO
    for c in closes:
        if c > peak:
            peak = c
        if peak > 0:
            dd = (peak - c) / peak * Decimal(100)
            worst = max(worst, dd)
    return FactorValue("max_drawdown_252", raw=worst, observations_used=len(closes))


@factor(
    name="governance_exposure",
    pillar="X",
    direction="lower_better",
    description="Weighted documented governance findings, decayed by age.",
)
def governance_exposure(ctx: FactorContext) -> FactorValue:
    if not ctx.governance:
        # No recorded findings is a real observation, not a missing value.
        return FactorValue("governance_exposure", raw=ZERO, observations_used=0)

    # Allegations weigh far less than final findings. An unproven claim must not
    # be able to sink a score on its own.
    status_weight = {
        "final_finding": Decimal("1.0"),
        "proceeding": Decimal("0.4"),
        "interim_order": Decimal("0.4"),
        "allegation": Decimal("0.15"),
        "resolved": Decimal("0.1"),
        "reversed": ZERO,
    }
    severity_weight = {
        "critical": Decimal("4"),
        "high": Decimal("3"),
        "medium": Decimal("2"),
        "low": Decimal("1"),
        "info": Decimal("0.5"),
    }

    total = ZERO
    for item in ctx.governance:
        sw = status_weight.get(str(item.get("status")), Decimal("0.15"))
        vw = severity_weight.get(str(item.get("severity")), Decimal("2"))
        age_days = item.get("age_days")
        # Decay over three years; older findings matter less but never vanish.
        decay = Decimal("1.0")
        if isinstance(age_days, (int, float)) and age_days > 0:
            decay = max(Decimal("0.2"), Decimal(1) - Decimal(str(age_days)) / Decimal(1095))
        total += sw * vw * decay

    return FactorValue("governance_exposure", raw=total, observations_used=len(ctx.governance))


@factor(
    name="data_uncertainty",
    pillar="X",
    direction="lower_better",
    description="Freshness, authority, missingness and conflicts. Reduces CONVICTION, "
    "not a judgement about company quality.",
)
def data_uncertainty(ctx: FactorContext) -> FactorValue:
    penalties = ZERO
    bars = ctx.bars(20)
    if bars.count < 20:
        penalties += Decimal(20 - bars.count)
    if not ctx.financial("revenue", 1):
        penalties += Decimal(15)
    if not ctx.financial("net_income", 1):
        penalties += Decimal(15)
    if ctx.shares_outstanding is None:
        penalties += Decimal(10)
    if ctx.free_float is None:
        penalties += Decimal(5)
    return FactorValue("data_uncertainty", raw=penalties)


# --------------------------------------------------------------------------
# cross-sectional normalization
# --------------------------------------------------------------------------


#: Below this, winsorization cannot distinguish an outlier from the sample, so it
#: is skipped rather than applied misleadingly.
MIN_OBSERVATIONS_FOR_WINSORIZE = 20


def _percentile(ordered: list[float], pct: float) -> float:
    """Linear-interpolated percentile.

    Index-truncation was the earlier implementation and silently did nothing on
    small samples: with 5 values the 98th percentile landed exactly on the max,
    so the extreme clipped to itself.
    """
    if not ordered:
        raise ValueError("empty sample")
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * (pct / 100)
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def winsorize(values: list[float], lower_pct: float = 2.0, upper_pct: float = 98.0) -> list[float]:
    if len(values) < MIN_OBSERVATIONS_FOR_WINSORIZE:
        return values
    ordered = sorted(values)
    lo = _percentile(ordered, lower_pct)
    hi = _percentile(ordered, upper_pct)
    return [min(max(v, lo), hi) for v in values]


def percentile_rank(values: dict[str, float], *, higher_better: bool) -> dict[str, float]:
    """Rank/percentile scaling to 0-100, where 100 is always "best".

    Preferred over z-scores here: DSE factor distributions are fat-tailed and a
    handful of extreme values would otherwise dominate a composite.

    The ordering is the whole point and is easy to get backwards, so it is
    covered by a test: for a `higher_better` factor the LARGEST raw value scores
    100; for `lower_better` the SMALLEST does. That inversion is what lets the X
    pillar be stored as X-quality without a second sign flip downstream.
    """
    if not values:
        return {}
    # Sort best-first: descending for higher_better, ascending for lower_better.
    items = sorted(values.items(), key=lambda kv: kv[1], reverse=higher_better)
    n = len(items)
    if n == 1:
        return {items[0][0]: 50.0}
    out: dict[str, float] = {}
    for idx, (key, _) in enumerate(items):
        # idx 0 is the best → 100; the last is the worst → 0.
        out[key] = round((n - 1 - idx) / (n - 1) * 100, 6)
    return out


def normalize_cross_section(
    factor_name: str,
    by_instrument: dict[str, FactorValue],
    *,
    peer_group_key: str,
    winsor: tuple[float, float] = (2.0, 98.0),
) -> dict[str, FactorValue]:
    """Normalize one factor across a peer group, by sector and date.

    Unavailable values stay unavailable — they are NOT imputed to the median,
    because a company with no reported revenue is not an average company.
    """
    spec = REGISTRY.get(factor_name)
    if spec is None:
        return by_instrument

    usable = {k: float(v.raw) for k, v in by_instrument.items() if v.usable and v.raw is not None}
    if len(usable) < 3:
        for value in by_instrument.values():
            if value.usable:
                value.availability = Availability.UNAVAILABLE
                value.reason = f"peer_group_too_small:{len(usable)}"
        return by_instrument

    if spec.direction == "non_monotonic":
        # Cannot be ranked meaningfully; keep the raw value for display only.
        for key, value in by_instrument.items():
            value.peer_group_key = peer_group_key
            value.peer_count = len(usable)
        return by_instrument

    keys = list(usable)
    clipped = winsorize([usable[k] for k in keys], *winsor)
    clipped_map = dict(zip(keys, clipped))
    ranks = percentile_rank(clipped_map, higher_better=spec.direction == "higher_better")

    for key, value in by_instrument.items():
        value.peer_group_key = peer_group_key
        value.peer_count = len(usable)
        if key in ranks:
            value.normalized = Decimal(str(ranks[key]))
    return by_instrument


def redundancy_report(matrix: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    """Pairwise correlation between factors, so the same signal is not paid for twice.

    Momentum and trend are correlated by construction; this makes that visible
    before weights are fitted rather than after.
    """
    names = sorted(matrix)
    out: list[dict[str, Any]] = []
    for i, a in enumerate(names):
        for b in names[i + 1 :]:
            common = set(matrix[a]) & set(matrix[b])
            if len(common) < 10:
                continue
            xs = [matrix[a][k] for k in common]
            ys = [matrix[b][k] for k in common]
            try:
                rho = statistics.correlation(xs, ys)
            except (statistics.StatisticsError, ValueError):
                continue
            if abs(rho) >= 0.7:
                out.append({"factor_a": a, "factor_b": b, "correlation": round(rho, 4), "n": len(common)})
    return sorted(out, key=lambda r: -abs(r["correlation"]))
