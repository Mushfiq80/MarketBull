"""Database access. SQLAlchemy Core against the Drizzle-managed schema.

This service does NOT own migrations — `apps/web` does. Here we read and write
against the existing tables using reflection-free explicit SQL, which keeps the
two sides from drifting silently: a renamed column fails loudly in a query.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine

from .config import settings

_engine: Engine | None = None


def engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings().sqlalchemy_url(),
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
            future=True,
        )
    return _engine


@contextmanager
def connection() -> Iterator[Connection]:
    with engine().begin() as conn:
        yield conn


def fetch_all(sql: str, **params: Any) -> list[dict[str, Any]]:
    with engine().connect() as conn:
        rows = conn.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def fetch_one(sql: str, **params: Any) -> dict[str, Any] | None:
    rows = fetch_all(sql, **params)
    return rows[0] if rows else None


def execute(sql: str, **params: Any) -> int:
    with connection() as conn:
        result = conn.execute(text(sql), params)
        return result.rowcount or 0


def execute_many(sql: str, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    with connection() as conn:
        result = conn.execute(text(sql), rows)
        return result.rowcount or 0
