"""Engine tests: the rules that must not quietly regress.

Focus is on the places where a shortcut would produce a plausible-looking wrong
answer: missing values becoming zero, adjustments being skipped, an uncalibrated
probability escaping, and a screen result being promoted to a pass.
"""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.engines import adjustments, calibration, factors, shariah, unusual_activity, why_moving
from app.engines.adjustments import Action
from app.engines.types import Availability, Bar, BarSeries, FactorContext, FactorValue
from app.errors import UncalibratedModelError


# --------------------------------------------------------------------------
# missing is not zero
# --------------------------------------------------------------------------


def _ctx(**kw) -> FactorContext:
    defaults = dict(
        instrument_id="i1",
        issuer_id="s1",
        ticker="TEST",
        sector_code="CEMENT",
        scorecard_template="industrial",
        as_of=datetime(2026, 9, 24, 23, 59, tzinfo=timezone.utc),
        session_date=date(2026, 9, 24),
    )
    defaults.update(kw)
    return FactorContext(**defaults)


def test_unavailable_factor_is_not_usable():
    v = FactorValue.unavailable("pe", "no_eps")
    assert v.availability is Availability.UNAVAILABLE
    assert v.raw is None
    assert not v.usable


def test_missing_financials_produce_unavailable_not_zero():
    ctx = _ctx()
    v = factors.compute("net_margin", ctx)
    assert not v.usable
    assert v.raw is None
    assert v.reason is not None


def test_pe_is_unavailable_for_a_loss_maker_rather_than_negative():
    """A negative P/E would rank a loss-maker as 'cheap'. It must be unavailable."""
    bars = BarSeries(
        bars=[
            Bar(
                session_date=date(2026, 9, 24),
                open=None, high=None, low=None,
                close=Decimal("100"), volume=Decimal("1000"), turnover=Decimal("100000"),
            )
        ]
    )
    ctx = _ctx(
        _bars=bars,
        _financials={"eps_basic": [{"value": "-2.5", "period_type": "annual"}]},
    )
    v = factors.compute("pe", ctx)
    assert not v.usable
    assert "non_positive_eps" in (v.reason or "")


def test_eps_growth_is_unavailable_off_a_near_zero_base():
    ctx = _ctx(
        _financials={
            "eps_basic": [
                {"value": "3.10", "period_type": "annual"},
                {"value": "0.01", "period_type": "annual"},
            ]
        }
    )
    v = factors.compute("eps_growth_yoy", ctx)
    assert not v.usable
    assert "near_zero" in (v.reason or "")


def test_sector_gated_factor_is_not_applicable_for_banks():
    ctx = _ctx(sector_code="BANK", scorecard_template="bank")
    v = factors.compute("net_debt_to_equity", ctx)
    assert not v.usable
    assert "not_applicable" in (v.reason or "")


def test_no_turnover_means_maximally_illiquid_not_unknown():
    bars = BarSeries(
        bars=[
            Bar(
                session_date=date(2026, 1, 1),
                open=None, high=None, low=None,
                close=Decimal("10"), volume=Decimal("0"), turnover=Decimal("0"),
            )
            for _ in range(30)
        ]
    )
    v = factors.compute("liquidity_risk", _ctx(_bars=bars))
    # A name that does not trade is a measured extreme, not a missing value.
    assert v.usable
    assert v.raw == Decimal(999)


def test_governance_exposure_with_no_records_is_zero_not_unavailable():
    v = factors.compute("governance_exposure", _ctx(_governance=[]))
    assert v.usable
    assert v.raw == Decimal("0")


def test_allegations_weigh_far_less_than_final_findings():
    allegation = factors.compute(
        "governance_exposure",
        _ctx(_governance=[{"status": "allegation", "severity": "high", "age_days": 30}]),
    )
    finding = factors.compute(
        "governance_exposure",
        _ctx(_governance=[{"status": "final_finding", "severity": "high", "age_days": 30}]),
    )
    assert allegation.raw is not None and finding.raw is not None
    assert finding.raw > allegation.raw * 4


# --------------------------------------------------------------------------
# normalization
# --------------------------------------------------------------------------


