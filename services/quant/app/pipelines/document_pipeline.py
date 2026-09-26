"""Document extraction pipeline.

Extracted values are written as `financial_facts` ONLY when extraction
confidence clears the review threshold. Everything else is quarantined as a
data-quality issue for human review — an uncertain number published as a
verified fact is worse than no number.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db import connection, fetch_one
from ..documents.extract import REVIEW_THRESHOLD, extract_pdf
from ..errors import BaBullError
from ..logging import get_logger
from ..storage.snapshots import _root

logger = get_logger(__name__)


def extract_and_store(document_id: str) -> dict[str, Any]:
    doc = fetch_one(
        """
        select d.id::text as id, d.storage_key, d.issuer_id::text as issuer_id, d.title,
               d.published_at, d.period_end, d.document_type, d.rights_status, d.source_id
          from documents d where d.id = cast(:id as uuid)
        """,
        id=document_id,
    )
    if doc is None:
        raise BaBullError(f"Document {document_id} not found.")
    if not doc.get("storage_key"):
        raise BaBullError("Document has no stored file — fetch it before extracting.")
    if doc.get("rights_status") == "restricted":
        raise BaBullError("Document rights do not permit text processing.")

    path = str(_root() / doc["storage_key"])
    result = extract_pdf(path)

    published = doc.get("published_at") or datetime.now(timezone.utc)
    now = datetime.now(timezone.utc)

    accepted = [f for f in result.facts if not f.needs_review]
    quarantined = [f for f in result.facts if f.needs_review]

    rows = [
        {
            "id": str(uuid.uuid4()),
            "issuer_id": doc["issuer_id"],
            "metric": f.metric,
            "value": f.value,
            "unit": "BDT",
            "period_type": "annual",
            "period_end": doc.get("period_end"),
            "statement": None,
            "document_id": doc["id"],
            "page_ref": f"p.{f.page}",
            "extraction_confidence": f.confidence,
            "audit_opinion": result.audit_opinion,
            "source_id": doc["source_id"],
            "published_at": published,
            "retrieved_at": now,
            "parser_version": f"doc-extract-1.0.0/{result.method}",
        }
        for f in accepted
        if doc.get("period_end")
    ]

    with connection() as conn:
        if rows:
            conn.execute(
                text(
                    """
                    insert into financial_facts
                      (id, issuer_id, metric, value, unit, period_type, period_end, statement,
                       document_id, page_ref, extraction_confidence, audit_opinion,
                       source_id, published_at, retrieved_at, parser_version, quality, version)
                    values
                      (:id, :issuer_id, :metric, :value, :unit, :period_type, :period_end, :statement,
                       :document_id, :page_ref, :extraction_confidence, :audit_opinion,
                       :source_id, :published_at, :retrieved_at, :parser_version, 'ok', 1)
                    on conflict (issuer_id, metric, period_type, period_end, source_id, version)
                    do nothing
                    """
                ),
                rows,
            )

        if quarantined:
            conn.execute(
                text(
                    """
                    insert into data_quality_issues
                      (source_id, adapter, issue_kind, severity, summary, detail,
                       affected_table, affected_entity_id)
                    values
                      (:source_id, 'document_extract', 'parse_failure', 'medium', :summary,
                       cast(:detail as jsonb), 'financial_facts', cast(:issuer_id as uuid))
                    """
                ),
                {
                    "source_id": doc["source_id"],
                    "summary": (
                        f"{len(quarantined)} extracted value(s) from '{doc['title']}' fell below the "
                        f"{REVIEW_THRESHOLD} confidence threshold and were withheld pending review."
                    ),
                    "detail": json.dumps(
                        [
                            {"metric": f.metric, "value": str(f.value), "page": f.page,
                             "confidence": f.confidence, "line": f.line}
                            for f in quarantined
                        ]
                    ),
                    "issuer_id": doc["issuer_id"],
                },
            )

        conn.execute(
            text(
                """
                update documents
                   set extraction_state = :state,
                       extraction_method = :method
                 where id = cast(:id as uuid)
                """
            ),
            {
                "id": document_id,
                "state": "extracted" if accepted else "needs_review",
                "method": result.method,
            },
        )

    return {
        "documentId": document_id,
        "factsExtracted": len(rows),
        "needsReview": len(quarantined),
        "auditOpinion": result.audit_opinion,
        "method": result.method,
        "pagesProcessed": result.pages_processed,
        "warnings": result.warnings,
    }
