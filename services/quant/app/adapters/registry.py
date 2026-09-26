"""Adapter registry."""

from __future__ import annotations

from ..errors import AdapterNotFoundError
from .base import BaseAdapter
from .bb_macro import BangladeshBankAdapter
from .bbs import BbsAdapter
from .bsec import BsecAdapter
from .dse_company import DseCompanyAdapter
from .dse_eod import DseEodAdapter
from .dse_index import DseIndexAdapter
from .dse_latest import DseLatestAdapter

_ADAPTERS: dict[str, type[BaseAdapter]] = {
    DseCompanyAdapter.source_id: DseCompanyAdapter,
    DseEodAdapter.source_id: DseEodAdapter,
    DseLatestAdapter.source_id: DseLatestAdapter,
    DseIndexAdapter.source_id: DseIndexAdapter,
    BsecAdapter.source_id: BsecAdapter,
    BangladeshBankAdapter.source_id: BangladeshBankAdapter,
    BbsAdapter.source_id: BbsAdapter,
}


def available() -> list[str]:
    return sorted(_ADAPTERS)


def get(source_id: str) -> BaseAdapter:
    cls = _ADAPTERS.get(source_id)
    if cls is None:
        raise AdapterNotFoundError(
            f"Unknown adapter '{source_id}'. Available: {', '.join(available())}"
        )
    return cls()


def describe() -> list[dict[str, str]]:
    return [
        {
            "sourceId": cls.source_id,
            "description": cls.description,
            "parserVersion": cls.parser_version,
        }
        for cls in _ADAPTERS.values()
    ]
