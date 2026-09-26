"""Core value types for the quant engines.

``FactorValue`` exists so that "we don't know" survives every layer to the
screen. An engine that returns a bare float loses that information, and a
missing input silently becomes a zero somewhere downstream.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal


class Availability(str, Enum):
    AVAILABLE = "available"
    STALE = "stale"
    UNAVAILABLE = "unavailable"
    RESTRICTED = "restricted"
    UNDER_REVIEW = "under_review"


Direction = Literal["higher_better", "lower_better", "non_monotonic"]


@dataclass(slots=True)
class FactorValue:
    """A factor result, with its availability and the reason behind it."""

    factor: str
    raw: Decimal | None = None
    normalized: Decimal | None = None
    availability: Availability = Availability.AVAILABLE
    reason: str | None = None
    observations_used: int | None = None
    input_staleness_days: int | None = None
    used_sample_data: bool = False
    peer_group_key: str | None = None
    peer_count: int | None = None

    @classmethod
    def unavailable(cls, factor: str, reason: str, **kw: Any) -> "FactorValue":
        return cls(factor=factor, availability=Availability.UNAVAILABLE, reason=reason, **kw)

    @classmethod
    def not_applicable(cls, factor: str, reason: str) -> "FactorValue":
        """Sector-gated: the metric is meaningless here, not merely missing."""
        return cls(factor=factor, availability=Availability.UNAVAILABLE, reason=f"not_applicable: {reason}")

    @property
    def usable(self) -> bool:
        return self.availability in (Availability.AVAILABLE, Availability.STALE) and self.raw is not None


@dataclass(slots=True)
class Bar:
    session_date: date
    open: Decimal | None
    high: Decimal | None
    low: Decimal | None
    close: Decimal | None
    volume: Decimal | None
    turnover: Decimal | None
    limit_bound: bool = False
    quality: str = "ok"
    source_id: str = ""
    trading_state: str = "normal"

    @property
    def tradeable(self) -> bool:
        return self.trading_state == "normal" and not self.limit_bound and bool(self.volume)


@dataclass(slots=True)
class BarSeries:
    bars: list[Bar] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.bars)

    @property
    def count(self) -> int:
        return len(self.bars)

    @property
    def used_sample_data(self) -> bool:
        return any(b.source_id == "sample" for b in self.bars)

    def closes(self, *, exclude_limit_bound: bool = False) -> list[Decimal]:
        return [
            b.close
            for b in self.bars
            if b.close is not None and not (exclude_limit_bound and b.limit_bound)
        ]

    def turnovers(self) -> list[Decimal]:
        return [b.turnover for b in self.bars if b.turnover is not None]

    def active_session_count(self) -> int:
        return sum(1 for b in self.bars if b.volume)


@dataclass(slots=True)
class FactorContext:
    """Everything a factor is allowed to see.

    `as_of` is mandatory and every accessor filters by it — that is what makes a
    factor point-in-time safe by construction rather than by discipline.
    """

    instrument_id: str
    issuer_id: str
    ticker: str
    sector_code: str | None
    scorecard_template: str
    as_of: datetime
    session_date: date

    _bars: BarSeries | None = None
    _benchmark: BarSeries | None = None
    _financials: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    _shares_outstanding: Decimal | None = None
    _governance: list[dict[str, Any]] = field(default_factory=list)
    _events: list[dict[str, Any]] = field(default_factory=list)
    _free_float: Decimal | None = None

    def bars(self, lookback: int | None = None, *, exclude_limit_bound: bool = False) -> BarSeries:
        series = self._bars or BarSeries()
        selected = series.bars
        if exclude_limit_bound:
            selected = [b for b in selected if not b.limit_bound]
        if lookback is not None:
            selected = selected[-lookback:]
        return BarSeries(bars=selected)

    def benchmark(self, lookback: int | None = None) -> BarSeries:
        series = self._benchmark or BarSeries()
        return BarSeries(bars=series.bars[-lookback:] if lookback else series.bars)

    def financial(self, metric: str, periods: int = 1) -> list[dict[str, Any]]:
        """Reported values, newest first, already filtered to `as_of`."""
        return self._financials.get(metric, [])[:periods]

    def latest_financial(self, metric: str) -> Decimal | None:
        rows = self.financial(metric, 1)
        if not rows:
            return None
        value = rows[0].get("value")
        return None if value is None else Decimal(str(value))

    @property
    def shares_outstanding(self) -> Decimal | None:
        return self._shares_outstanding

    @property
    def free_float(self) -> Decimal | None:
        return self._free_float

    @property
    def governance(self) -> list[dict[str, Any]]:
        return self._governance

    @property
    def events(self) -> list[dict[str, Any]]:
        return self._events

    @property
    def used_sample_data(self) -> bool:
        bars = self._bars.used_sample_data if self._bars else False
        fins = any(
            row.get("source_id") == "sample"
            for rows in self._financials.values()
            for row in rows
        )
        return bars or fins


@dataclass(slots=True)
class PillarResult:
    pillar: str
    score: Decimal | None
    effective_weights: dict[str, float]
    factor_values: dict[str, float | None]
    available_count: int
    total_count: int
    reason: str | None = None


@dataclass(slots=True)
class GateResult:
    gate: str
    triggered: bool
    state: str  # eligible | restricted | review_required | excluded
    reason: str
    evidence: str | None = None
    since: str | None = None
