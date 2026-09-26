"""BSEC adapter — rules, circulars and enforcement actions.

The `status` distinction is the whole point of this adapter: an allegation, an
interim order, a final finding and a reversal are different things. Collapsing
them would let BABull describe an unproven claim as a finding, which it must
never do.

⚠ Never validated against a live response — run `/ingest/bsec/verify` first.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db import connection
from ..errors import ParseError
from . import html as H
from .base import BaseAdapter, DatasetInfo, HealthReport, ParseResult, RawPayload, Rejection, Window

#: Wording → status. Conservative by design: anything unrecognised becomes
#: `allegation`, the weakest status, rather than being promoted to a finding.
STATUS_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(final order|imposed|penalt|fined|convicted|found guilty)\b", re.I), "final_finding"),
    (re.compile(r"\b(interim order|stay order|temporar)\b", re.I), "interim_order"),
    (re.compile(r"\b(show cause|proceeding|hearing|enquiry|inquiry|investigation)\b", re.I), "proceeding"),
    (re.compile(r"\b(withdrawn|revoked|set aside|reversed|overturned)\b", re.I), "reversed"),
    (re.compile(r"\b(resolved|complied|settled|closed)\b", re.I), "resolved"),
]

SEVERITY_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(suspend|cancel|delist|criminal|prosecut)\b", re.I), "critical"),
    (re.compile(r"\b(penalt|fine|imposed)\b", re.I), "high"),
    (re.compile(r"\b(warning|caution|direct)\b", re.I), "medium"),
]


class BsecAdapter(BaseAdapter):
    source_id = "bsec"
    parser_version = "1.0.0"
    description = "BSEC enforcement actions, rules and circulars."
    freshness_budget_minutes = 24 * 60

    async def health_check(self) -> HealthReport:
        try:
            payload = await self.request(
                f"{settings().bsec_base_url}/enforcement-actions", persist_snapshot=False
            )
            return HealthReport(reachable=True, http_status=payload.http_status)
        except Exception as exc:
            return HealthReport(reachable=False, http_status=None, detail=str(exc))

    async def discover(self) -> list[DatasetInfo]:
        return [
            DatasetInfo(key="enforcement", description="Enforcement actions", granularity="event"),
            DatasetInfo(key="rules", description="Acts, rules and regulations", granularity="event"),
        ]

    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]:
        base = settings().bsec_base_url
        run_id = window.extra.get("run_id")
        payloads = [
            await self.request(f"{base}/enforcement-actions", persist_snapshot=persist_snapshot, ingestion_run_id=run_id)
        ]
        if persist_snapshot:
            payloads.append(
                await self.request(
                    f"{base}/act-rules-and-regulations", persist_snapshot=True, ingestion_run_id=run_id
                )
            )
        return payloads

    def parse(self, raw: RawPayload) -> ParseResult:
        document = H.soup(raw.body)
        result = ParseResult()

        rows: list[dict[str, Any]] = []
        for table in document.find_all("table"):
            try:
                headers, body = H.table_rows(table)
            except ParseError:
                continue
            mapping, unmapped = H.map_columns(
                headers,
                {
                    "title": ["title", "subject", "particulars", "description", "name"],
                    "issue_date": ["date", "issue date", "published", "order date"],
                    "order_number": ["order no", "order number", "ref", "reference", "memo no"],
                },
            )
            if "title" not in mapping:
                continue
            result.columns_detected = [h.strip() for h in headers if h.strip()]
            result.columns_mapped = {f: headers[i].strip() for f, i in mapping.items()}
            result.columns_unmapped = unmapped

            for cells_raw in body:
                cells = H.row_to_dict(cells_raw, mapping)
                title = H.clean_text(cells.get("title"))
                if not title:
                    result.rejections.append(Rejection(reason="no_title", raw=cells_raw))
                    continue
                rows.append(
                    {
                        "title": title,
                        "order_number": H.clean_text(cells.get("order_number")),
                        "issue_date": _loose_date(H.clean_text(cells.get("issue_date"))),
                        "status": _classify(STATUS_PATTERNS, title, default="allegation"),
                        "severity": _classify(SEVERITY_PATTERNS, title, default="medium"),
                        "url": _first_link(table, title),
                    }
                )
            if rows:
                break

        if not rows:
            # Fall back to list items — BSEC pages are not consistently tabular.
            for li in document.find_all(["li", "p"]):
                link = li.find("a", href=True)
                if not link:
                    continue
                title = H.clean_text(link.get_text())
                if not title or len(title) < 12:
                    continue
                rows.append(
                    {
                        "title": title,
                        "order_number": None,
                        "issue_date": None,
                        "status": _classify(STATUS_PATTERNS, title, default="allegation"),
                        "severity": _classify(SEVERITY_PATTERNS, title, default="medium"),
                        "url": link["href"],
                    }
                )
            if rows:
                result.warnings.append("Fell back to link extraction; no table matched.")

        if not rows:
            raise ParseError("No enforcement entries found. Inspect the saved snapshot.")

        result.rows = rows
        return result

    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        now = datetime.now(timezone.utc)
        payload = [
            {
                "id": str(uuid.uuid4()),
                "authority": "BSEC",
                "order_number": r["order_number"],
                "action_type": "enforcement",
                "status": r["status"],
                "severity": r["severity"],
                "subject": r["title"],
                "official_url": r["url"],
                "issue_date": r["issue_date"],
                "source_id": self.source_id,
                "snapshot_id": raw.snapshot_id,
                "published_at": now,
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
                    insert into regulatory_actions
                      (id, authority, order_number, action_type, status, severity, subject,
                       official_url, issue_date, source_id, snapshot_id, published_at,
                       retrieved_at, parser_version, quality)
                    values
                      (:id, :authority, :order_number, :action_type, cast(:status as regulatory_status),
                       cast(:severity as severity), :subject, :official_url, :issue_date,
                       :source_id, :snapshot_id, :published_at, :retrieved_at, :parser_version, 'ok')
                    """
                ),
                payload,
            )
        return len(payload)


def _classify(patterns: list[tuple[re.Pattern[str], str]], text_value: str, *, default: str) -> str:
    for pattern, label in patterns:
        if pattern.search(text_value):
            return label
    return default


def _loose_date(value: str | None):
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d %B %Y", "%d %b %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _first_link(table: Any, title: str) -> str | None:
    for a in table.find_all("a", href=True):
        if H.clean_text(a.get_text()) == title:
            return a["href"]
    return None
