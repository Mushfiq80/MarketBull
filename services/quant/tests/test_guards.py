"""Backtest guard tests.

These are the most important tests in the repo. Each guard must RAISE, not warn —
a backtest that silently contained look-ahead produces confidence that was never
earned, and someone eventually risks money on it.
"""

import inspect
from datetime import date, datetime, timedelta, timezone

import pytest

from app.engines.backtest.guards import (
    CorporateActionError,
    CorporateActionGuard,
    ExecutionAssumptionError,
    ExecutionGuard,
    LookaheadGuard,
    MultipleTestingGuard,
    MultipleTestingWarning,
    SampleDataGuard,
    SurvivorshipError,
    SurvivorshipGuard,
)
from app.errors import LookaheadError, SampleDataError


def test_sample_data_guard_raises():
    rows = [
        {"source_id": "dse_eod", "quality": "ok"},
        {"source_id": "sample", "quality": "sample", "session_date": "2026-01-02"},
    ]
    with pytest.raises(SampleDataError) as exc:
        SampleDataGuard().check(rows)
    assert "sample-tagged" in str(exc.value)


def test_sample_data_guard_has_no_override_flag():
    """ADR 0007: there is deliberately no way to let sample data through."""
    params = list(inspect.signature(SampleDataGuard().check).parameters)
    assert params == ["rows"]


def test_sample_data_guard_passes_on_real_data():
    outcome = SampleDataGuard().check([{"source_id": "dse_eod", "quality": "ok"}])
    assert outcome.passed


def test_lookahead_guard_catches_future_publication():
    decision = datetime(2026, 3, 14, 23, 59, tzinfo=timezone.utc)
    rows = [
        {"published_at": decision - timedelta(days=1)},
        {"published_at": decision + timedelta(hours=2)},  # not knowable yet
    ]
    with pytest.raises(LookaheadError) as exc:
        LookaheadGuard().check(rows, decision)
    assert "published after the simulated decision time" in str(exc.value)


def test_lookahead_guard_allows_unpublished_and_past_rows():
    decision = datetime(2026, 3, 14, tzinfo=timezone.utc)
    outcome = LookaheadGuard().check(
        [{"published_at": None}, {"published_at": decision - timedelta(days=30)}], decision
    )
    assert outcome.passed


def test_survivorship_guard_rejects_currently_listed_only_universe():
    universe = [{"listing_status": "listed", "delisting_date": None} for _ in range(50)]
    with pytest.raises(SurvivorshipError) as exc:
        SurvivorshipGuard().check(universe, date(2020, 6, 30), require_delisted_present=True)
    assert "only currently-listed names" in str(exc.value)


def test_survivorship_guard_accepts_universe_with_delisting_history():
    universe = [{"listing_status": "listed", "delisting_date": None} for _ in range(40)]
    universe.append({"listing_status": "delisted", "delisting_date": date(2021, 1, 4)})
    outcome = SurvivorshipGuard().check(universe, date(2020, 6, 30))
    assert outcome.passed


def test_survivorship_guard_rejects_empty_universe():
    with pytest.raises(SurvivorshipError):
        SurvivorshipGuard().check([], date(2020, 6, 30))


def test_corporate_action_guard_catches_raw_series_crossing_a_bonus():
    bars = [
        {"adjustment_basis": "raw", "session_date": date(2024, 12, 1)},
        {"adjustment_basis": "raw", "session_date": date(2024, 12, 20)},
    ]
    actions = [{"action_type": "bonus_issue", "ex_date": date(2024, 12, 8)}]
    with pytest.raises(CorporateActionError) as exc:
        CorporateActionGuard().check(bars, actions)
    # The message names the actual consequence, not just the rule.
    assert "reads as a 13% crash" in str(exc.value)


def test_corporate_action_guard_passes_on_adjusted_series():
    bars = [{"adjustment_basis": "corporate_action_adjusted", "session_date": date(2024, 12, 1)}]
    actions = [{"action_type": "bonus_issue", "ex_date": date(2024, 12, 8)}]
    assert CorporateActionGuard().check(bars, actions).passed


def test_corporate_action_guard_ignores_cash_dividend_on_raw_series():
    """A cash dividend does not change the share count, so a raw series is not
    structurally broken by it."""
    bars = [{"adjustment_basis": "raw", "session_date": date(2024, 12, 1)}]
    actions = [{"action_type": "cash_dividend", "ex_date": date(2024, 12, 8)}]
    assert CorporateActionGuard().check(bars, actions).passed


def test_execution_guard_rejects_same_session_fill():
    signal_session = date(2026, 3, 14)
    with pytest.raises(ExecutionAssumptionError) as exc:
        ExecutionGuard().check(
            datetime(2026, 3, 14, 15, 0, tzinfo=timezone.utc), signal_session, signal_session
        )
    assert "cannot be executed at that same close" in str(exc.value)


def test_execution_guard_accepts_next_session_fill():
    outcome = ExecutionGuard().check(
        datetime(2026, 3, 14, 15, 0, tzinfo=timezone.utc), date(2026, 3, 15), date(2026, 3, 14)
    )
    assert outcome.passed


def test_multiple_testing_guard_trips_after_repeated_attempts():
    assert MultipleTestingGuard().check(3).passed
    with pytest.raises(MultipleTestingWarning) as exc:
        MultipleTestingGuard().check(9)
    assert "multiple comparisons" in str(exc.value)
