"""Corporate-action price adjustment.

Without this, every long-window factor is wrong: a 15% bonus issue looks like a
13% crash. The adjustment ledger is applied backwards from the most recent
action, and the cumulative factor is stored on every row so the transformation
is auditable rather than magic.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

ONE = Decimal("1")


@dataclass(slots=True)
class Action:
    ex_date: date
    action_type: str
    ratio: Decimal | None = None
    cash_amount_per_share: Decimal | None = None
    subscription_price: Decimal | None = None


def action_factor(action: Action, reference_price: Decimal | None) -> Decimal | None:
    """Price multiplier to apply to all bars BEFORE the ex-date.

    Returns None when the action cannot be adjusted with the data on hand — the
    caller must then mark the series rather than pretend it is continuous.
    """
    kind = action.action_type

    if kind in {"bonus_issue", "stock_split"}:
        if not action.ratio or action.ratio <= 0:
            return None
        # ratio is the multiplier of shares: 1.15 for a 15% bonus, 2.0 for 2:1.
        return ONE / action.ratio

    if kind == "reverse_split":
        if not action.ratio or action.ratio <= 0:
            return None
        return action.ratio

    if kind == "cash_dividend":
        if action.cash_amount_per_share is None or not reference_price or reference_price <= 0:
            return None
        adjusted = (reference_price - action.cash_amount_per_share) / reference_price
        return adjusted if adjusted > 0 else None

    if kind == "rights_issue":
        # Theoretical ex-rights price adjustment.
        if not action.ratio or action.subscription_price is None or not reference_price:
            return None
        n = action.ratio  # new shares per existing share
        terp = (reference_price + n * action.subscription_price) / (ONE + n)
        if reference_price <= 0 or terp <= 0:
            return None
        return terp / reference_price

    # Name/ticker changes and similar do not affect price.
    if kind in {"name_change", "ticker_change", "agm", "capital_reduction"}:
        return ONE

    return None


def build_adjusted_series(
    bars: list[dict[str, Any]],
    actions: list[Action],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Return (adjusted bars, warnings).

    Bars must be ascending by session_date. Warnings name every action that could
    not be applied — those are data-quality issues, not things to shrug off.
    """
    warnings: list[str] = []
    if not bars:
        return [], warnings

    ordered_actions = sorted(actions, key=lambda a: a.ex_date, reverse=True)
    factors: dict[date, Decimal] = {}

    for action in ordered_actions:
        # Reference price is the close on the last session before the ex-date.
        prior = [b for b in bars if b["session_date"] < action.ex_date and b.get("close") is not None]
        reference = Decimal(str(prior[-1]["close"])) if prior else None
        f = action_factor(action, reference)
        if f is None:
            warnings.append(
                f"Could not adjust for {action.action_type} on {action.ex_date}: "
                "insufficient data (ratio, amount or reference price missing)."
            )
            continue
        factors[action.ex_date] = factors.get(action.ex_date, ONE) * f

    out: list[dict[str, Any]] = []
    for bar in bars:
        cumulative = ONE
        for ex_date, f in factors.items():
            if bar["session_date"] < ex_date:
                cumulative *= f
        adjusted = dict(bar)
        for field in ("open", "high", "low", "close", "ltp", "ycp"):
            value = bar.get(field)
            if value is not None:
                adjusted[field] = Decimal(str(value)) * cumulative
        # Volume scales inversely so turnover stays consistent.
        if bar.get("volume") is not None and cumulative != 0:
            adjusted["volume"] = Decimal(str(bar["volume"])) / cumulative
        adjusted["adjustment_factor"] = cumulative
        adjusted["adjustment_basis"] = "corporate_action_adjusted"
        out.append(adjusted)

    return out, warnings
