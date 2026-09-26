"""Domain errors. Each maps to a stable API error code the web app understands."""

from __future__ import annotations


class BaBullError(Exception):
    code = "INTERNAL"
    http_status = 500

    def __init__(self, message: str, **detail: object) -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail


class SampleDataError(BaBullError):
    """Raised when sample-tagged data reaches research. There is no override."""

    code = "SAMPLE_DATA_BLOCKED"
    http_status = 409


class LookaheadError(BaBullError):
    """A row was visible to a decision that could not have known it."""

    code = "LOOKAHEAD_DETECTED"
    http_status = 409


class UncalibratedModelError(BaBullError):
    """A probability was requested from a model that has not been calibrated."""

    code = "MODEL_UNCALIBRATED"
    http_status = 409


class InsufficientDataError(BaBullError):
    code = "INSUFFICIENT_EVIDENCE"
    http_status = 422


class ParseError(BaBullError):
    """A parser could not parse. It must raise rather than guess."""

    code = "PARSE_FAILED"
    http_status = 422


class SourceUnreachableError(BaBullError):
    code = "SOURCE_UNAVAILABLE"
    http_status = 503


class AdapterNotFoundError(BaBullError):
    code = "NOT_FOUND"
    http_status = 404
