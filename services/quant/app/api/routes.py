"""HTTP surface of the quant service. Internal only — the browser never calls this."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..adapters import registry
from ..config import load_model_config, settings
from ..db import fetch_all, fetch_one
from ..engines import portfolio_risk, why_moving
from ..engines.backtest import report as backtest_report
from ..engines.backtest.runner import BacktestConfig, run as run_backtest
from ..errors import BaBullError
from ..logging import get_logger
from ..pipelines import compute, runner
from ..security import require_token

logger = get_logger(__name__)
router = APIRouter(dependencies=[Depends(require_token)])
public = APIRouter()


# --------------------------------------------------------------------------
# health
# --------------------------------------------------------------------------


@public.get("/health")
async def health() -> dict[str, Any]:
    models = {}
    for name in ("fox", "regime", "shariah"):
        try:
            cfg = load_model_config(name)
            models[name] = f"{cfg['version']} ({cfg['_hash']})"
        except Exception as exc:  # noqa: BLE001
            models[name] = f"error: {exc}"

    db_ok = True
    try:
        fetch_one("select 1 as ok")
    except Exception:  # noqa: BLE001
        db_ok = False

    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "unreachable",
        "adapters": registry.available(),
        "models": models,
    }


# --------------------------------------------------------------------------
# ingestion
# --------------------------------------------------------------------------


class IngestRequest(BaseModel):
    from_: date | None = Field(default=None, alias="from")
    to: date | None = None
    ticker: str | None = None

    model_config = {"populate_by_name": True}


@router.post("/ingest/{adapter}/verify")
async def verify_adapter(adapter: str, body: IngestRequest | None = None) -> dict[str, Any]:
    """Dry run: fetch, parse, report field-by-field. Writes NOTHING to the database.

    This is the first thing to run against any source. The adapters in this repo
    have never seen a live response.
    """
    body = body or IngestRequest()
    try:
        return await runner.verify(adapter, start=body.from_, end=body.to)
    except BaBullError as exc:
        raise HTTPException(status_code=exc.http_status, detail={"code": exc.code, "message": exc.message})


@router.post("/ingest/{adapter}")
async def ingest_adapter(adapter: str, body: IngestRequest | None = None) -> dict[str, Any]:
    body = body or IngestRequest()
    extra = {"ticker": body.ticker} if body.ticker else {}
    try:
        result = await runner.ingest(adapter, start=body.from_, end=body.to, extra=extra)
    except BaBullError as exc:
        raise HTTPException(status_code=exc.http_status, detail={"code": exc.code, "message": exc.message})
    return result.to_dict()


@router.get("/adapters")
async def list_adapters() -> list[dict[str, str]]:
    return registry.describe()


# --------------------------------------------------------------------------
# computation
# --------------------------------------------------------------------------


class ComputeRequest(BaseModel):
    asOf: date
    instrumentIds: list[str] | None = None


@router.post("/factors/compute")
async def factors_compute(body: ComputeRequest) -> dict[str, Any]:
    try:
        return compute.compute_factors(body.asOf, body.instrumentIds)
    except BaBullError as exc:
        raise HTTPException(status_code=exc.http_status, detail={"code": exc.code, "message": exc.message})


class ScoreRequest(ComputeRequest):
    horizon: str = "medium"


@router.post("/fox/score")
async def fox_score(body: ScoreRequest) -> dict[str, Any]:
    if body.horizon not in {"short", "medium", "long"}:
        raise HTTPException(status_code=400, detail={"code": "VALIDATION_FAILED", "message": "Invalid horizon."})
    try:
        return compute.score_fox(body.asOf, body.horizon, body.instrumentIds)
    except BaBullError as exc:
        raise HTTPException(status_code=exc.http_status, detail={"code": exc.code, "message": exc.message})


class RegimeRequest(BaseModel):
    asOf: date


@router.post("/regime/classify")
async def regime_classify(body: RegimeRequest) -> dict[str, Any]:
    return compute.classify_regime(body.asOf)


class RegimeForecastRequest(BaseModel):
    asOf: date
    horizonSessions: int = 60


@router.post("/regime/forecast")
async def regime_forecast(body: RegimeForecastRequest) -> dict[str, Any]:
    """Transition probabilities.

    Returns MODEL_UNCALIBRATED until calibration passes. An uncalibrated
    probability is not a probability.
    """
    snapshot = fetch_one(
        "select id::text as id from regime_snapshots where session_date <= :d order by session_date desc limit 1",
        d=body.asOf,
    )
    if snapshot is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "No regime snapshot for that date."})

    rows = fetch_all(
        """
        select horizon_sessions, target_state::text as target_state, probability,
               calibration_state, brier_score, log_loss, calibration_sample_size
          from regime_forecasts
         where regime_snapshot_id = cast(:id as uuid)
           and horizon_sessions = :h
           and calibration_state = 'calibrated'
        """,
        id=snapshot["id"],
        h=body.horizonSessions,
    )
    if not rows:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "MODEL_UNCALIBRATED",
                "message": (
                    "Regime transition probabilities are not calibrated yet. Run the calibration "
                    "backtest and record Brier/log-loss before this output is enabled."
                ),
            },
        )
    return {"calibrationState": "calibrated", "forecasts": rows}


# --------------------------------------------------------------------------
# research
# --------------------------------------------------------------------------


class WhyMovingRequest(BaseModel):
    issuerId: str
    from_: date = Field(alias="from")
    to: date

    model_config = {"populate_by_name": True}


@router.post("/why-moving")
async def why_moving_route(body: WhyMovingRequest) -> dict[str, Any]:
    instrument = fetch_one(
        """
        select i.id::text as id, iss.sector_code
          from instruments i join issuers iss on iss.id = i.issuer_id
         where i.issuer_id = cast(:iid as uuid) and i.is_current = true limit 1
        """,
        iid=body.issuerId,
    )
    if instrument is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Issuer not found."})

    def bar(d: date, instrument_id: str) -> dict[str, Any] | None:
        return fetch_one(
            """
            select close, turnover from market_bars
             where instrument_id = cast(:iid as uuid) and session_date <= :d
               and adjustment_basis = 'corporate_action_adjusted'
             order by session_date desc limit 1
            """,
            iid=instrument_id,
            d=d,
        )

    def index(d: date) -> dict[str, Any] | None:
        return fetch_one(
            "select close from index_observations where symbol='DSEX' and session_date <= :d "
            "order by session_date desc limit 1",
            d=d,
        )

    start_bar, end_bar = bar(body.from_, instrument["id"]), bar(body.to, instrument["id"])
    start_idx, end_idx = index(body.from_), index(body.to)

    baseline = fetch_one(
        """
        select percentile_cont(0.5) within group (order by turnover) as median_turnover
          from market_bars
         where instrument_id = cast(:iid as uuid) and session_date < :d
           and session_date > (cast(:d as date) - interval '90 days')
        """,
        iid=instrument["id"],
        d=body.from_,
    )

    events = fetch_all(
        """
        select e.id::text as id, e.event_type, e.title, e.event_at, e.published_at,
               e.claim_status::text as claim_status, e.source_authority::text as source_authority,
               e.corroboration_count
          from events e join event_entities ee on ee.event_id = e.id
         where ee.issuer_id = cast(:iid as uuid)
           and e.published_at between (cast(:start as date) - interval '14 days') and (cast(:end as date) + interval '1 day')
         order by e.published_at desc
        """,
        iid=body.issuerId,
        start=body.from_,
        end=body.to,
    )

    result = why_moving.analyse(
        window_start=datetime.combine(body.from_, datetime.min.time()),
        window_end=datetime.combine(body.to, datetime.max.time()),
        stock_close_start=_d(start_bar, "close"),
        stock_close_end=_d(end_bar, "close"),
        market_close_start=_d(start_idx, "close"),
        market_close_end=_d(end_idx, "close"),
        window_turnover=_d(end_bar, "turnover"),
        baseline_turnover=_d(baseline, "median_turnover"),
        events=events,
    )

    return {
        "issuerId": body.issuerId,
        "window": {"from": str(body.from_), "to": str(body.to)},
        "stockReturn": _s(result.stock_return),
        "marketReturn": _s(result.market_return),
        "sectorReturn": _s(result.sector_return),
        "abnormalReturn": _s(result.abnormal_return),
        "volumeRatio": _s(result.volume_ratio),
        "candidates": [
            {
                "rank": i + 1,
                "kind": c.kind,
                "title": c.title,
                "occurredAt": c.occurred_at.isoformat() if c.occurred_at else None,
                "publishedAt": c.published_at.isoformat() if c.published_at else None,
                "sourceAuthority": c.source_authority,
                "claimStatus": c.claim_status,
                "timingScore": c.timing_score,
                "sourceScore": c.source_score,
                "relevanceScore": c.relevance_score,
                "corroborationScore": c.corroboration_score,
                "totalScore": c.total_score,
                "evidenceIds": c.evidence_ids,
                "note": c.note,
            }
            for i, c in enumerate(result.candidates)
        ],
        "unexplainedResidual": _s(result.unexplained_residual),
        "disclaimer": result.disclaimer,
    }


# --------------------------------------------------------------------------
# backtests
# --------------------------------------------------------------------------


class BacktestRequest(BaseModel):
    name: str
    hypothesis: str
    horizon: str = "medium"
    periodFrom: date
    periodTo: date
    rebalance: str = "monthly"
    topN: int = 20
    minMedianTurnover: float = 500000
    modelVersion: str = "fox-0.1.0"


@router.post("/backtest/run")
async def backtest_run(body: BacktestRequest) -> dict[str, Any]:
    from decimal import Decimal

    cfg = BacktestConfig(
        name=body.name,
        hypothesis=body.hypothesis,
        horizon=body.horizon,
        period_from=body.periodFrom,
        period_to=body.periodTo,
        rebalance=body.rebalance,
        top_n=body.topN,
        min_median_turnover=Decimal(str(body.minMedianTurnover)),
        model_version=body.modelVersion,
    )
    outcome = run_backtest(cfg)
    return {
        "runId": outcome.run_id,
        "status": outcome.status,
        "blockedReason": outcome.blocked_reason,
        "guardResults": outcome.guard_report.to_dict(),
        "interpretation": outcome.interpretation,
        "rankIc": outcome.rank_ic,
        "benchmarks": outcome.benchmarks,
        "limitations": outcome.limitations,
    }


@router.get("/backtest/runs/{run_id}")
async def backtest_get(run_id: str) -> dict[str, Any]:
    result = backtest_report.build(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Run not found."})
    return result


# --------------------------------------------------------------------------
# shariah, documents, models
# --------------------------------------------------------------------------


class ShariahRequest(BaseModel):
    methodology: str = "aaoifi_style"
    issuerIds: list[str] | None = None


@router.post("/shariah/screen")
async def shariah_screen(body: ShariahRequest) -> dict[str, Any]:
    from ..pipelines import shariah_pipeline

    return shariah_pipeline.screen_all(body.methodology, body.issuerIds)


class DocumentRequest(BaseModel):
    documentId: str


@router.post("/documents/extract")
async def documents_extract(body: DocumentRequest) -> dict[str, Any]:
    from ..pipelines import document_pipeline

    return document_pipeline.extract_and_store(body.documentId)


@router.get("/models")
async def models() -> list[dict[str, Any]]:
    return fetch_all(
        """
        select family, version, state, is_active, promoted_at, config_hash
          from model_versions order by family, created_at desc
        """
    )


# --------------------------------------------------------------------------


def _d(row: dict[str, Any] | None, key: str):
    from decimal import Decimal

    if not row or row.get(key) is None:
        return None
    return Decimal(str(row[key]))


def _s(value: Any) -> str | None:
    return None if value is None else str(value)
