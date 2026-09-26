"""Computation pipelines: factors → gates → FOX scores → regime snapshots.

All point-in-time. Every write records the model version and config hash, and
the effective weight vector actually used.
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from ..config import load_model_config
from ..db import connection, fetch_all, fetch_one
from ..logging import get_logger, log
from ..engines import conviction as C
from ..engines import factors as F
from ..engines import fox as FOX
from ..engines import gates as G
from ..engines import regime as R
from ..engines.types import Bar, BarSeries, FactorContext

logger = get_logger(__name__)


# --------------------------------------------------------------------------
# context loading (point-in-time)
# --------------------------------------------------------------------------


def _load_bars(instrument_id: str, as_of: date, lookback_days: int = 800) -> BarSeries:
    rows = fetch_all(
        """
        select b.session_date, b.open, b.high, b.low, b.close, b.volume, b.turnover,
               b.limit_bound, b.quality, b.source_id,
               coalesce(ts.state, 'normal') as trading_state
          from market_bars b
          left join trading_status ts
                 on ts.instrument_id = b.instrument_id and ts.session_date = b.session_date
         where b.instrument_id = cast(:iid as uuid)
           and b.session_date <= :as_of
            and b.session_date > (cast(:as_of as date) - make_interval(days => :lookback))
           and b.adjustment_basis = 'corporate_action_adjusted'
           and b.quality <> 'unavailable'
         order by b.session_date
        """,
        iid=instrument_id,
        as_of=as_of,
        lookback=lookback_days,
    )
    return BarSeries(
        bars=[
            Bar(
                session_date=r["session_date"],
                open=_dec(r["open"]),
                high=_dec(r["high"]),
                low=_dec(r["low"]),
                close=_dec(r["close"]),
                volume=_dec(r["volume"]),
                turnover=_dec(r["turnover"]),
                limit_bound=bool(r["limit_bound"]),
                quality=str(r["quality"]),
                source_id=str(r["source_id"]),
                trading_state=str(r["trading_state"]),
            )
            for r in rows
        ]
    )


def _load_benchmark(as_of: date, lookback_days: int = 800, symbol: str = "DSEX") -> BarSeries:
    rows = fetch_all(
        """
        select session_date, close, source_id, quality
          from index_observations
         where symbol = :symbol
           and session_date <= :as_of
           and session_date > (cast(:as_of as date) - make_interval(days => :lookback))
         order by session_date
        """,
        symbol=symbol,
        as_of=as_of,
        lookback=lookback_days,
    )
    return BarSeries(
        bars=[
            Bar(
                session_date=r["session_date"],
                open=None,
                high=None,
                low=None,
                close=_dec(r["close"]),
                volume=None,
                turnover=None,
                quality=str(r["quality"]),
                source_id=str(r["source_id"]),
            )
            for r in rows
        ]
    )


def _load_financials(issuer_id: str, as_of_ts: datetime) -> dict[str, list[dict[str, Any]]]:
    """Reported facts knowable at `as_of_ts`. Publication date, not period end."""
    rows = fetch_all(
        """
        select metric, value, unit, period_type, period_end, published_at, source_id, quality
          from financial_facts
         where issuer_id = cast(:iid as uuid)
           and (published_at is null or published_at <= :as_of)
           and (superseded_at is null or superseded_at > :as_of)
         order by metric, period_end desc, version desc
        """,
        iid=issuer_id,
        as_of=as_of_ts,
    )
    grouped: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        grouped.setdefault(str(r["metric"]), []).append(dict(r))
    return grouped


def _load_governance(issuer_id: str, as_of: date) -> list[dict[str, Any]]:
    rows = fetch_all(
        """
        select id::text as id, status::text as status, severity::text as severity,
               issue_date, subject
          from regulatory_actions
         where subject_issuer_id = cast(:iid as uuid)
           and (issue_date is null or issue_date <= :as_of)
        """,
        iid=issuer_id,
        as_of=as_of,
    )
    out = []
    for r in rows:
        age = (as_of - r["issue_date"]).days if r.get("issue_date") else None
        out.append({**r, "age_days": age})
    return out


def _load_events(issuer_id: str, as_of_ts: datetime) -> list[dict[str, Any]]:
    return fetch_all(
        """
        select e.id::text as id, e.event_type, e.title, e.event_at, e.published_at,
               e.claim_status::text as claim_status, e.source_authority::text as source_authority,
               e.corroboration_count
          from events e
          join event_entities ee on ee.event_id = e.id
         where ee.issuer_id = cast(:iid as uuid)
           and (e.published_at is null or e.published_at <= :as_of)
         order by e.event_at desc nulls last
         limit 200
        """,
        iid=issuer_id,
        as_of=as_of_ts,
    )


def build_context(
    instrument: dict[str, Any], as_of: date
) -> FactorContext:
    from ..engines.types import FactorContext as FC

    as_of_ts = datetime.combine(as_of, time(23, 59, 59), tzinfo=timezone.utc)
    template = _template_for(instrument.get("sector_code"))

    return FC(
        instrument_id=instrument["instrument_id"],
        issuer_id=instrument["issuer_id"],
        ticker=instrument["ticker"],
        sector_code=instrument.get("sector_code"),
        scorecard_template=template,
        as_of=as_of_ts,
        session_date=as_of,
        _bars=_load_bars(instrument["instrument_id"], as_of),
        _benchmark=_load_benchmark(as_of),
        _financials=_load_financials(instrument["issuer_id"], as_of_ts),
        _shares_outstanding=_dec(instrument.get("shares_outstanding")),
        _free_float=_dec(instrument.get("free_float_shares")),
        _governance=_load_governance(instrument["issuer_id"], as_of),
        _events=_load_events(instrument["issuer_id"], as_of_ts),
    )


_TEMPLATES = {
    "BANK": "bank",
    "FINANCIAL INSTITUTIONS": "nbfi",
    "NBFI": "nbfi",
    "INSURANCE": "insurance",
    "LIFE INSURANCE": "insurance",
    "GENERAL INSURANCE": "insurance",
}


def _template_for(sector_code: str | None) -> str:
    if not sector_code:
        return "general"
    upper = sector_code.upper()
    if upper in _TEMPLATES:
        return _TEMPLATES[upper]
    industrial = {"PHARMACEUTICALS", "PHARMACEUTICALS & CHEMICALS", "ENGINEERING", "TEXTILE",
                  "CEMENT", "FOOD & ALLIED", "FUEL & POWER", "CERAMICS", "TANNERY", "JUTE",
                  "PAPER & PRINTING"}
    return "industrial" if upper in industrial else "general"


def _dec(value: Any) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value))


# --------------------------------------------------------------------------
# factor pipeline
# --------------------------------------------------------------------------


def compute_factors(as_of: date, instrument_ids: list[str] | None = None) -> dict[str, Any]:
    cfg = load_model_config("fox")
    instruments = _eligible_instruments(as_of, instrument_ids)
    if not instruments:
        return {"computed": 0, "unavailable": 0, "modelVersion": cfg["version"], "note": "no instruments"}

    # 1. compute raw values per instrument
    per_instrument: dict[str, dict[str, Any]] = {}
    for inst in instruments:
        ctx = build_context(inst, as_of)
        per_instrument[inst["instrument_id"]] = {
            "ctx": ctx,
            "values": F.compute_all(ctx),
        }

    # 2. normalize cross-sectionally, grouped by sector (peer group)
    by_sector: dict[str, list[str]] = {}
    for iid, payload in per_instrument.items():
        key = payload["ctx"].sector_code or "UNCLASSIFIED"
        by_sector.setdefault(key, []).append(iid)

    for factor_name in F.REGISTRY:
        for sector, members in by_sector.items():
            subset = {iid: per_instrument[iid]["values"][factor_name] for iid in members}
            F.normalize_cross_section(factor_name, subset, peer_group_key=f"{sector}:{as_of}")

    # 3. persist
    computed = unavailable = 0
    rows: list[dict[str, Any]] = []
    as_of_ts = datetime.combine(as_of, time(23, 59, 59), tzinfo=timezone.utc)

    for iid, payload in per_instrument.items():
        for name, value in payload["values"].items():
            spec = F.REGISTRY[name]
            if value.usable:
                computed += 1
            else:
                unavailable += 1
            rows.append(
                {
                    "id": str(uuid.uuid4()),
                    "instrument_id": iid,
                    "as_of": as_of_ts,
                    "session_date": as_of,
                    "factor": name,
                    "pillar": spec.pillar,
                    "direction": spec.direction,
                    "raw_value": value.raw,
                    "normalized_value": value.normalized,
                    "normalization_method": "percentile_rank",
                    "peer_group_key": value.peer_group_key,
                    "peer_count": value.peer_count,
                    "availability": value.availability.value,
                    "unavailable_reason": value.reason,
                    "observations_used": value.observations_used,
                    "input_staleness_days": value.input_staleness_days,
                    "model_version": cfg["version"],
                    "config_hash": cfg["_hash"],
                    "used_sample_data": value.used_sample_data,
                }
            )

    with connection() as conn:
        conn.execute(
            text(
                """
                insert into factor_snapshots
                  (id, instrument_id, as_of, session_date, factor, pillar, direction,
                   raw_value, normalized_value, normalization_method, peer_group_key, peer_count,
                   availability, unavailable_reason, observations_used, input_staleness_days,
                   model_version, config_hash, used_sample_data)
                values
                  (:id, :instrument_id, :as_of, :session_date, :factor, :pillar,
                   cast(:direction as factor_direction), :raw_value, :normalized_value,
                   :normalization_method, :peer_group_key, :peer_count,
                   cast(:availability as availability), :unavailable_reason, :observations_used,
                   :input_staleness_days, :model_version, :config_hash, :used_sample_data)
                on conflict (instrument_id, session_date, factor, model_version)
                do update set
                   raw_value = excluded.raw_value,
                   normalized_value = excluded.normalized_value,
                   availability = excluded.availability,
                   unavailable_reason = excluded.unavailable_reason,
                   peer_count = excluded.peer_count,
                   computed_at = now()
                """
            ),
            rows,
        )

    log(logger, "info", "factors computed", as_of=str(as_of), computed=computed, unavailable=unavailable)
    return {
        "computed": computed,
        "unavailable": unavailable,
        "instruments": len(instruments),
        "modelVersion": cfg["version"],
        "configHash": cfg["_hash"],
    }


# --------------------------------------------------------------------------
# FOX scoring pipeline
# --------------------------------------------------------------------------


def score_fox(as_of: date, horizon: str, instrument_ids: list[str] | None = None) -> dict[str, Any]:
    cfg = load_model_config("fox")
    instruments = _eligible_instruments(as_of, instrument_ids)
    if not instruments:
        return {"scored": 0, "gated": 0, "modelVersion": cfg["version"], "note": "no instruments"}

    stored = _load_factor_snapshots(as_of, cfg["version"])
    scored = gated = 0
    rows: list[dict[str, Any]] = []
    as_of_ts = datetime.combine(as_of, time(23, 59, 59), tzinfo=timezone.utc)

    ranked: list[tuple[str, Decimal]] = []

    for inst in instruments:
        iid = inst["instrument_id"]
        values = stored.get(iid)
        if not values:
            continue

        ctx = build_context(inst, as_of)
        gate_state, gate_results = G.evaluate(
            ctx,
            values,
            horizon=horizon,
            trading_state=str(inst.get("trading_state") or "normal"),
            has_audited_statements=bool(ctx.financial("revenue", 1)),
            open_conflicts=int(inst.get("open_conflicts") or 0),
            config=cfg,
        )

        result = FOX.score(ctx, values, horizon=horizon, config=cfg)

        authorities = [str(e.get("source_authority")) for e in ctx.events[:20]] or ["exchange"]
        age_days = None
        bars = ctx.bars(1)
        if bars.count:
            age_days = (as_of - bars.bars[-1].session_date).days
        conviction_value, breakdown = C.score(
            factors=values,
            source_authorities=authorities,
            data_age_days=age_days,
            conflicting_sources=int(inst.get("open_conflicts") or 0),
        )

        if gate_state != "eligible":
            gated += 1
        if result.composite is not None:
            scored += 1
            ranked.append((iid, result.composite))

        rows.append(
            {
                "id": str(uuid.uuid4()),
                "instrument_id": iid,
                "as_of": as_of_ts,
                "session_date": as_of,
                "horizon": horizon,
                "fundamentals_score": result.fundamentals,
                "opportunity_score": result.opportunity,
                "exposure_quality_score": result.exposure_quality,
                "composite": result.composite,
                "conviction": conviction_value,
                "conviction_breakdown": json.dumps(breakdown.to_dict()),
                "effective_weights": json.dumps(result.effective_weights),
                "factor_values": json.dumps(result.factor_values),
                "gate_state": gate_state,
                "gate_triggers": json.dumps(G.triggered_only(gate_results)),
                "data_completeness": result.data_completeness,
                "model_version": result.model_version,
                "config_hash": result.config_hash,
                "used_sample_data": result.used_sample_data,
                "rank": None,
                "universe_size": len(instruments),
            }
        )

    # assign ranks among eligible, scored names
    ranked.sort(key=lambda t: t[1], reverse=True)
    rank_map = {iid: i + 1 for i, (iid, _) in enumerate(ranked)}
    for row in rows:
        row["rank"] = rank_map.get(row["instrument_id"])

    previous = _previous_scores(as_of, horizon, cfg["version"])
    for row in rows:
        prev = previous.get(row["instrument_id"])
        if prev and row["composite"] is not None and prev.get("composite") is not None:
            row["composite_delta"] = Decimal(str(row["composite"])) - Decimal(str(prev["composite"]))
            row["rank_delta"] = (prev.get("rank") or 0) - (row["rank"] or 0) if row["rank"] else None
        else:
            row["composite_delta"] = None
            row["rank_delta"] = None

    with connection() as conn:
        conn.execute(
            text(
                """
                insert into score_snapshots
                  (id, instrument_id, as_of, session_date, horizon,
                   fundamentals_score, opportunity_score, exposure_quality_score, composite,
                   conviction, conviction_breakdown, effective_weights, factor_values,
                   gate_state, gate_triggers, rank, universe_size, composite_delta, rank_delta,
                   model_version, config_hash, data_completeness, used_sample_data)
                values
                  (:id, :instrument_id, :as_of, :session_date, cast(:horizon as horizon),
                   :fundamentals_score, :opportunity_score, :exposure_quality_score, :composite,
                   :conviction, cast(:conviction_breakdown as jsonb), cast(:effective_weights as jsonb),
                   cast(:factor_values as jsonb), cast(:gate_state as gate_state),
                   cast(:gate_triggers as jsonb), :rank, :universe_size, :composite_delta, :rank_delta,
                   :model_version, :config_hash, :data_completeness, :used_sample_data)
                on conflict (instrument_id, session_date, horizon, model_version)
                do update set
                   composite = excluded.composite,
                   conviction = excluded.conviction,
                   gate_state = excluded.gate_state,
                   rank = excluded.rank,
                   computed_at = now()
                """
            ),
            rows,
        )

    log(logger, "info", "fox scored", as_of=str(as_of), horizon=horizon, scored=scored, gated=gated)
    return {
        "scored": scored,
        "gated": gated,
        "universe": len(instruments),
        "modelVersion": cfg["version"],
        "configHash": cfg["_hash"],
    }


# --------------------------------------------------------------------------
# regime pipeline
# --------------------------------------------------------------------------


def classify_regime(as_of: date) -> dict[str, Any]:
    cfg = load_model_config("regime")
    closes = fetch_all(
        """
        select session_date, close, source_id from index_observations
         where symbol = :symbol and session_date <= :as_of
         order by session_date desc limit 400
        """,
        symbol=cfg["anchor_index"],
        as_of=as_of,
    )
    closes.reverse()
    if len(closes) < 60:
        return {"state": "indeterminate", "reason": "insufficient_index_history", "sessions": len(closes)}

    breadth = fetch_one(
        "select * from breadth_snapshots where session_date <= :as_of order by session_date desc limit 1",
        as_of=as_of,
    )

    inputs = R.RegimeInputs(
        session_date=as_of,
        index_closes=[float(c["close"]) for c in closes if c["close"] is not None],
        breadth_pct_above_ma50=_f(breadth, "pct_above_ma50"),
        breadth_advance_decline=_advance_decline(breadth),
        new_highs=_i(breadth, "new_highs_52w"),
        new_lows=_i(breadth, "new_lows_52w"),
        turnover_percentile=_f(breadth, "turnover_percentile"),
        turnover_concentration_top10=_f(breadth, "turnover_concentration_top10"),
        used_sample_data=any(c["source_id"] == "sample" for c in closes),
    )

    result = R.classify(inputs, cfg)

    with connection() as conn:
        conn.execute(
            text(
                """
                insert into regime_snapshots
                  (id, exchange, session_date, as_of, state, state_score, factor_contributions,
                   effective_weights, missing_series, data_completeness, confidence,
                   transition_watch, model_version, config_hash, used_sample_data)
                values
                  (:id, 'DSE', :session_date, :as_of, cast(:state as regime_state), :state_score,
                   cast(:contributions as jsonb), cast(:weights as jsonb), cast(:missing as jsonb),
                   :completeness, :confidence, cast(:watch as jsonb), :model_version, :config_hash,
                   :used_sample_data)
                on conflict (exchange, session_date, model_version)
                do update set
                   state = excluded.state,
                   state_score = excluded.state_score,
                   factor_contributions = excluded.factor_contributions,
                   confidence = excluded.confidence,
                   transition_watch = excluded.transition_watch
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "session_date": as_of,
                "as_of": datetime.combine(as_of, time(23, 59, 59), tzinfo=timezone.utc),
                "state": result.state,
                "state_score": result.state_score,
                "contributions": json.dumps(result.factor_contributions),
                "weights": json.dumps(result.effective_weights),
                "missing": json.dumps(result.missing_series),
                "completeness": result.data_completeness,
                "confidence": result.confidence,
                "watch": json.dumps(result.transition_watch),
                "model_version": result.model_version,
                "config_hash": result.config_hash,
                "used_sample_data": result.used_sample_data,
            },
        )

    return {
        "state": result.state,
        "stateScore": float(result.state_score),
        "confidence": float(result.confidence),
        "missingSeries": result.missing_series,
        "modelVersion": result.model_version,
    }