def test_normalization_leaves_unavailable_values_unimputed():
    values = {
        "a": FactorValue("net_margin", raw=Decimal("10")),
        "b": FactorValue("net_margin", raw=Decimal("20")),
        "c": FactorValue("net_margin", raw=Decimal("30")),
        "d": FactorValue.unavailable("net_margin", "no_data"),
    }
    out = factors.normalize_cross_section("net_margin", values, peer_group_key="CEMENT:2026-09-24")
    assert out["d"].normalized is None  # never imputed to the median
    assert out["c"].normalized == Decimal("100")
    assert out["a"].normalized == Decimal("0")


def test_too_few_peers_makes_everything_unavailable():
    values = {
        "a": FactorValue("net_margin", raw=Decimal("10")),
        "b": FactorValue("net_margin", raw=Decimal("20")),
    }
    out = factors.normalize_cross_section("net_margin", values, peer_group_key="X:2026")
    assert all(not v.usable for v in out.values())


def test_winsorize_clips_extremes_on_a_real_sized_sample():
    values = [float(i) for i in range(1, 30)] + [1000.0]
    clipped = factors.winsorize(values, 2.0, 98.0)
    assert max(clipped) < 1000.0


def test_winsorize_skips_samples_too_small_to_judge():
    """Below the minimum, clipping cannot tell an outlier from the sample."""
    values = [1.0, 2.0, 3.0, 4.0, 1000.0]
    assert factors.winsorize(values) == values


def test_percentile_rank_puts_best_at_100_in_both_directions():
    higher = factors.percentile_rank({"a": 1.0, "b": 2.0, "c": 3.0}, higher_better=True)
    assert higher["c"] == 100.0 and higher["a"] == 0.0

    lower = factors.percentile_rank({"a": 1.0, "b": 2.0, "c": 3.0}, higher_better=False)
    # For a lower-is-better factor the smallest raw value is the best.
    assert lower["a"] == 100.0 and lower["c"] == 0.0


# --------------------------------------------------------------------------
# corporate action adjustment
# --------------------------------------------------------------------------


def test_bonus_issue_scales_prior_prices_down():
    bars = [
        {"session_date": date(2024, 12, 1), "close": Decimal("115"), "volume": Decimal("100")},
        {"session_date": date(2024, 12, 10), "close": Decimal("100"), "volume": Decimal("115")},
    ]
    actions = [Action(ex_date=date(2024, 12, 8), action_type="bonus_issue", ratio=Decimal("1.15"))]
    adjusted, warnings = adjustments.build_adjusted_series(bars, actions)
    assert not warnings
    # The pre-ex bar is divided by the share multiplier, so the 15% "drop" vanishes.
    assert adjusted[0]["close"] == Decimal("100")
    assert adjusted[1]["close"] == Decimal("100")


def test_unadjustable_action_warns_rather_than_guessing():
    bars = [{"session_date": date(2024, 12, 1), "close": Decimal("100"), "volume": Decimal("10")}]
    actions = [Action(ex_date=date(2024, 12, 8), action_type="rights_issue", ratio=None)]
    adjusted, warnings = adjustments.build_adjusted_series(bars, actions)
    assert warnings and "Could not adjust" in warnings[0]
    assert adjusted[0]["close"] == Decimal("100")  # left alone, not invented


# --------------------------------------------------------------------------
# calibration gate
# --------------------------------------------------------------------------


def test_regime_forecast_refuses_without_calibration():
    from app.engines import regime

    with pytest.raises(UncalibratedModelError):
        regime.forecast("snap-1", 60, calibration=None)


def test_calibration_fails_on_a_small_sample():
    probs = [0.6] * 40
    outcomes = [1] * 24 + [0] * 16
    report = calibration.assess(probs, outcomes, min_sample=200)
    assert not report.calibrated
    assert any("sample_size" in r for r in report.reasons)


def test_brier_and_log_loss_reward_a_confident_correct_forecast():
    good = calibration.brier([0.9, 0.1], [1, 0])
    bad = calibration.brier([0.1, 0.9], [1, 0])
    assert good < bad
    assert calibration.log_loss([0.9], [1]) < calibration.log_loss([0.1], [1])


