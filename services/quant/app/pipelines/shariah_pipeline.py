"""Shariah screening pipeline."""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from ..config import load_model_config
from ..db import connection, fetch_all
from ..engines import shariah


def screen_all(methodology: str, issuer_ids: list[str] | None = None) -> dict[str, Any]:
    cfg = load_model_config("shariah")
    sql = """
        select iss.id::text as issuer_id, iss.name, iss.sector_code, iss.business_description,
               i.id::text as instrument_id, i.shares_outstanding,
               (select close from market_bars b
                 where b.instrument_id = i.id and b.adjustment_basis = 'raw'
                 order by session_date desc limit 1) as last_close
          from issuers iss
          join instruments i on i.issuer_id = iss.id and i.is_current = true
    """
    params: dict[str, Any] = {}
    if issuer_ids:
        sql += " where iss.id = any(cast(:ids as uuid[]))"
        params["ids"] = issuer_ids
    issuers = fetch_all(sql, **params)

    counts = {"pass": 0, "fail": 0, "undetermined": 0}
    rows: list[dict[str, Any]] = []
    today = date.today()

    for issuer in issuers:
        financials = _financials(issuer["issuer_id"])
        market_cap = None
        if issuer.get("last_close") and issuer.get("shares_outstanding"):
            market_cap = Decimal(str(issuer["last_close"])) * Decimal(str(issuer["shares_outstanding"]))

        result = shariah.screen(
            issuer=issuer,
            financials=financials,
            market_cap=market_cap,
            methodology=methodology,
            data_date=today,
            config=cfg,
        )
        counts[result.status] += 1
        rows.append(
            {
                "id": str(uuid.uuid4()),
                "issuer_id": issuer["issuer_id"],
                "methodology": result.methodology,
                "methodology_version": result.methodology_version,
                "status": result.status,
                "business": json.dumps([o.to_dict() for o in result.business_activity]),
                "ratios": json.dumps([o.to_dict() for o in result.financial_ratios]),
                "undetermined": json.dumps(result.undetermined_reasons),
                "data_date": today,
                "as_of": datetime.now(timezone.utc),
            }
        )

    if rows:
        with connection() as conn:
            conn.execute(
                text(
                    """
                    insert into shariah_screens
                      (id, issuer_id, methodology, methodology_version, status,
                       business_activity_results, financial_ratio_results, undetermined_reasons,
                       data_date, as_of)
                    values
                      (:id, :issuer_id, :methodology, :methodology_version,
                       cast(:status as shariah_status), cast(:business as jsonb),
                       cast(:ratios as jsonb), cast(:undetermined as jsonb), :data_date, :as_of)
                    on conflict (issuer_id, methodology, methodology_version, data_date)
                    do update set status = excluded.status,
                                  business_activity_results = excluded.business_activity_results,
                                  financial_ratio_results = excluded.financial_ratio_results,
                                  undetermined_reasons = excluded.undetermined_reasons
                    """
                ),
                rows,
            )

    return {
        "screened": len(rows),
        "methodology": methodology,
        "disclaimer": cfg["disclaimer"].strip(),
        **counts,
    }


def _financials(issuer_id: str) -> dict[str, Decimal | None]:
    rows = fetch_all(
        """
        select distinct on (metric) metric, value
          from financial_facts
         where issuer_id = cast(:iid as uuid) and superseded_at is null
         order by metric, period_end desc, version desc
        """,
        iid=issuer_id,
    )
    return {str(r["metric"]): (Decimal(str(r["value"])) if r["value"] is not None else None) for r in rows}