# --------------------------------------------------------------------------


def _eligible_instruments(as_of: date, instrument_ids: list[str] | None) -> list[dict[str, Any]]:
    sql = """
        select i.id::text as instrument_id, i.issuer_id::text as issuer_id, i.ticker,
               iss.sector_code, i.shares_outstanding, i.free_float_shares,
               coalesce(ts.state, 'normal') as trading_state,
               (select count(*) from data_quality_issues d
                 where d.affected_entity_id = i.id and d.state = 'open'
                   and d.issue_kind = 'value_conflict') as open_conflicts
          from instruments i
          join issuers iss on iss.id = i.issuer_id
          left join lateral (
                select state from trading_status t
                 where t.instrument_id = i.id and t.session_date <= :as_of
                 order by t.session_date desc limit 1
          ) ts on true
         where i.is_current = true
           and (i.listing_date is null or i.listing_date <= :as_of)
           and (i.delisting_date is null or i.delisting_date > :as_of)
    """
    params: dict[str, Any] = {"as_of": as_of}
    if instrument_ids:
        sql += " and i.id = any(cast(:ids as uuid[]))"
        params["ids"] = instrument_ids
    return fetch_all(sql, **params)


def _load_factor_snapshots(as_of: date, model_version: str) -> dict[str, dict[str, Any]]:
    from ..engines.types import Availability, FactorValue

    rows = fetch_all(
        """
        select instrument_id::text as instrument_id, factor, raw_value, normalized_value,
               availability::text as availability, unavailable_reason, observations_used,
               peer_group_key, peer_count, used_sample_data
          from factor_snapshots
         where session_date = :as_of and model_version = :model_version
        """,
        as_of=as_of,
        model_version=model_version,
    )
    out: dict[str, dict[str, FactorValue]] = {}
    for r in rows:
        value = FactorValue(
            factor=str(r["factor"]),
            raw=_dec(r["raw_value"]),
            normalized=_dec(r["normalized_value"]),
            availability=Availability(str(r["availability"])),
            reason=r["unavailable_reason"],
            observations_used=r["observations_used"],
            peer_group_key=r["peer_group_key"],
            peer_count=r["peer_count"],
            used_sample_data=bool(r["used_sample_data"]),
        )
        out.setdefault(str(r["instrument_id"]), {})[value.factor] = value
    return out


def _previous_scores(as_of: date, horizon: str, model_version: str) -> dict[str, dict[str, Any]]:
    rows = fetch_all(
        """
        select distinct on (instrument_id)
               instrument_id::text as instrument_id, composite, rank
          from score_snapshots
         where session_date < :as_of
           and horizon = cast(:horizon as horizon)
           and model_version = :model_version
         order by instrument_id, session_date desc
        """,
        as_of=as_of,
        horizon=horizon,
        model_version=model_version,
    )
    return {r["instrument_id"]: r for r in rows}


def _f(row: dict[str, Any] | None, key: str) -> float | None:
    if not row or row.get(key) is None:
        return None
    return float(row[key])


def _i(row: dict[str, Any] | None, key: str) -> int | None:
    if not row or row.get(key) is None:
        return None
    return int(row[key])


def _advance_decline(row: dict[str, Any] | None) -> float | None:
    if not row:
        return None
    adv, dec = row.get("advancing"), row.get("declining")
    if adv is None or not dec:
        return None
    return float(adv) / float(dec)
