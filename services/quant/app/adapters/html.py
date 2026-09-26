"""HTML parsing helpers.

The single most important rule here: **match columns by header text, never by
position**. DSE's markup changes without notice. Positional indexing breaks
silently and poisons the database; synonym matching breaks loudly and tells you
exactly which header it did not recognise.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

from bs4 import BeautifulSoup, Tag

from ..errors import ParseError

_WS = re.compile(r"\s+")
_NON_NUMERIC = re.compile(r"[^0-9.\-]")


def soup(payload: bytes) -> BeautifulSoup:
    # lxml is fast and tolerant; html5lib is the fallback for genuinely broken markup.
    try:
        return BeautifulSoup(payload, "lxml")
    except Exception:  # pragma: no cover - depends on local lxml build
        return BeautifulSoup(payload, "html5lib")


def normalize_header(text: str) -> str:
    """Casefold, strip decoration, collapse whitespace.

    DSE headers carry asterisks and footnote markers ('CLOSEP*', 'LTP*').
    """
    cleaned = text.replace("\xa0", " ").strip()
    cleaned = cleaned.replace("*", "").replace("#", "")
    cleaned = _WS.sub(" ", cleaned)
    return cleaned.strip().lower()


def find_data_table(document: BeautifulSoup, required_headers: list[str]) -> Tag:
    """Locate the table whose header row contains all of the required headers.

    Tries every table on the page rather than trusting a CSS path, because a
    layout change that adds a wrapper table should not break ingestion.
    """
    wanted = {normalize_header(h) for h in required_headers}
    best: tuple[int, Tag] | None = None

    for table in document.find_all("table"):
        headers = {normalize_header(th.get_text()) for th in table.find_all(["th", "td"], limit=40)}
        overlap = len(wanted & headers)
        if overlap == len(wanted):
            return table
        if best is None or overlap > best[0]:
            best = (overlap, table)

    raise ParseError(
        "No table on the page contained the required headers. "
        "The page structure has probably changed — inspect the saved snapshot.",
        required_headers=sorted(wanted),
        best_overlap=best[0] if best else 0,
    )


def table_rows(table: Tag) -> tuple[list[str], list[list[str]]]:
    """Return (header_cells, data_rows) as raw text."""
    rows = table.find_all("tr")
    if not rows:
        raise ParseError("Table contained no rows.")

    header_cells: list[str] = []
    header_index = 0
    for i, row in enumerate(rows):
        cells = [c.get_text() for c in row.find_all(["th", "td"])]
        if not cells:
            continue
        # A header row is one whose cells are mostly non-numeric.
        numericish = sum(1 for c in cells if _looks_numeric(c))
        if numericish <= len(cells) // 3:
            header_cells = cells
            header_index = i
            break

    if not header_cells:
        raise ParseError("Could not identify a header row in the table.")

    body: list[list[str]] = []
    for row in rows[header_index + 1 :]:
        cells = [c.get_text() for c in row.find_all(["th", "td"])]
        if cells and any(c.strip() for c in cells):
            body.append(cells)
    return header_cells, body


def _looks_numeric(text: str) -> bool:
    stripped = _NON_NUMERIC.sub("", text.replace(",", ""))
    return bool(stripped) and stripped not in {"-", "."}


def map_columns(
    headers: list[str],
    synonyms: dict[str, list[str]],
) -> tuple[dict[str, int], list[str]]:
    """Map canonical field names to column indices using header synonyms.

    Returns (mapping, unmapped_headers). A caller that finds a required field
    missing from the mapping must raise — never fall back to a position.
    """
    normalized = [normalize_header(h) for h in headers]
    mapping: dict[str, int] = {}

    for field, options in synonyms.items():
        wanted = [normalize_header(o) for o in options]
        for idx, header in enumerate(normalized):
            if header in wanted:
                mapping[field] = idx
                break

    used = set(mapping.values())
    unmapped = [headers[i].strip() for i in range(len(headers)) if i not in used and headers[i].strip()]
    return mapping, unmapped


def clean_number(raw: str | None) -> Decimal | None:
    """Parse a numeric cell.

    Returns None for genuinely absent values ('-', '--', '', 'N/A'). Raises for
    anything that looks like data but cannot be parsed, because silently
    dropping a malformed number is how bad data gets in.
    """
    if raw is None:
        return None
    text = raw.replace("\xa0", " ").strip()
    if text in {"", "-", "--", "---", "N/A", "n/a", "NA", "null", "."}:
        return None

    candidate = text.replace(",", "").replace("+", "").strip()
    # Parenthesised negatives: (1.23) -> -1.23
    if candidate.startswith("(") and candidate.endswith(")"):
        candidate = "-" + candidate[1:-1]
    candidate = candidate.rstrip("%").strip()

    try:
        return Decimal(candidate)
    except (InvalidOperation, ValueError) as exc:
        raise ParseError(f"Could not parse numeric cell: {raw!r}") from exc


def clean_text(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = _WS.sub(" ", raw.replace("\xa0", " ")).strip()
    return text or None


def row_to_dict(row: list[str], mapping: dict[str, int]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for field, idx in mapping.items():
        out[field] = row[idx] if idx < len(row) else None
    return out
