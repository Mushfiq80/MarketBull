"""Pipeline orchestration: ingest → validate → persist, with run bookkeeping.

Jobs are idempotent and at-least-once. Exactly-once delivery is not assumed —
the writes use conflict handling instead, which is the honest way to build this.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from ..adapters import registry
from ..adapters.base import Window
from ..errors import BaBullError
from ..logging import get_logger, log

logger = get_logger(__name__)


@dataclass(slots=True)
class IngestResult:
    run_id: str
    adapter: str
    status: str
    rows_fetched: int
    rows_written: int
    rows_rejected: int
    rejection_reasons: dict[str, int]
    message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "adapter": self.adapter,
            "status": self.status,
            "rowsFetched": self.rows_fetched,
            "rowsWritten": self.rows_written,
            "rowsRejected": self.rows_rejected,
            "rejectionReasons": self.rejection_reasons,
            "message": self.message,
        }


async def ingest(
    adapter_name: str,
    *,
    start: date | None = None,
    end: date | None = None,
    trigger: str = "manual",
    extra: dict[str, Any] | None = None,
) -> IngestResult:
    adapter = registry.get(adapter_name)
    window = Window(start=start, end=end, extra=dict(extra or {}))
    run_id = adapter.start_run(trigger, window)
    window.extra["run_id"] = run_id

    fetched = written = rejected = 0
    reasons: dict[str, int] = {}
    status = "succeeded"
    message: str | None = None

    try:
        payloads = await adapter.fetch(window)
        for raw in payloads:
            parsed = adapter.parse(raw)
            fetched += len(parsed.rows) + len(parsed.rejections)
            rejected += len(parsed.rejections)
            for reason, count in parsed.rejection_counts().items():
                reasons[reason] = reasons.get(reason, 0) + count

            report = adapter.validate(parsed)
            for issue in report.issues:
                adapter.raise_quality_issue(
                    kind=str(issue["kind"]),
                    severity=str(issue["severity"]),
                    summary=str(issue["summary"]),
                    detail=issue.get("detail"),
                    run_id=run_id,
                )

            written += adapter.persist(parsed, raw, run_id)

        if rejected and fetched and rejected / fetched > 0.10:
            status = "partial"
            message = f"{rejected}/{fetched} rows rejected — inspect rejectionReasons."

    except BaBullError as exc:
        status = "failed"
        message = exc.message
        log(logger, "error", "ingestion failed", adapter=adapter_name, error=exc.message, run_id=run_id)
    except Exception as exc:  # noqa: BLE001 - the run record must capture everything
        status = "failed"
        message = str(exc)
        log(logger, "error", "ingestion crashed", adapter=adapter_name, error=str(exc), run_id=run_id)

    adapter.finish_run(
        run_id,
        status=status,
        fetched=fetched,
        written=written,
        rejected=rejected,
        rejection_reasons=reasons,
        error=message if status != "succeeded" else None,
    )

    return IngestResult(
        run_id=run_id,
        adapter=adapter_name,
        status=status,
        rows_fetched=fetched,
        rows_written=written,
        rows_rejected=rejected,
        rejection_reasons=reasons,
        message=message,
    )


async def verify(adapter_name: str, *, start: date | None = None, end: date | None = None) -> dict[str, Any]:
    """Dry run. Fetches, parses, reports — writes nothing to the database."""
    adapter = registry.get(adapter_name)
    return await adapter.verify(Window(start=start, end=end))
