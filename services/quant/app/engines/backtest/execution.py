"""Execution model.

DSE-specific realities encoded here: next-session fills, circuit limits, thin
books, and a cost stack that actually matters at retail size.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

ZERO = Decimal("0")


@dataclass(slots=True)
class CostModel:
    """Default cost stack. Override per run — these are conservative estimates,
    not quoted rates, and should be replaced with the user's actual broker terms."""

    brokerage_bps: Decimal = Decimal("40")        # 0.40% per side is typical retail
    exchange_fee_bps: Decimal = Decimal("5")
    regulatory_fee_bps: Decimal = Decimal("2")
    #: Capital gains / transaction tax on sale, where applicable.
    sell_tax_bps: Decimal = Decimal("5")
    #: Base slippage; scaled up by illiquidity below.
    base_slippage_bps: Decimal = Decimal("20")

    def round_trip_bps(self) -> Decimal:
        return (self.brokerage_bps * 2) + (self.exchange_fee_bps * 2) + self.regulatory_fee_bps + self.sell_tax_bps


@dataclass(slots=True)
class Fill:
    filled: bool
    session_date: date | None
    price: Decimal | None
    quantity: Decimal
    cost: Decimal
    slippage_bps: Decimal
    reason: str


def next_executable_session(
    signal_session: date,
    calendar: list[date],
) -> date | None:
    """The first trading session strictly after the signal session."""
    later = [d for d in calendar if d > signal_session]
    return min(later) if later else None


def estimate_slippage_bps(
    order_value: Decimal,
    median_turnover: Decimal | None,
    costs: CostModel,
) -> Decimal:
    """Slippage rises with participation. On thin DSE names this dominates costs."""
    if median_turnover is None or median_turnover <= 0:
        return costs.base_slippage_bps * Decimal("5")
    participation = order_value / median_turnover
    # Square-root impact, a standard and deliberately conservative shape.
    multiplier = Decimal(str(float(participation) ** 0.5)) if participation > 0 else ZERO
    return costs.base_slippage_bps * (Decimal("1") + multiplier * Decimal("4"))


def simulate_fill(
    *,
    side: str,
    target_value: Decimal,
    session_date: date,
    bar: dict[str, Any] | None,
    trading_state: str,
    median_turnover: Decimal | None,
    costs: CostModel,
    max_participation: Decimal = Decimal("0.10"),
) -> Fill:
    """Attempt a fill under realistic constraints."""
    if bar is None:
        return Fill(False, None, None, ZERO, ZERO, ZERO, "no_bar_for_session")

    if trading_state in {"suspended", "halted", "delisted"}:
        return Fill(False, None, None, ZERO, ZERO, ZERO, f"instrument_{trading_state}")

    if not bar.get("volume"):
        return Fill(False, None, None, ZERO, ZERO, ZERO, "no_trades_in_session")

    # A session pinned at the circuit limit is not reliably fillable in the
    # direction of the move.
    if bar.get("limit_bound"):
        return Fill(False, None, None, ZERO, ZERO, ZERO, "session_limit_bound")

    price = bar.get("close")
    if price is None:
        return Fill(False, None, None, ZERO, ZERO, ZERO, "no_close_price")
    price = Decimal(str(price))
    if price <= 0:
        return Fill(False, None, None, ZERO, ZERO, ZERO, "non_positive_price")

    # Capacity: cannot take more than `max_participation` of the session.
    session_turnover = Decimal(str(bar.get("turnover") or 0))
    capacity = session_turnover * max_participation
    executed_value = min(target_value, capacity) if capacity > 0 else ZERO
    if executed_value <= 0:
        return Fill(False, None, None, ZERO, ZERO, ZERO, "insufficient_capacity")

    slippage_bps = estimate_slippage_bps(executed_value, median_turnover, costs)
    direction = Decimal("1") if side == "buy" else Decimal("-1")
    fill_price = price * (Decimal("1") + direction * slippage_bps / Decimal("10000"))

    fee_bps = costs.brokerage_bps + costs.exchange_fee_bps + costs.regulatory_fee_bps
    if side == "sell":
        fee_bps += costs.sell_tax_bps
    cost = executed_value * fee_bps / Decimal("10000")

    partial = executed_value < target_value
    return Fill(
        filled=True,
        session_date=session_date,
        price=fill_price,
        quantity=executed_value / fill_price,
        cost=cost,
        slippage_bps=slippage_bps,
        reason="partial_fill_capacity_capped" if partial else "filled",
    )
