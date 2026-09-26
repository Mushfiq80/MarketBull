"""Immutable raw snapshot store.

Every fetch writes here BEFORE parsing. That makes a parser bug replayable
without re-fetching, and it means we can always answer "what did the source
actually say?" — which is the difference between a data bug and a mystery.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..config import settings
from ..db import connection
from sqlalchemy import text


def _root() -> Path:
    p = Path(settings().storage_local_path).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def put(
    *,
    source_id: str,
    payload: bytes,
    content_type: str,
    request_url: str | None = None,
    request_method: str | None = None,
    request_params: dict[str, Any] | None = None,
    http_status: int | None = None,
    ingestion_run_id: str | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Store raw bytes and record the snapshot row.

    ``persist=False`` writes the file but skips the DB row — used by ``verify``,
    which must not touch the database.
    """
    digest = hashlib.sha256(payload).hexdigest()
    now = datetime.now(timezone.utc)
    snapshot_id = str(uuid.uuid4())

    rel = Path(source_id) / now.strftime("%Y") / now.strftime("%m") / f"{snapshot_id}.bin"
    abs_path = _root() / rel
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(payload)

    record = {
        "id": snapshot_id,
        "source_id": source_id,
        "storage_key": str(rel).replace("\\", "/"),
        "content_type": content_type,
        "content_hash": digest,
        "byte_size": len(payload),
        "request_url": request_url,
        "request_method": request_method,
        "request_params": request_params,
        "http_status": http_status,
        "retrieved_at": now,
        "ingestion_run_id": ingestion_run_id,
    }

    if persist:
        with connection() as conn:
            conn.execute(
                text(
                    """
                    insert into snapshots
                      (id, source_id, storage_key, content_type, content_hash, byte_size,
                       request_url, request_method, request_params, http_status,
                       retrieved_at, ingestion_run_id)
                    values
                      (:id, :source_id, :storage_key, :content_type, :content_hash, :byte_size,
                       :request_url, :request_method, cast(:request_params as jsonb), :http_status,
                       :retrieved_at, :ingestion_run_id)
                    """
                ),
                {**record, "request_params": _json(request_params)},
            )

    return record


def read(storage_key: str) -> bytes:
    return (_root() / storage_key).read_bytes()


def _json(value: Any) -> str | None:
    import json

    return None if value is None else json.dumps(value, default=str)