# --------------------------------------------------------------------------
# shariah screen
# --------------------------------------------------------------------------


def _shariah_config():
    return {
        "methodologies": {
            "test": {
                "version": "1.0.0",
                "ratio_denominator": "market_cap",
                "prohibited_sectors": ["BANK"],
                "prohibited_keywords": ["alcohol"],
                "ratio_rules": [
                    {"metric": "interest_bearing_debt", "max_ratio": 0.30, "description": "debt"},
                ],
            }
        },
        "disclaimer": "test",
    }


def test_missing_ratio_input_yields_undetermined_never_pass():
    result = shariah.screen(
        issuer={"sector_code": "CEMENT", "business_description": "cement manufacturing"},
        financials={},  # nothing reported
        market_cap=Decimal("1000000"),
        methodology="test",
        data_date=date(2026, 9, 24),
        config=_shariah_config(),
    )
    assert result.status == "undetermined"
    assert result.undetermined_reasons


def test_prohibited_sector_fails():
    result = shariah.screen(
        issuer={"sector_code": "BANK", "business_description": "conventional banking"},
        financials={"interest_bearing_debt": Decimal("1")},
        market_cap=Decimal("1000000"),
        methodology="test",
        data_date=date(2026, 9, 24),
        config=_shariah_config(),
    )
    assert result.status == "fail"


def test_clean_issuer_passes_and_carries_the_disclaimer():
    result = shariah.screen(
        issuer={"sector_code": "CEMENT", "business_description": "cement manufacturing"},
        financials={"interest_bearing_debt": Decimal("100000")},
        market_cap=Decimal("1000000"),
        methodology="test",
        data_date=date(2026, 9, 24),
        config=_shariah_config(),
    )
    assert result.status == "pass"
    assert "not a religious certification" in result.disclaimer


# --------------------------------------------------------------------------
# language discipline
# --------------------------------------------------------------------------


def test_unusual_activity_never_alleges_wrongdoing():
    turnovers = [Decimal("100000")] * 40 + [Decimal("2000000")]
    closes = [Decimal("50")] * 41
    volumes = [Decimal("1000")] * 41
    observations = unusual_activity.detect(
        session_date=date(2026, 9, 24),
        turnovers=turnovers,
        closes=closes,
        volumes=volumes,
        disclosure_in_window_id=None,
    )
    assert observations
    text = " ".join(o.observation.lower() for o in observations)
    for banned in ("manipulat", "insider", "pump", "fraud", "scam"):
        assert banned not in text
    assert "no corresponding disclosure" in text


def test_why_moving_always_carries_the_non_causation_disclaimer():
    result = why_moving.analyse(
        window_start=datetime(2026, 9, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 9, 24, tzinfo=timezone.utc),
        stock_close_start=Decimal("100"),
        stock_close_end=Decimal("112"),
        market_close_start=Decimal("5000"),
        market_close_end=Decimal("5100"),
        events=[],
    )
    assert "does not prove causation" in result.disclaimer
    assert result.abnormal_return is not None


def test_why_moving_ranks_a_confirmed_filing_above_an_allegation():
    published = datetime(2026, 9, 3, tzinfo=timezone.utc)
    result = why_moving.analyse(
        window_start=datetime(2026, 9, 1, tzinfo=timezone.utc),
        window_end=datetime(2026, 9, 24, tzinfo=timezone.utc),
        stock_close_start=Decimal("100"),
        stock_close_end=Decimal("112"),
        market_close_start=Decimal("5000"),
        market_close_end=Decimal("5100"),
        events=[
            {
                "id": "e1",
                "event_type": "earnings_release",
                "title": "Annual results",
                "published_at": published,
                "event_at": published,
                "source_authority": "official_filing",
                "claim_status": "confirmed_document",
                "corroboration_count": 3,
            },
            {
                "id": "e2",
                "event_type": "major_contract",
                "title": "Rumoured contract",
                "published_at": published,
                "event_at": published,
                "source_authority": "social",
                "claim_status": "allegation",
                "corroboration_count": 0,
            },
        ],
    )
    assert result.candidates[0].kind == "earnings_release"
    assert "unproven allegation" in result.candidates[1].note
