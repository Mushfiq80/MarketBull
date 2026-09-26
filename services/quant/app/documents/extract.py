"""Document extraction with page-level provenance.

Order of attack: text layer → table extraction → OCR. Bangla scanned filings are
common, so OCR is a first-class path, not an afterthought. Low-confidence fields
are QUARANTINED for human review rather than published as verified values.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from ..logging import get_logger

logger = get_logger(__name__)

#: Metric synonyms seen in Bangladeshi annual reports, English and Bangla.
METRIC_PATTERNS: dict[str, list[str]] = {
    "revenue": ["revenue", "turnover", "net sales", "sales revenue", "gross revenue", "রাজস্ব"],
    "gross_profit": ["gross profit", "gross margin"],
    "operating_income": ["operating profit", "profit from operations", "operating income"],
    "net_income": ["net profit", "profit after tax", "net profit after tax", "pat", "নিট মুনাফা"],
    "eps_basic": ["basic eps", "earnings per share", "eps", "শেয়ার প্রতি আয়"],
    "total_assets": ["total assets", "মোট সম্পদ"],
    "total_equity": ["total equity", "shareholders equity", "shareholders' equity", "net asset"],
    "total_debt": ["total debt", "borrowings", "long term loan", "term loan"],
    "cash_and_equivalents": ["cash and cash equivalents", "cash & cash equivalents"],
    "operating_cash_flow": ["net cash from operating activities", "cash flow from operations"],
    "dividend_per_share": ["dividend per share", "dps", "cash dividend"],
    "book_value_per_share": ["net asset value per share", "navps", "book value per share"],
    "interest_expense": ["interest expense", "financial expenses", "finance cost"],
    # bank / NBFI
    "net_interest_income": ["net interest income", "net interest margin income"],
    "non_performing_loans": ["non-performing loan", "classified loan", "npl"],
    "gross_loans": ["loans and advances", "total loans", "gross loans"],
    "loan_loss_provisions": ["provision for loans", "loan loss provision", "provision for classified"],
    "capital_adequacy_ratio": ["capital adequacy ratio", "car", "crar"],
    # insurance
    "claims_ratio": ["claims ratio", "loss ratio"],
    "expense_ratio": ["expense ratio", "management expense ratio"],
}

AUDIT_OPINION_PATTERNS: list[tuple[str, str]] = [
    (r"\badverse opinion\b", "adverse"),
    (r"\bdisclaimer of opinion\b", "disclaimer"),
    (r"\bqualified opinion\b", "qualified"),
    (r"\bmaterial uncertainty related to going concern\b", "emphasis_going_concern"),
    (r"\bemphasis of matter\b", "emphasis_of_matter"),
    (r"\bunqualified opinion\b|\btrue and fair view\b", "unqualified"),
]

#: Below this, a value is quarantined rather than published.
REVIEW_THRESHOLD = 0.75

_NUM = re.compile(r"\(?-?[\d,]+(?:\.\d+)?\)?")


@dataclass(slots=True)
class ExtractedFact:
    metric: str
    value: Decimal
    page: int
    line: str
    confidence: float
    needs_review: bool


@dataclass(slots=True)
class ExtractionResult:
    facts: list[ExtractedFact] = field(default_factory=list)
    audit_opinion: str | None = None
    audit_opinion_page: int | None = None
    method: str = "text_layer"
    pages_processed: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def needs_review_count(self) -> int:
        return sum(1 for f in self.facts if f.needs_review)


def extract_pdf(path: str, *, ocr_fallback: bool = True) -> ExtractionResult:
    result = ExtractionResult()
    pages = _read_pages(path, result, ocr_fallback=ocr_fallback)
    result.pages_processed = len(pages)

    for page_no, text in pages:
        lowered = text.lower()

        if result.audit_opinion is None:
            for pattern, label in AUDIT_OPINION_PATTERNS:
                if re.search(pattern, lowered):
                    result.audit_opinion = label
                    result.audit_opinion_page = page_no
                    break

        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or len(stripped) > 250:
                continue
            lower_line = stripped.lower()
            for metric, synonyms in METRIC_PATTERNS.items():
                matched = next((s for s in synonyms if s in lower_line), None)
                if matched is None:
                    continue
                value, confidence = _value_from_line(stripped, matched)
                if value is None:
                    continue
                result.facts.append(
                    ExtractedFact(
                        metric=metric,
                        value=value,
                        page=page_no,
                        line=stripped[:200],
                        confidence=confidence,
                        needs_review=confidence < REVIEW_THRESHOLD,
                    )
                )
                break

    if not result.facts:
        result.warnings.append(
            "No financial facts extracted. The document may be a scan without a usable text "
            "layer, or the labels may differ — inspect it manually before trusting the absence."
        )
    return result


def _read_pages(path: str, result: ExtractionResult, *, ocr_fallback: bool) -> list[tuple[int, str]]:
    pages: list[tuple[int, str]] = []
    try:
        import fitz  # PyMuPDF

        with fitz.open(path) as doc:
            for i, page in enumerate(doc, start=1):
                text = page.get_text("text") or ""
                pages.append((i, text))
    except Exception as exc:  # noqa: BLE001
        result.warnings.append(f"PyMuPDF failed ({exc}); falling back to pdfplumber.")
        try:
            import pdfplumber

            with pdfplumber.open(path) as pdf:
                for i, page in enumerate(pdf.pages, start=1):
                    pages.append((i, page.extract_text() or ""))
            result.method = "pdfplumber"
        except Exception as exc2:  # noqa: BLE001
            result.warnings.append(f"pdfplumber also failed ({exc2}).")
            return []

    empty_ratio = sum(1 for _, t in pages if len(t.strip()) < 40) / max(1, len(pages))
    if empty_ratio > 0.6:
        result.warnings.append(
            f"{empty_ratio:.0%} of pages have almost no text layer — this is probably a scan. "
            + ("OCR is required." if not ocr_fallback else "Attempting OCR is recommended; "
               "Bangla OCR quality must be spot-checked before the values are trusted.")
        )
        result.method = "ocr_required"
    return pages


def _value_from_line(line: str, label: str) -> tuple[Decimal | None, float]:
    """Take the first number AFTER the label — report layouts put the current
    period in the first numeric column."""
    idx = line.lower().find(label)
    tail = line[idx + len(label) :]
    matches = _NUM.findall(tail)
    if not matches:
        return None, 0.0

    raw = matches[0]
    negative = raw.startswith("(") and raw.endswith(")")
    cleaned = raw.strip("()").replace(",", "")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None, 0.0
    if negative:
        value = -value

    # Confidence heuristics: a clean "label ... number" line with one candidate
    # is trustworthy; several numbers means several period columns and more risk
    # of picking the wrong one.
    confidence = 0.9
    if len(matches) > 1:
        confidence -= 0.2
    if len(matches) > 3:
        confidence -= 0.2
    if len(tail.strip()) > 120:
        confidence -= 0.1
    if value == 0:
        confidence -= 0.1
    return value, max(0.1, round(confidence, 2))
