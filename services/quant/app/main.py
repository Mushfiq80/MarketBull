"""BABull quant service entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from . import __version__, logging as log_config
from .api.routes import public, router
from .config import settings
from .errors import BaBullError
from .logging import get_logger, log

log_config.configure()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = settings()
    log(
        logger,
        "info",
        "quant service starting",
        version=__version__,
        bind=f"{s.quant_bind_host}:{s.quant_bind_port}",
        storage=s.storage_driver,
    )
    if s.quant_service_token == "change_me_to_a_long_random_string":
        log(
            logger,
            "warning",
            "QUANT_SERVICE_TOKEN is still the default value — set a real secret in .env",
        )
    yield
    log(logger, "info", "quant service stopping")


app = FastAPI(
    title="BABull Quant Service",
    description=(
        "Deterministic quantitative engine for BABull. Owns ingestion, factors, FOX scoring, "
        "the market regime engine, Shariah screening and backtesting. Internal use only."
    ),
    version=__version__,
    lifespan=lifespan,
)

app.include_router(public)
app.include_router(router)


@app.exception_handler(BaBullError)
async def babull_error_handler(request: Request, exc: BaBullError) -> JSONResponse:
    log(logger, "warning", "domain error", code=exc.code, message=exc.message, path=request.url.path)
    return JSONResponse(
        status_code=exc.http_status,
        content={"detail": {"code": exc.code, "message": exc.message, **{k: str(v) for k, v in exc.detail.items()}}},
    )


@app.get("/")
async def root() -> dict[str, str]:
    return {
        "service": "babull-quant",
        "version": __version__,
        "docs": "/docs",
        "note": "Internal service. Authenticate with X-BABull-Token.",
    }
