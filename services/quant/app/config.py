"""Service configuration.

Everything tunable is here or in ``app/config/models/*.yaml``. Nothing that
affects a score may be hard-coded in an engine — a score carries the hash of the
config that produced it, and that only works if the config is data.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
MODEL_CONFIG_DIR = Path(__file__).resolve().parent / "config" / "models"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- database ---------------------------------------------------------
    database_url: str = "postgresql+psycopg://babull:babull_dev_password@localhost:5432/babull"

    # --- service ----------------------------------------------------------
    quant_service_token: str = "change_me_to_a_long_random_string"
    quant_bind_host: str = "127.0.0.1"
    quant_bind_port: int = 8000
    log_level: str = "info"

    # --- storage ----------------------------------------------------------
    storage_driver: str = "local"
    storage_local_path: str = "./storage"

    # --- ingestion --------------------------------------------------------
    ingest_user_agent: str = "BABull/0.1 (private research)"
    ingest_request_delay_ms: int = 1500
    ingest_max_retries: int = 3
    ingest_timeout_seconds: int = 30

    dse_base_url: str = "https://www.dse.com.bd"
    bsec_base_url: str = "https://sec.gov.bd"
    bb_base_url: str = "https://www.bb.org.bd"
    bbs_base_url: str = "https://bbs.gov.bd"

    def sqlalchemy_url(self) -> str:
        """Accept either the Node-style or the SQLAlchemy-style URL."""
        url = self.database_url
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings()


# --------------------------------------------------------------------------
# Model configs (weights, thresholds, factor definitions)
# --------------------------------------------------------------------------


def config_hash(payload: dict[str, Any]) -> str:
    """Stable hash of a config, stamped onto every score it produces."""
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


@lru_cache(maxsize=16)
def load_model_config(name: str) -> dict[str, Any]:
    path = MODEL_CONFIG_DIR / f"{name}.yaml"
    if not path.exists():
        raise FileNotFoundError(
            f"Model config '{name}' not found at {path}. "
            "Weights are configuration, not code — create the YAML."
        )
    with path.open("r", encoding="utf-8") as fh:
        cfg: dict[str, Any] = yaml.safe_load(fh)
    cfg["_hash"] = config_hash({k: v for k, v in cfg.items() if not k.startswith("_")})
    return cfg
