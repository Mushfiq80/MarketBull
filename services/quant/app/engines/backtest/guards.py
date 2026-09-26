"""Backtest bias guards.

Each guard RAISES. None of them warns. A backtest that silently contained
look-ahead is worse than no backtest, because it produces confidence that is not
earned — and someone eventually risks money on it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from ...errors import BaBullError, LookaheadError, SampleDataError


class SurvivorshipError(BaBullError):
    code = "SURVIVORSHIP_BIAS"
    http_status = 409


class CorporateActionError(BaBullError):
    code = "CORPORATE_ACTION_BIAS"
    http_status = 409


class ExecutionAssumptionError(BaBullError):
    code = "EXECUTION_BIAS"
    http_status = 409


class MultipleTestingWarning(BaBullError):
    code = "MULTIPLE_TESTING"
    http_status = 409


@dataclass(slots=True)
class GuardOutcome:
    name: str
    passed: bool
    detail: str | None = None


@dataclass(slots=True)
class GuardReport:
    outcomes: list[GuardOutcome] = field(default_factory=list)

    def to_dict(self) -> dict[str, dict[str, Any]]:
        return {o.name: {"passed": o.passed, "detail": o.detail} for o in self.outcomes}

    @property
    def all_passed(self) -> bool:
        return all(o.passed for o in self.outcomes)


class SampleDataGuard:
    """No sample-tagged row may enter a backtest. There is no override flag."""

    name = "SampleDataGuard"

    def check(self, rows: list[dict[str, Any]]) -> GuardOutcome:
        offenders = [r for r in rows if r.get("source_id") == "sample" or r.get("quality") == "sample"]
        if offenders:
            raise SampleDataError(
                f"{len(offenders)} sample-tagged row(s) are inside the backtest window. "
                "Sample data exists for UI development only and can never reach research. "
                "Run `npm run db:clear:sample` or move the window onto real data.",
                offending_rows=len(offenders),
                first_example={
                    k: str(v) for k, v in list(offenders[0].items())[:6]
                },
            )
        return GuardOutcome(self.name, True, "No sample-tagged rows in the window.")


class LookaheadGuard:
    """No row may be visible to a decision that could not have known it."""

    name = "LookaheadGuard"

    def check(self, rows: list[dict[str, Any]], decision_time: datetime) -> GuardOutcome:
        offenders = [
            r
            for r in rows
            if r.get("published_at") is not None and r["published_at"] > decision_time
        ]
        if offenders:
            worst = max(offenders, key=lambda r: r["published_at"])
            raise LookaheadError(
                f"{len(offenders)} row(s) were published after the simulated decision time "
                f"{decision_time.isoformat()}. The worst offender was published "
                f"{worst['published_at'].isoformat()}. "
                "Fiscal period end is not publication date, and event time is not the time the "
                "market could know.",
                offending_rows=len(offenders),
                decision_time=decision_time.isoformat(),
            )
        return GuardOutcome(self.name, True, f"All rows published on or before {decision_time.isoformat()}.")


class SurvivorshipGuard:
    """The universe must be what existed then, not what exists now."""

    name = "SurvivorshipGuard"

    def check(
        self,
        universe: list[dict[str, Any]],
        as_of: date,
        *,
        require_delisted_present: bool = True,
    ) -> GuardOutcome:
        if not universe:
            raise SurvivorshipError("Universe is empty for this date.", as_of=str(as_of))

        still_listed_only = all(u.get("listing_status") == "listed" for u in universe)
        has_history = any(u.get("delisting_date") is not None for u in universe)

        if require_delisted_present and still_listed_only and not has_history:
            raise SurvivorshipError(
                "The reconstructed universe contains only currently-listed names and no record of "
                "any delisting. Either the instrument master has no delisting history, or the "
                "universe was built from today's listings. Both produce a backtest that looks "
                "better than reality. Populate delisting dates or accept the run as invalid.",
                as_of=str(as_of),
                universe_size=len(universe),
            )
        return GuardOutcome(
            self.name,
            True,
            f"Universe of {len(universe)} names reconstructed as at {as_of}, including delisted history.",
        )


class CorporateActionGuard:
    """A series crossing a corporate action must be adjusted."""

    name = "CorporateActionGuard"

    def check(
        self,
        bars: list[dict[str, Any]],
        actions: list[dict[str, Any]],
    ) -> GuardOutcome:
        if not bars:
            return GuardOutcome(self.name, True, "No bars to check.")

        unadjusted = [b for b in bars if b.get("adjustment_basis") == "raw"]
        if not unadjusted or not actions:
            return GuardOutcome(self.name, True, "Series is corporate-action adjusted.")

        first = min(b["session_date"] for b in unadjusted)
        last = max(b["session_date"] for b in unadjusted)
        crossing = [
            a for a in actions if a.get("ex_date") and first <= a["ex_date"] <= last
            and a.get("action_type") in {"bonus_issue", "stock_split", "reverse_split", "rights_issue"}
        ]
        if crossing:
            raise CorporateActionError(
                f"{len(crossing)} share-count-changing corporate action(s) fall inside a window that "
                "is using RAW prices. A 15% bonus issue on a raw series reads as a 13% crash. "
                "Use the corporate-action-adjusted series.",
                actions=[{"type": a["action_type"], "ex_date": str(a["ex_date"])} for a in crossing[:5]],
            )
        return GuardOutcome(self.name, True, "No share-count actions inside the raw window.")


class ExecutionGuard:
    """A fill may not be assumed at or before the signal was available."""

    name = "ExecutionGuard"

    def check(self, signal_time: datetime, fill_session: date, signal_session: date) -> GuardOutcome:
        if fill_session <= signal_session:
            raise ExecutionAssumptionError(
                f"Fill assumed on {fill_session} from a signal generated on {signal_session}. "
                "A signal computed from a session's close cannot be executed at that same close. "
                "Use the next executable session.",
                signal_session=str(signal_session),
                fill_session=str(fill_session),
            )
        return GuardOutcome(self.name, True, f"Fill on {fill_session} follows signal on {signal_session}.")


class MultipleTestingGuard:
    """Trying forty variants and reporting the best is not a result."""

    name = "MultipleTestingGuard"

    def check(self, attempt_number: int, *, max_attempts_before_adjustment: int = 5) -> GuardOutcome:
        if attempt_number > max_attempts_before_adjustment:
            raise MultipleTestingWarning(
                f"This is attempt {attempt_number} against the same hypothesis. Past "
                f"{max_attempts_before_adjustment}, report confidence intervals adjusted for "
                "multiple comparisons and disclose the attempt count in the result, or "
                "pre-register a fresh hypothesis.",
                attempt_number=attempt_number,
            )
        return GuardOutcome(
            self.name,
            True,
            f"Attempt {attempt_number} of {max_attempts_before_adjustment} before adjustment is required.",
        )


ALL_GUARDS = [
    SampleDataGuard,
    LookaheadGuard,
    SurvivorshipGuard,
    CorporateActionGuard,
    ExecutionGuard,
    MultipleTestingGuard,
]
