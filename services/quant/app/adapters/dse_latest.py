"""DSE latest-share-price adapter.

The public "latest share price" page. This is a DELAYED snapshot, not a
real-time feed, and it is labelled as such everywhere it surfaces. Anything that
needs true real-time (Level 1/2, intraday trades) requires a licensed feed that
BABull does not have.

⚠ Never validated against a live response — run `/ingest/dse_latest/verify` first.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db import connection
from ..errors import ParseError
from . import html as H
from .base import BaseAdapter, DatasetInfo, HealthReport, ParseResult, RawPayload, Rejection, Window
from .dse_eod import TURNOVER_MULTIPLIER, _resolve_instruments

COLUMN_SYNONYMS: dict[str, list[str]] = {
    "ticker": ["trading code", "trade code", "symbol", "scrip"],
    "ltp": ["ltp", "last trade price", "last traded price"],
    "high": ["high"],
    "low": ["low"],
    "close": ["closep", "close", "close price"],
    "ycp": ["ycp", "yesterday closing price", "previous close"],
    "change": ["change", "change %", "% change"],
    "trade_count": ["trade", "trades", "no of trade"],
    "turnover": ["value (mn)", "value mn", "value", "turnover"],
    "volume": ["volume", "total volume", "share traded"],
}


class DseLatestAdapter(BaseAdapter):
    source_id = "dse_latest"
    parser_version = "1.0.0"
    description = "DSE latest share price page — delayed intraday snapshot."
    freshness_budget_minutes = 30

    async def health_check(self) -> HealthReport:
        url = f"{settings().dse_base_url}/latest_share_price_scroll_l.php"
        try:
            payload = await self.request(url, persist_snapshot=False)
            return HealthReport(reachable=True, http_status=payload.http_status)
        except Exception as exc:
            return HealthReport(reachable=False, http_status=None, detail=str(exc))

    async def discover(self) -> list[DatasetInfo]:
        return [DatasetInfo(key="latest_share_price", description="Delayed last prices", granularity="intraday")]

    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]:
        url = f"{settings().dse_base_url}/latest_share_price_scroll_l.php"
        return [
            await self.request(
                url,
                persist_snapshot=persist_snapshot,
                ingestion_run_id=window.extra.get("run_id"),
            )
        ]

    def parse(self, raw: RawPayload) -> ParseResult:
        document = H.soup(raw.body)
        table = H.find_data_table(document, ["trading code", "ltp"])
        headers, body = H.table_rows(table)
        mapping, unmapped = H.map_columns(headers, COLUMN_SYNONYMS)

        result = ParseResult(
            columns_detected=[h.strip() for h in headers if h.strip()],
            columns_mapped={f: headers[i].strip() for f, i in mapping.items()},
            columns_unmapped=unmapped,
        )
        if "ticker" not in mapping:
            raise ParseError("No ticker column on the latest-price page.", headers_seen=result.columns_detected)

        session_date = date.today()
        for cells_raw in body:
            cells = H.row_to_dict(cells_raw, mapping)
            ticker = H.clean_text(cells.get("ticker"))
            if not ticker:
                result.rejections.append(Rejection(reason="no_ticker", raw=cells_raw))
                continue
            try:
                turnover = H.clean_number(cells.get("turnover"))
                row = {
                    "ticker": ticker.upper(),
                    "session_date": session_date,
                    "ltp": H.clean_number(cells.get("ltp")),
                    "high": H.clean_number(cells.get("high")),
                    "low": H.clean_number(cells.get("low")),
                    "close": H.clean_number(cells.get("close")),
                    "ycp": H.clean_number(cells.get("ycp")),
                    "volume": H.clean_number(cells.get("volume")),
                    "turnover": None if turnover is None else turnover * TURNOVER_MULTIPLIER,
                }
            except ParseError as exc:
                result.rejections.append(Rejection(reason=str(exc), raw=cells_raw))
                continue
            result.rows.append(row)
        return result

    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        if not result.rows:
            return 0
        ids = _resolve_instruments(sorted({r["ticker"] for r in result.rows}))
        now = datetime.now(timezone.utc)
        payload = [
            {
                "id": str(uuid.uuid4()),
                "instrument_id": ids[r["ticker"]],
                "session_date": r["session_date"],
                "open": None,
                "high": r["high"],
                "low": r["low"],
                "close": r["close"] if r["close"] is not None else r["ltp"],
                "ltp": r["ltp"],
                "ycp": r["ycp"],
                "volume": r["volume"],
                "turnover": r["turnover"],
                "trade_count": None,
                "source_id": self.source_id,
                "snapshot_id": raw.snapshot_id,
                "published_at": now,
                "effective_at": now,
                "retrieved_at": raw.retrieved_at or now,
                "parser_version": self.parser_version,
            }
            for r in result.rows
            if r["ticker"] in ids
        ]
        if not payload:
            return 0
        with connection() as conn:
            conn.execute(
                text(
                    """
                    insert into market_bars
                      (id, instrument_id, session_date, open, high, low, close, ltp, ycp,
                       volume, turnover, trade_count, adjustment_basis, source_id, snapshot_id,
                       published_at, effective_at, retrieved_at, parser_version, quality, version)
                    values
                      (:id, :instrument_id, :session_date, :open, :high, :low, :close, :ltp, :ycp,
                       :volume, :turnover, :trade_count, 'raw', :source_id, :snapshot_id,
                       :published_at, :effective_at, :retrieved_at, :parser_version, 'ok', 1)
                    on conflict (instrument_id, session_date, adjustment_basis, source_id, version)
                    do update set
                       high = excluded.high, low = excluded.low, close = excluded.close,
                       ltp = excluded.ltp, ycp = excluded.ycp, volume = excluded.volume,
                       turnover = excluded.turnover, retrieved_at = excluded.retrieved_at
                    """
                ),
                payload,
            )
        return len(payload)
