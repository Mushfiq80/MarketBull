"""DSE day-end archive adapter — historical OHLCV.

Source: the public day-end archive page on dse.com.bd. This is an HTML page,
not a documented API, which drives every defensive choice below.

⚠ NEVER VALIDATED AGAINST A LIVE RESPONSE. The machine this was written on had
no route to dse.com.bd. Run ``POST /ingest/dse_eod/verify`` from a machine that
does, read the report, and fix the synonyms/units before ingesting. The parser
is written to fail loudly rather than write something plausible-looking.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db import connection, fetch_all
from ..errors import ParseError
from ..logging import get_logger, log
from . import html as H
from .base import (
    BaseAdapter,
    DatasetInfo,
    HealthReport,
    ParseResult,
    RawPayload,
    Rejection,
    Window,
)

logger = get_logger(__name__)

#: Turnover on DSE pages is published in millions of BDT.
TURNOVER_MULTIPLIER = Decimal("1000000")

#: Canonical field -> the header texts that have been seen to mean it.
#: Add to these lists when `verify` reports an unmapped column. Do NOT switch
#: to positional indexing — that is how bad data gets written silently.
COLUMN_SYNONYMS: dict[str, list[str]] = {
    "session_date": ["date", "trading date", "session date"],
    "ticker": ["trading code", "trade code", "symbol", "instrument", "scrip"],
    "ltp": ["ltp", "last trade price", "last traded price", "ltp (tk)"],
    "high": ["high", "high price", "day high"],
    "low": ["low", "low price", "day low"],
    "open": ["openp", "open", "open price", "opening price"],
    "close": ["closep", "close", "close price", "closing price"],
    "ycp": ["ycp", "yesterday closing price", "yesterday's closing price", "previous close"],
    "trade_count": ["trade", "trades", "no of trade", "no. of trades", "total trade"],
    "turnover": ["value (mn)", "value mn", "value(mn)", "value", "turnover (mn)", "turnover"],
    "volume": ["volume", "total volume", "qty", "quantity", "share traded"],
}

REQUIRED_HEADERS = ["trading code", "closep"]
REQUIRED_FIELDS = {"ticker", "close"}


class DseEodAdapter(BaseAdapter):
    source_id = "dse_eod"
    parser_version = "1.0.0"
    description = "DSE day-end archive — historical daily OHLCV, turnover and volume."
    freshness_budget_minutes = 20 * 60  # one trading day plus slack

    # --- port -------------------------------------------------------------

    async def health_check(self) -> HealthReport:
        url = f"{settings().dse_base_url}/day_end_archive.php"
        try:
            payload = await self.request(url, persist_snapshot=False)
            return HealthReport(reachable=True, http_status=payload.http_status)
        except Exception as exc:
            return HealthReport(reachable=False, http_status=None, detail=str(exc))

    async def discover(self) -> list[DatasetInfo]:
        return [
            DatasetInfo(
                key="day_end_archive",
                description="Daily OHLCV per instrument",
                granularity="daily",
                history_start=None,  # unverified — do not claim a start date
            )
        ]

    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]:
        """Fetch the archive for a date range.

        The archive page is chunked by month to keep each response small and to
        make a partial failure recoverable — a 5-year backfill that dies at year
        three should not lose years one and two.
        """
        base = settings().dse_base_url
        url = f"{base}/day_end_archive.php"

        end = window.end or date.today()
        start = window.start or (end - timedelta(days=30))

        payloads: list[RawPayload] = []
        for chunk_start, chunk_end in _month_chunks(start, end):
            form = {
                "startDate": chunk_start.isoformat(),
                "endDate": chunk_end.isoformat(),
                "inst": window.extra.get("ticker", "All Instrument"),
                "archive": "data",
            }
            payload = await self.request(
                url,
                method="POST",
                data=form,
                persist_snapshot=persist_snapshot,
                ingestion_run_id=window.extra.get("run_id"),
            )
            payloads.append(payload)
            # verify() only needs the first chunk
            if not persist_snapshot:
                break
        return payloads

    def parse(self, raw: RawPayload) -> ParseResult:
        document = H.soup(raw.body)
        table = H.find_data_table(document, REQUIRED_HEADERS)
        headers, body = H.table_rows(table)
        mapping, unmapped = H.map_columns(headers, COLUMN_SYNONYMS)

        result = ParseResult(
            columns_detected=[h.strip() for h in headers if h.strip()],
            columns_mapped={field: headers[idx].strip() for field, idx in mapping.items()},
            columns_unmapped=unmapped,
        )

        missing = REQUIRED_FIELDS - set(mapping)
        if missing:
            raise ParseError(
                "Required columns are missing from the DSE archive table. "
                "Add the real header text to COLUMN_SYNONYMS in dse_eod.py — "
                "do not switch to positional indexing.",
                missing_fields=sorted(missing),
                headers_seen=result.columns_detected,
            )

        # The archive omits the date column when a single instrument is queried,
        # so fall back to the requested window only when it is unambiguous.
        fallback_date = _single_date_from_params(raw.params)
        if "session_date" not in mapping and fallback_date is None:
            raise ParseError(
                "No date column found and the request window spans more than one day, "
                "so rows cannot be dated. Refusing to guess.",
                headers_seen=result.columns_detected,
            )

        for row_cells in body:
            cells = H.row_to_dict(row_cells, mapping)
            try:
                parsed = self._normalize_row(cells, fallback_date)
            except ParseError as exc:
                result.rejections.append(Rejection(reason=str(exc), raw=row_cells))
                continue
            if parsed is None:
                result.rejections.append(Rejection(reason="no_ticker", raw=row_cells))
                continue
            result.rows.append(parsed)

        if not result.rows and body:
            result.warnings.append(
                "The table was found but every row was rejected — check rejectionReasons."
            )
        return result

    def _normalize_row(
        self, cells: dict[str, Any], fallback_date: date | None
    ) -> dict[str, Any] | None:
        ticker = H.clean_text(cells.get("ticker"))
        if not ticker or ticker.lower() in {"total", "grand total"}:
            return None

        session_date = fallback_date
        if cells.get("session_date"):
            session_date = _parse_date(H.clean_text(cells["session_date"]))
        if session_date is None:
            raise ParseError("row_has_no_date")

        turnover = H.clean_number(cells.get("turnover"))
        if turnover is not None:
            turnover = turnover * TURNOVER_MULTIPLIER

        close = H.clean_number(cells.get("close"))
        ltp = H.clean_number(cells.get("ltp"))
        # DSE publishes both; close is authoritative for a session, ltp for intraday.
        if close is None and ltp is None:
            raise ParseError("no_price_on_row")

        trade_count = H.clean_number(cells.get("trade_count"))

        return {
            "ticker": ticker.upper(),
            "session_date": session_date,
            "open": H.clean_number(cells.get("open")),
            "high": H.clean_number(cells.get("high")),
            "low": H.clean_number(cells.get("low")),
            "close": close if close is not None else ltp,
            "ltp": ltp,
            "ycp": H.clean_number(cells.get("ycp")),
            "volume": H.clean_number(cells.get("volume")),
            "turnover": turnover,
            "trade_count": int(trade_count) if trade_count is not None else None,
        }

    # --- persistence ------------------------------------------------------

    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        if not result.rows:
            return 0

        tickers = sorted({r["ticker"] for r in result.rows})
        instrument_ids = _resolve_instruments(tickers)

        unknown = [t for t in tickers if t not in instrument_ids]
        if unknown:
            self.raise_quality_issue(
                kind="identity_ambiguity",
                severity="medium",
                summary=f"{len(unknown)} tickers in the archive are not in the instrument master.",
                detail={"tickers": unknown[:50]},
                run_id=run_id,
            )

        payload: list[dict[str, Any]] = []
        now = datetime.now(timezone.utc)
        for row in result.rows:
            iid = instrument_ids.get(row["ticker"])
            if iid is None:
                continue
            # Published time for an end-of-day bar is the session close, not now.
            published = datetime.combine(row["session_date"], time(hour=14, minute=30), tzinfo=timezone.utc)
            payload.append(
                {
                    "id": str(uuid.uuid4()),
                    "instrument_id": iid,
                    "session_date": row["session_date"],
                    "open": row["open"],
                    "high": row["high"],
                    "low": row["low"],
                    "close": row["close"],
                    "ltp": row["ltp"],
                    "ycp": row["ycp"],
                    "volume": row["volume"],
                    "turnover": row["turnover"],
                    "trade_count": row["trade_count"],
                    "source_id": self.source_id,
                    "snapshot_id": raw.snapshot_id,
                    "published_at": published,
                    "effective_at": published,
                    "retrieved_at": raw.retrieved_at or now,
                    "parser_version": self.parser_version,
                    "limit_bound": _is_limit_bound(row),
                }
            )

        if not payload:
            return 0

        with connection() as conn:
            conn.execute(
                text(
                    """
                    insert into market_bars
                      (id, instrument_id, session_date, open, high, low, close, ltp, ycp,
                       volume, turnover, trade_count, adjustment_basis,
                       source_id, snapshot_id, published_at, effective_at, retrieved_at,
                       parser_version, quality, version, limit_bound)
                    values
                      (:id, :instrument_id, :session_date, :open, :high, :low, :close, :ltp, :ycp,
                       :volume, :turnover, :trade_count, 'raw',
                       :source_id, :snapshot_id, :published_at, :effective_at, :retrieved_at,
                       :parser_version, 'ok', 1, :limit_bound)
                    on conflict (instrument_id, session_date, adjustment_basis, source_id, version)
                    do update set
                       open = excluded.open,
                       high = excluded.high,
                       low = excluded.low,
                       close = excluded.close,
                       ltp = excluded.ltp,
                       ycp = excluded.ycp,
                       volume = excluded.volume,
                       turnover = excluded.turnover,
                       trade_count = excluded.trade_count,
                       snapshot_id = excluded.snapshot_id,
                       retrieved_at = excluded.retrieved_at,
                       parser_version = excluded.parser_version
                    """
                ),
                payload,
            )

        log(
            logger,
            "info",
            "persisted market bars",
            adapter=self.source_id,
            rows=len(payload),
            run_id=run_id,
        )
        return len(payload)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _month_chunks(start: date, end: date) -> list[tuple[date, date]]:
    chunks: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        if cursor.month == 12:
            month_end = date(cursor.year, 12, 31)
        else:
            month_end = date(cursor.year, cursor.month + 1, 1) - timedelta(days=1)
        chunks.append((cursor, min(month_end, end)))
        cursor = month_end + timedelta(days=1)
    return chunks


_DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%Y", "%d %b %Y", "%b %d, %Y")


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    raise ParseError(f"unrecognised_date_format:{value!r}")


def _single_date_from_params(params: dict[str, Any]) -> date | None:
    start = params.get("startDate")
    end = params.get("endDate")
    if start and end and start == end:
        try:
            return datetime.strptime(str(start), "%Y-%m-%d").date()
        except ValueError:
            return None
    return None


def _is_limit_bound(row: dict[str, Any]) -> bool:
    """Flag a session that closed at its circuit limit.

    DSE's limit bands vary by price level and have changed over time, so this is
    a conservative heuristic: high == low == close with non-zero volume, i.e. the
    stock traded all day at one price. Real limit detection needs the published
    band, which is a Phase 2 item — until then this only flags the obvious case.
    """
    high, low, close, volume = row.get("high"), row.get("low"), row.get("close"), row.get("volume")
    if None in (high, low, close) or not volume:
        return False
    return high == low == close and volume > 0


def _resolve_instruments(tickers: list[str]) -> dict[str, str]:
    """Map current tickers to instrument ids. Unknown tickers are simply absent."""
    if not tickers:
        return {}
    rows = fetch_all(
        """
        select ticker, id::text as id
          from instruments
         where is_current = true
           and ticker = any(:tickers)
        """,
        tickers=tickers,
    )
    return {r["ticker"]: r["id"] for r in rows}
