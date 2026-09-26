"""Shared-secret auth between the web server and this service."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from .config import settings


async def require_token(x_babull_token: str | None = Header(default=None)) -> None:
    expected = settings().quant_service_token
    if not x_babull_token or not hmac.compare_digest(x_babull_token, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED", "message": "Invalid or missing X-BABull-Token."},
        )
