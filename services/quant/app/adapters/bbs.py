"""Bangladesh Bureau of Statistics adapter.

Like Bangladesh Bank, BBS publishes files rather than an API. Provisional /
final / revised status and the base year matter enormously — a rebased index
spliced onto an old one produces a fake trend, so this adapter records the
metadata and refuses to splice.

⚠ Never validated against a live response — run `/ingest/bbs/verify` first.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db import connection
from ..errors import ParseError
from . import html as H
from .base import BaseAdapter, DatasetInfo, HealthReport, ParseResult, RawPayload, Window

SERIES = {
    "gdp_annual": "GDP (annual)",
    "gdp_quarterly": "Quarterly GDP",
    "cpi": "Consumer Price Index",
    "wage_rate_index": "Wage Rate Index",
    "ppi": "Producer Price Index",
    "iip": "Index of Industrial Production",
}


class BbsAdapter(BaseAdapter):
    source_id = "bbs"
    parser_version = "1.0.0"
    description = "BBS statistics — GDP, CPI, wages, PPI, industrial production."
    freshness_budget_minutes = 45 * 24 * 60

    async def health_check(self) -> HealthReport:
        try:
            payload = await self.request(f"{settings().bbs_base_url}/", persist_snapshot=False)
            return HealthReport(reachable=True, http_status=payload.http_status)
        except Exception as exc:
            return HealthReport(reachable=False, http_status=None, detail=str(exc))

    async def discover(self) -> list[DatasetInfo]:
        return [DatasetInfo(key=k, description=v, granularity="periodic") for k, v in SERIES.items()]

    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]:
        return [
            await self.request(
                f"{settings().bbs_base_url}/site/page/29b379ff-7bac-41d9-b321-e41929bab4a1",
                persist_snapshot=persist_snapshot,
                ingestion_run_id=window.extra.get("run_id"),
            )
        ]

    def parse(self, raw: RawPayload) -> ParseResult:
        document = H.soup(raw.body)
        result = ParseResult(columns_detected=["label", "url", "file_type"])
        for a in document.find_all("a", href=True):
            href = a["href"].lower()
            if not any(href.endswith(ext) for ext in (".pdf", ".xls", ".xlsx", ".csv")):
                continue
            label = H.clean_text(a.get_text())
            if not label:
                continue
            result.rows.append(
                {
                    "label": label,
                    "url": a["href"] if a["href"].startswith("http") else f"{settings().bbs_base_url}{a['href']}",
                    "file_type": href.rsplit(".", 1)[-1],
                }
            )
        if not result.rows:
            raise ParseError("No BBS publication files found. Inspect the saved snapshot.")
        result.warnings.append(
            "Discovery only. Record base year and provisional/final status before extracting figures."
        )
        return result

    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        now = datetime.now(timezone.utc)
        payload = [
            {
                "id": str(uuid.uuid4()),
                "source_id_ref": self.source_id,
                "document_type": "statistics_publication",
                "title": r["label"],
                "url": r["url"],
                "rights_status": "metadata_only",
                "source_id": self.source_id,
                "snapshot_id": raw.snapshot_id,
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
                    insert into documents
                      (id, source_id_ref, document_type, title, url, rights_status,
                       source_id, snapshot_id, retrieved_at, parser_version, quality)
                    values
                      (:id, :source_id_ref, :document_type, :title, :url, :rights_status,
                       :source_id, :snapshot_id, :retrieved_at, :parser_version, 'ok')
                    """
                ),
                payload,
            )
        return len(payload)
