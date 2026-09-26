"""Adapter port.

Every source implements this interface so the domain model stays independent of
any single provider. A licensed feed can replace a scraper later by implementing
the same port — nothing in the engines changes.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any

import httpx
from sqlalchemy import text

from ..config import settings
from ..db import connection
from ..errors import SourceUnreachableError
from ..logging import get_logger, log
from ..storage import snapshots

logger = get_logger(__name__)


# --------------------------------------------------------------------------
# value objects
# --------------------------------------------------------------------------


@dataclass(slots=True)
class Window:
    start: date | None = None
    end: date | None = None
    cursor: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RawPayload:
    body: bytes
    content_type: str
    url: str
    method: str
    params: dict[str, Any]
    http_status: int
    snapshot_id: str | None = None
    storage_key: str | None = None
    retrieved_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass(slots=True)
class Rejection:
    reason: str
    raw: dict[str, Any] | list[str] | None = None


@dataclass(slots=True)
class ParseResult:
    rows: list[dict[str, Any]] = field(default_factory=list)
    rejections: list[Rejection] = field(default_factory=list)
    columns_detected: list[str] = field(default_factory=list)
    columns_mapped: dict[str, str] = field(default_factory=dict)
    columns_unmapped: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def rejection_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for r in self.rejections:
            counts[r.reason] = counts.get(r.reason, 0) + 1
        return counts


@dataclass(slots=True)
class ValidationReport:
    ok: bool
    issues: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class HealthReport:
    reachable: bool
    http_status: int | None
    detail: str | None = None
    latency_ms: int | None = None


@dataclass(slots=True)
class DatasetInfo:
    key: str
    description: str
    granularity: str
    history_start: str | None = None


# --------------------------------------------------------------------------
# base adapter
# --------------------------------------------------------------------------


class BaseAdapter(ABC):
    """Base class for every source adapter.

    Subclasses MUST:
      * set ``source_id`` and ``parser_version``
      * match columns by header text, never by position
      * raise rather than guess when a value cannot be parsed
      * leave rejections as data (with a reason), never silently drop rows
    """

    source_id: str = "unset"
    parser_version: str = "0.0.0"
    #: Human description used in the data-quality console.
    description: str = ""
    #: Default freshness budget in minutes; beyond this, values render as stale.
    freshness_budget_minutes: int = 24 * 60

    def __init__(self) -> None:
        self._last_request_at: float = 0.0

    # --- transport --------------------------------------------------------

    def _client(self) -> httpx.AsyncClient:
        s = settings()
        return httpx.AsyncClient(
            timeout=s.ingest_timeout_seconds,
            follow_redirects=True,
            headers={
                "User-Agent": s.ingest_user_agent,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )

    async def throttle(self) -> None:
        """Be a good citizen against public pages."""
        delay = settings().ingest_request_delay_ms / 1000
        elapsed = time.monotonic() - self._last_request_at
        if elapsed < delay:
            await asyncio.sleep(delay - elapsed)
        self._last_request_at = time.monotonic()

    async def request(
        self,
        url: str,
        *,
        method: str = "GET",
        params: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        persist_snapshot: bool = True,
        ingestion_run_id: str | None = None,
    ) -> RawPayload:
        """Fetch and snapshot. Retries transient failures with backoff."""
        s = settings()
        last_error: Exception | None = None

        for attempt in range(1, s.ingest_max_retries + 1):
            await self.throttle()
            try:
                async with self._client() as client:
                    response = await client.request(method, url, params=params, data=data)
            except httpx.HTTPError as exc:
                last_error = exc
                log(
                    logger,
                    "warning",
                    "fetch failed, retrying",
                    adapter=self.source_id,
                    attempt=attempt,
                    url=url,
                    error=str(exc),
                )
                await asyncio.sleep(min(2**attempt, 10))
                continue

            if response.status_code >= 500 and attempt < s.ingest_max_retries:
                last_error = httpx.HTTPStatusError(
                    f"{response.status_code}", request=response.request, response=response
                )
                await asyncio.sleep(min(2**attempt, 10))
                continue

            record = snapshots.put(
                source_id=self.source_id,
                payload=response.content,
                content_type=response.headers.get("content-type", "application/octet-stream"),
                request_url=str(response.url),
                request_method=method,
                request_params={**(params or {}), **(data or {})},
                http_status=response.status_code,
                ingestion_run_id=ingestion_run_id,
                persist=persist_snapshot,
            )
            return RawPayload(
                body=response.content,
                content_type=record["content_type"],
                url=str(response.url),
                method=method,
                params={**(params or {}), **(data or {})},
                http_status=response.status_code,
                snapshot_id=record["id"],
                storage_key=record["storage_key"],
            )

        raise SourceUnreachableError(
            f"{self.source_id}: could not reach {url} after {s.ingest_max_retries} attempts. "
            "If this machine has no route to the source, ingestion must run from one that does.",
            url=url,
            error=str(last_error),
        )

    # --- the port ---------------------------------------------------------

    @abstractmethod
    async def health_check(self) -> HealthReport: ...

    @abstractmethod
    async def discover(self) -> list[DatasetInfo]: ...

    @abstractmethod
    async def fetch(self, window: Window, *, persist_snapshot: bool = True) -> list[RawPayload]: ...

    @abstractmethod
    def parse(self, raw: RawPayload) -> ParseResult: ...

    @abstractmethod
    def persist(self, result: ParseResult, raw: RawPayload, run_id: str) -> int:
        """Write normalized rows. Must be idempotent."""

    def validate(self, result: ParseResult) -> ValidationReport:
        """Default validation: flag an empty parse and a high rejection rate."""
        issues: list[dict[str, Any]] = []
        total = len(result.rows) + len(result.rejections)

        if total == 0:
            issues.append(
                {
                    "kind": "parse_failure",
                    "severity": "high",
                    "summary": "Parser produced no rows at all.",
                }
            )
        elif result.rejections and len(result.rejections) / total > 0.10:
            issues.append(
                {
                    "kind": "parse_failure",
                    "severity": "medium",
                    "summary": (
                        f"{len(result.rejections)}/{total} rows rejected "
                        f"({len(result.rejections) / total:.0%})."
                    ),
                    "detail": result.rejection_counts(),
                }
            )
        if result.columns_unmapped:
            issues.append(
                {
                    "kind": "schema_change",
                    "severity": "medium",
                    "summary": "Unrecognised columns in the source table.",
                    "detail": {"columns": result.columns_unmapped},
                }
            )
        return ValidationReport(ok=not any(i["severity"] in {"high", "critical"} for i in issues), issues=issues)

    # --- verification (the dry run) ---------------------------------------

    async def verify(self, window: Window) -> dict[str, Any]:
        """Fetch, parse and report — WITHOUT writing to the database.

        This is how a source is validated the first time. It exists because the
        adapters in this repo have never seen a live response.
        """
        started = time.monotonic()
        report: dict[str, Any] = {
            "adapter": self.source_id,
            "parserVersion": self.parser_version,
            "reachable": False,
            "httpStatus": None,
            "snapshotId": None,
            "storageKey": None,
            "tableFound": False,
            "columnsDetected": [],
            "columnsMapped": {},
            "columnsUnmapped": [],
            "rowsParsed": 0,
            "rowsRejected": 0,
            "rejectionReasons": {},
            "sampleRows": [],
            "warnings": [],
            "validation": [],
            "durationMs": 0,
        }

        try:
            payloads = await self.fetch(window, persist_snapshot=False)
        except SourceUnreachableError as exc:
            report["warnings"].append(str(exc))
            report["durationMs"] = int((time.monotonic() - started) * 1000)
            return report

        if not payloads:
            report["warnings"].append("Adapter returned no payloads for this window.")
            report["durationMs"] = int((time.monotonic() - started) * 1000)
            return report

        raw = payloads[0]
        report["reachable"] = True
        report["httpStatus"] = raw.http_status
        report["snapshotId"] = raw.snapshot_id
        report["storageKey"] = raw.storage_key

        try:
            parsed = self.parse(raw)
        except Exception as exc:  # parser problems are the point of this endpoint
            report["warnings"].append(f"Parse failed: {exc}")
            report["durationMs"] = int((time.monotonic() - started) * 1000)
            return report

        report["tableFound"] = bool(parsed.columns_detected)
        report["columnsDetected"] = parsed.columns_detected
        report["columnsMapped"] = parsed.columns_mapped
        report["columnsUnmapped"] = parsed.columns_unmapped
        report["rowsParsed"] = len(parsed.rows)
        report["rowsRejected"] = len(parsed.rejections)
        report["rejectionReasons"] = parsed.rejection_counts()
        report["sampleRows"] = [_jsonable(r) for r in parsed.rows[:3]]
        report["warnings"].extend(parsed.warnings)
        report["validation"] = self.validate(parsed).issues
        report["durationMs"] = int((time.monotonic() - started) * 1000)
        return report

    # --- run bookkeeping --------------------------------------------------

    def start_run(self, trigger: str, window: Window) -> str:
        run_id = str(uuid.uuid4())
        with connection() as conn:
            conn.execute(
                text(
                    """
                    insert into ingestion_runs
                      (id, source_id, adapter, parser_version, trigger,
                       window_from, window_to, started_at, status)
                    values
                      (:id, :source_id, :adapter, :parser_version, :trigger,
                       :window_from, :window_to, now(), 'running')
                    """
                ),
                {
                    "id": run_id,
                    "source_id": self.source_id,
                    "adapter": self.source_id,
                    "parser_version": self.parser_version,
                    "trigger": trigger,
                    "window_from": str(window.start) if window.start else None,
                    "window_to": str(window.end) if window.end else None,
                },
            )
        return run_id

    def finish_run(
        self,
        run_id: str,
        *,
        status: str,
        fetched: int,
        written: int,
        rejected: int,
        rejection_reasons: dict[str, int],
        error: str | None = None,
    ) -> None:
        import json

        with connection() as conn:
            conn.execute(
                text(
                    """
                    update ingestion_runs
                       set finished_at = now(),
                           status = :status,
                           rows_fetched = :fetched,
                           rows_written = :written,
                           rows_rejected = :rejected,
                           rejection_reasons = cast(:reasons as jsonb),
                           error_message = :error
                     where id = :id
                    """
                ),
                {
                    "id": run_id,
                    "status": status,
                    "fetched": fetched,
                    "written": written,
                    "rejected": rejected,
                    "reasons": json.dumps(rejection_reasons),
                    "error": error,
                },
            )
            conn.execute(
                text(
                    """
                    update sources
                       set last_attempt_at = now(),
                           last_success_at = case when :status = 'succeeded' then now() else last_success_at end,
                           last_error_state = :error,
                           parser_version = :parser_version
                     where source_id = :source_id
                    """
                ),
                {
                    "status": status,
                    "error": error,
                    "parser_version": self.parser_version,
                    "source_id": self.source_id,
                },
            )

    def raise_quality_issue(
        self,
        *,
        kind: str,
        severity: str,
        summary: str,
        detail: dict[str, Any] | None = None,
        run_id: str | None = None,
    ) -> None:
        import json

        with connection() as conn:
            conn.execute(
                text(
                    """
                    insert into data_quality_issues
                      (source_id, adapter, ingestion_run_id, issue_kind, severity, summary, detail)
                    values
                      (:source_id, :adapter, :run_id, :kind, :severity, :summary, cast(:detail as jsonb))
                    """
                ),
                {
                    "source_id": self.source_id,
                    "adapter": self.source_id,
                    "run_id": run_id,
                    "kind": kind,
                    "severity": severity,
                    "summary": summary,
                    "detail": json.dumps(detail or {}, default=str),
                },
            )


def _jsonable(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in row.items():
        out[k] = str(v) if hasattr(v, "quantize") or isinstance(v, (date, datetime)) else v
    return out
