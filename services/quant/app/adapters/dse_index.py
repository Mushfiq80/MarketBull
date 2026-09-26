"""DSE index adapter — DSEX / DS30 / DSES.

DSEX anchors the regime engine; DS30 and DSES are supplementary checks.

⚠ Never validated against a live response — run `/ingest/dse_index/verify` first.
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

INDEX_SYNONYMS: dict[str, list[str]] = {
    "symbol": ["index", "index name", "name"],
    "close": ["index value", "value", "close", "closing"],
    "change": ["change", "change point", "+/-"],
    "session_date": ["date", "as on", "trading date"],
}

KNOWN_INDICES = {"DSEX", "DS30", "DSES", "DSEX INDEX", "DS30 INDEX", "DSES INDEX"}


class DseIndexAdapter(BaseAdapter):
    source_id = "dse_index"
    parser_version = "1.0.0"
    description = "DSE market indices — DSEX, DS30, DSES."
    freshness_budget_minutes = 20 * 60

    async def health_check(self) -> HealthReport:
        try:
            payload = await self.request(f"{settings().dse_base_url}/", persist_snapshot=False)
            return HealthReport(reachable=True, http_status=payload.http_status)
        except Exception as exc:
            return HealthReport(reachable=False, http_status=None, detail=str(exc))

    async def discover(self) -> list[DatasetInfo]:
        return [DatasetInfo(key="indices", description="DSEX/DS30/DSES levels", granularity="daily")]

    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]:
        return [
            await self.request(
                f"{settings().dse_base_url}/",
                persist_snapshot=persist_snapshot,
                ingestion_run_id=window.extra.get("run_id"),
            )
        ]

    def parse(self, raw: RawPayload) -> ParseResult:
        document = H.soup(raw.body)
        result = ParseResult()

        # Index values appear in a small summary table on the landing page.
        for table in document.find_all("table"):
            text_blob = H.normalize_header(table.get_text())
            if "dsex" not in text_blob:
                continue
            try:
                headers, body = H.table_rows(table)
            except ParseError:
                continue
            mapping, unmapped = H.map_columns(headers, INDEX_SYNONYMS)
            result.columns_detected = [h.strip() for h in headers if h.strip()]
            result.columns_mapped = {f: headers[i].strip() for f, i in mapping.items()}
            result.columns_unmapped = unmapped

            for cells_raw in body:
                cells = H.row_to_dict(cells_raw, mapping)
                symbol = (H.clean_text(cells.get("symbol")) or "").upper()
                if symbol not in KNOWN_INDICES:
                    continue
                symbol = symbol.replace(" INDEX", "")
                try:
                    close = H.clean_number(cells.get("close"))
                except ParseError as exc:
                    result.rejections.append(Rejection(reason=str(exc), raw=cells_raw))
                    continue
                if close is None:
                    result.rejections.append(Rejection(reason="no_index_value", raw=cells_raw))
                    continue
                result.rows.append(
                    {"symbol": symbol, "session_date": date.today(), "close": close}
                )
            if result.rows:
                break

        if not result.rows:
            raise ParseError(
                "Could not locate index values on the DSE landing page. "
                "Inspect the saved snapshot and update the locator.",
            )
        return result

    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        now = datetime.now(timezone.utc)
        payload = [
            {
                "id": str(uuid.uuid4()),
                "symbol": r["symbol"],
                "session_date": r["session_date"],
                "close": r["close"],
                "source_id": self.source_id,
                "snapshot_id": raw.snapshot_id,
                "published_at": now,
                "effective_at": now,
                "retrieved_at": raw.retrieved_at or now,
                "parser_version": self.parser_version,
            }
            for r in result.rows
        ]
        if not payload:
            return 0
        with connection() as conn:
            conn.execute(
                text(
                    """
                    insert into index_observations
                      (id, symbol, session_date, close, source_id, snapshot_id,
                       published_at, effective_at, retrieved_at, parser_version, quality, version)
                    values
                      (:id, :symbol, :session_date, :close, :source_id, :snapshot_id,
                       :published_at, :effective_at, :retrieved_at, :parser_version, 'ok', 1)
                    on conflict (symbol, session_date, source_id, version)
                    do update set close = excluded.close, retrieved_at = excluded.retrieved_at
                    """
                ),
                payload,
            )
        return len(payload)
