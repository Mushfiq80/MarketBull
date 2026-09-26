"""DSE instrument master + company detail adapter.

Everything joins to the instrument master, so this is the first adapter to run.
It produces issuers, instruments and (where the company page exposes them)
shareholding percentages.

⚠ Never validated against a live response — run `/ingest/dse_company/verify` first.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db import connection, fetch_all
from ..errors import ParseError
from . import html as H
from .base import BaseAdapter, DatasetInfo, HealthReport, ParseResult, RawPayload, Rejection, Window

_TICKER_RE = re.compile(r"name=([A-Z0-9]+)", re.IGNORECASE)


class DseCompanyAdapter(BaseAdapter):
    source_id = "dse_company"
    parser_version = "1.0.0"
    description = "DSE company listing — instrument master, sector, shareholding."
    freshness_budget_minutes = 7 * 24 * 60

    async def health_check(self) -> HealthReport:
        url = f"{settings().dse_base_url}/company_listing.php"
        try:
            payload = await self.request(url, persist_snapshot=False)
            return HealthReport(reachable=True, http_status=payload.http_status)
        except Exception as exc:
            return HealthReport(reachable=False, http_status=None, detail=str(exc))

    async def discover(self) -> list[DatasetInfo]:
        return [DatasetInfo(key="company_listing", description="Listed instruments", granularity="static")]

    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]:
        base = settings().dse_base_url
        # The by-industry listing carries the sector grouping, which the plain
        # listing does not — sector is needed for peer groups and scorecards.
        return [
            await self.request(
                f"{base}/companylistbyindustry.php",
                persist_snapshot=persist_snapshot,
                ingestion_run_id=window.extra.get("run_id"),
            )
        ]

    def parse(self, raw: RawPayload) -> ParseResult:
        document = H.soup(raw.body)
        result = ParseResult()

        # The page groups companies under sector headings. Rather than assume a
        # table shape, walk anchors to displayCompany.php and attribute each to
        # the nearest preceding heading.
        anchors = document.find_all("a", href=True)
        current_sector: str | None = None
        seen: set[str] = set()

        headings = {h for h in document.find_all(["h1", "h2", "h3", "h4", "strong", "th"])}
        ordered: list[Any] = [el for el in document.descendants if el in headings or (getattr(el, "name", None) == "a" and el.get("href"))]

        for el in ordered:
            name = getattr(el, "name", None)
            if name != "a":
                label = H.clean_text(el.get_text())
                if label and 2 < len(label) < 60 and "displayCompany" not in label:
                    current_sector = label.upper()
                continue

            href = el.get("href", "")
            if "displaycompany.php" not in href.lower():
                continue
            match = _TICKER_RE.search(href)
            if not match:
                continue
            ticker = match.group(1).upper()
            if ticker in seen:
                continue
            seen.add(ticker)
            label = H.clean_text(el.get_text()) or ticker
            result.rows.append({"ticker": ticker, "name": label, "sector": current_sector})

        result.columns_detected = ["ticker", "name", "sector(from heading)"]
        result.columns_mapped = {"ticker": "href name=", "name": "anchor text", "sector": "preceding heading"}

        if not result.rows:
            raise ParseError(
                "No company links found on the listing page. The page structure has changed — "
                "inspect the saved snapshot.",
            )
        missing_sector = sum(1 for r in result.rows if not r["sector"])
        if missing_sector:
            result.warnings.append(
                f"{missing_sector} instruments had no sector heading above them; stored as null."
            )
        return result

    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        if not result.rows:
            return 0
        now = datetime.now(timezone.utc)
        existing = {
            r["ticker"]: r["issuer_id"]
            for r in fetch_all(
                "select ticker, issuer_id::text as issuer_id from instruments where is_current = true"
            )
        }

        written = 0
        with connection() as conn:
            for row in result.rows:
                ticker = row["ticker"]
                issuer_id = existing.get(ticker)

                if issuer_id is None:
                    issuer_id = str(uuid.uuid4())
                    conn.execute(
                        text(
                            """
                            insert into issuers
                              (id, name, sector_code, source_id, snapshot_id, retrieved_at,
                               parser_version, quality, version)
                            values
                              (:id, :name, :sector, :source_id, :snapshot_id, :retrieved_at,
                               :parser_version, 'ok', 1)
                            """
                        ),
                        {
                            "id": issuer_id,
                            "name": row["name"],
                            "sector": row["sector"],
                            "source_id": self.source_id,
                            "snapshot_id": raw.snapshot_id,
                            "retrieved_at": now,
                            "parser_version": self.parser_version,
                        },
                    )
                    conn.execute(
                        text(
                            """
                            insert into instruments
                              (id, issuer_id, ticker, exchange, instrument_type, listing_status,
                               currency, source_id, snapshot_id, retrieved_at, parser_version,
                               quality, version, valid_from, is_current)
                            values
                              (:id, :issuer_id, :ticker, 'DSE', 'equity', 'listed',
                               'BDT', :source_id, :snapshot_id, :retrieved_at, :parser_version,
                               'ok', 1, :valid_from, true)
                            """
                        ),
                        {
                            "id": str(uuid.uuid4()),
                            "issuer_id": issuer_id,
                            "ticker": ticker,
                            "source_id": self.source_id,
                            "snapshot_id": raw.snapshot_id,
                            "retrieved_at": now,
                            "parser_version": self.parser_version,
                            "valid_from": now,
                        },
                    )
                    written += 1
                else:
                    # Update the name/sector in place only — identity is stable.
                    conn.execute(
                        text(
                            """
                            update issuers
                               set name = :name,
                                   sector_code = coalesce(:sector, sector_code),
                                   retrieved_at = :retrieved_at
                             where id = :id
                            """
                        ),
                        {"id": issuer_id, "name": row["name"], "sector": row["sector"], "retrieved_at": now},
                    )
                    written += 1
        return written
