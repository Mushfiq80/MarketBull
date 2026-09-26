"""Bangladesh Bank macro adapter.

BB publishes downloadable spreadsheets rather than an API. Revisions are common,
so a revised value becomes a NEW VINTAGE — the value used in a past model
snapshot is never overwritten.

⚠ Never validated against a live response — run `/ingest/bb_macro/verify` first.
"""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db import connection
from ..errors import ParseError
from . import html as H
from .base import BaseAdapter, DatasetInfo, HealthReport, ParseResult, RawPayload, Rejection, Window

#: Series registry. One adapter run per family keeps a schema change in one
#: publication from breaking every other series.
SERIES_REGISTRY: dict[str, dict[str, Any]] = {
    "policy_rate": {"label": "Policy (repo) rate", "unit": "percent", "frequency": "irregular"},
    "cpi_inflation": {"label": "CPI inflation (point-to-point)", "unit": "percent", "frequency": "monthly"},
    "broad_money_m2": {"label": "Broad money (M2)", "unit": "BDT_million", "frequency": "monthly"},
    "fx_reserves": {"label": "Gross foreign exchange reserves", "unit": "USD_million", "frequency": "monthly"},
    "usd_bdt": {"label": "USD/BDT exchange rate", "unit": "BDT", "frequency": "daily"},
    "remittance": {"label": "Workers' remittance", "unit": "USD_million", "frequency": "monthly"},
    "private_credit_growth": {"label": "Private sector credit growth", "unit": "percent", "frequency": "monthly"},
    "call_money_rate": {"label": "Weighted average call money rate", "unit": "percent", "frequency": "monthly"},
}


class BangladeshBankAdapter(BaseAdapter):
    source_id = "bb_macro"
    parser_version = "1.0.0"
    description = "Bangladesh Bank economic data — rates, money, FX, reserves, remittance."
    freshness_budget_minutes = 40 * 24 * 60  # monthly publication + slack

    async def health_check(self) -> HealthReport:
        try:
            payload = await self.request(
                f"{settings().bb_base_url}/en/index.php/econdata/index", persist_snapshot=False
            )
            return HealthReport(reachable=True, http_status=payload.http_status)
        except Exception as exc:
            return HealthReport(reachable=False, http_status=None, detail=str(exc))

    async def discover(self) -> list[DatasetInfo]:
        return [
            DatasetInfo(key=k, description=v["label"], granularity=v["frequency"])
            for k, v in SERIES_REGISTRY.items()
        ]

    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]:
        base = settings().bb_base_url
        run_id = window.extra.get("run_id")
        # Start from the econdata index; the concrete file links are discovered
        # from it rather than hard-coded, because BB moves files between releases.
        return [
            await self.request(
                f"{base}/en/index.php/econdata/index",
                persist_snapshot=persist_snapshot,
                ingestion_run_id=run_id,
            )
        ]

    def parse(self, raw: RawPayload) -> ParseResult:
        """Discover downloadable series files on the econdata index.

        This adapter deliberately stops at discovery in its first version: it
        records WHICH files exist and where, so the operator can confirm reuse
        terms per dataset before BABull starts parsing figures out of them.
        """
        document = H.soup(raw.body)
        result = ParseResult()

        for a in document.find_all("a", href=True):
            href = a["href"]
            lowered = href.lower()
            if not any(lowered.endswith(ext) for ext in (".xls", ".xlsx", ".csv", ".pdf")):
                continue
            label = H.clean_text(a.get_text()) or href.rsplit("/", 1)[-1]
            result.rows.append(
                {
                    "label": label,
                    "url": href if href.startswith("http") else f"{settings().bb_base_url}{href}",
                    "file_type": lowered.rsplit(".", 1)[-1],
                    "series_guess": _guess_series(label),
                }
            )

        result.columns_detected = ["label", "url", "file_type"]
        result.columns_mapped = {"label": "anchor text", "url": "href"}
        if not result.rows:
            raise ParseError(
                "No downloadable data files found on the Bangladesh Bank econdata index. "
                "Inspect the saved snapshot — the page may have moved."
            )
        result.warnings.append(
            "Discovery only: this run records which files exist. Confirm per-dataset reuse "
            "terms before enabling figure extraction."
        )
        return result

    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        """Record discovered files as documents, not as macro values."""
        now = datetime.now(timezone.utc)
        payload = [
            {
                "id": str(uuid.uuid4()),
                "source_id_ref": self.source_id,
                "document_type": "macro_publication",
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


def _guess_series(label: str) -> str | None:
    lowered = label.lower()
    for key, meta in SERIES_REGISTRY.items():
        tokens = meta["label"].lower().split()
        if any(tok in lowered for tok in tokens if len(tok) > 4):
            return key
    return None
