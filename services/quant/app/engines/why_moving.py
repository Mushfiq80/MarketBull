"""'Why is this stock moving?' engine.

Decomposes a move against the market and its sector, then assembles candidate
explanations and RANKS them. It never asserts a cause: temporal association is
not causation, and the output says so every single time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

DISCLAIMER = (
    "These are candidate explanations ranked by timing, source quality, relevance and "
    "corroboration. Temporal association does not prove causation, and more than one "
    "factor may be involved."
)

AUTHORITY_SCORE = {
    "official_filing": 1.0,
    "regulator": 1.0,
    "exchange": 0.95,
    "company_statement": 0.8,
    "reputable_media": 0.55,
    "analyst": 0.4,
    "social": 0.1,
    "unknown": 0.25,
}

RELEVANCE_BY_TYPE = {
    "earnings_release": 1.0,
    "price_sensitive_information": 1.0,
    "dividend_declaration": 0.9,
    "regulatory_order": 0.9,
    "enforcement_action": 0.9,
    "trading_suspension": 1.0,
    "financial_restatement": 0.95,
    "director_resignation": 0.7,
    "sponsor_shareholding_change": 0.75,
    "major_contract": 0.7,
    "credit_rating_change": 0.7,
    "acquisition": 0.8,
    "litigation": 0.6,
    "plant_disruption": 0.75,
    "policy_change": 0.6,
    "monetary_policy": 0.5,
    "macro_release": 0.4,
    "sector_event": 0.5,
    "index_reconstitution": 0.6,
}


@dataclass(slots=True)
class Candidate:
    kind: str
    title: str
    occurred_at: datetime | None
    published_at: datetime | None
    source_authority: str
    claim_status: str
    evidence_ids: list[str] = field(default_factory=list)
    timing_score: float = 0.0
    source_score: float = 0.0
    relevance_score: float = 0.0
    corroboration_score: float = 0.0
    total_score: float = 0.0
    note: str = ""


@dataclass(slots=True)
class WhyMovingResult:
    stock_return: Decimal | None
    market_return: Decimal | None
    sector_return: Decimal | None
    abnormal_return: Decimal | None
    volume_ratio: Decimal | None
    candidates: list[Candidate]
    unexplained_residual: Decimal | None
    disclaimer: str = DISCLAIMER


def _pct(a: Decimal | None, b: Decimal | None) -> Decimal | None:
    if a is None or b is None or b == 0:
        return None
    return (a - b) / b * Decimal(100)


def analyse(
    *,
    window_start: datetime,
    window_end: datetime,
    stock_close_start: Decimal | None,
    stock_close_end: Decimal | None,
    market_close_start: Decimal | None,
    market_close_end: Decimal | None,
    sector_close_start: Decimal | None = None,
    sector_close_end: Decimal | None = None,
    window_turnover: Decimal | None = None,
    baseline_turnover: Decimal | None = None,
    events: list[dict[str, Any]] | None = None,
) -> WhyMovingResult:
    stock_return = _pct(stock_close_end, stock_close_start)
    market_return = _pct(market_close_end, market_close_start)
    sector_return = _pct(sector_close_end, sector_close_start)

    # Abnormal return is measured against the sector where we have it, the
    # market otherwise. On DSE a whole sector often moves together on policy.
    reference = sector_return if sector_return is not None else market_return
    abnormal = None
    if stock_return is not None and reference is not None:
        abnormal = stock_return - reference

    volume_ratio = None
    if window_turnover is not None and baseline_turnover and baseline_turnover > 0:
        volume_ratio = window_turnover / baseline_turnover

    candidates: list[Candidate] = []
    window_seconds = max((window_end - window_start).total_seconds(), 1.0)

    for event in events or []:
        published = event.get("published_at")
        occurred = event.get("event_at")
        reference_time = published or occurred
        if reference_time is None:
            continue

        # --- timing: the market can only react after publication ----------
        if reference_time > window_end:
            continue  # after the window entirely
        if reference_time < window_start:
            # Before the window — still possible (delayed reaction), but weak.
            timing = 0.15
        else:
            position = (reference_time - window_start).total_seconds() / window_seconds
            # Earlier in the window scores higher: the move follows the news.
            timing = 1.0 - min(0.85, position * 0.85)

        authority = AUTHORITY_SCORE.get(str(event.get("source_authority")), 0.25)
        relevance = RELEVANCE_BY_TYPE.get(str(event.get("event_type")), 0.35)

        corroboration = min(1.0, float(event.get("corroboration_count") or 0) / 3.0)
        if event.get("claim_status") == "confirmed_document":
            corroboration = max(corroboration, 0.8)
        elif event.get("claim_status") == "allegation":
            corroboration = min(corroboration, 0.3)

        total = timing * 0.35 + authority * 0.25 + relevance * 0.25 + corroboration * 0.15

        note = _note_for(event, reference_time, window_start)

        candidates.append(
            Candidate(
                kind=str(event.get("event_type")),
                title=str(event.get("title")),
                occurred_at=occurred,
                published_at=published,
                source_authority=str(event.get("source_authority")),
                claim_status=str(event.get("claim_status")),
                evidence_ids=[str(event["id"])] if event.get("id") else [],
                timing_score=round(timing, 4),
                source_score=round(authority, 4),
                relevance_score=round(relevance, 4),
                corroboration_score=round(corroboration, 4),
                total_score=round(total, 4),
                note=note,
            )
        )

    candidates.sort(key=lambda c: c.total_score, reverse=True)

    # Residual: what the ranked candidates plainly do not account for.
    residual = abnormal
    if abnormal is not None and candidates and candidates[0].total_score > 0.6:
        residual = None

    return WhyMovingResult(
        stock_return=stock_return,
        market_return=market_return,
        sector_return=sector_return,
        abnormal_return=abnormal,
        volume_ratio=volume_ratio,
        candidates=candidates,
        unexplained_residual=residual,
    )


def _note_for(event: dict[str, Any], reference_time: datetime, window_start: datetime) -> str:
    status = str(event.get("claim_status"))
    when = reference_time.isoformat()
    if reference_time < window_start:
        base = f"Published {when}, before the selected window."
    else:
        base = f"Published {when}, inside the selected window."

    if status == "allegation":
        return base + " This is an unproven allegation, attributed to its source and not a finding."
    if status == "attributed_report":
        return base + " Media report; attributed, not independently confirmed."
    if status == "model_inference":
        return base + " Model inference, not a documented fact."
    if status == "analyst_interpretation":
        return base + " Analyst interpretation, not a documented fact."
    return base + " Confirmed document."
