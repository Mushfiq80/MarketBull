"""Backtest report assembly — the template from methodology §7."""

from __future__ import annotations

from typing import Any

from ...db import fetch_all, fetch_one


def build(run_id: str) -> dict[str, Any] | None:
    run = fetch_one("select * from backtest_runs where id = cast(:id as uuid)", id=run_id)
    if run is None:
        return None
    results = fetch_all(
        "select * from backtest_results where run_id = cast(:id as uuid) order by slice_key",
        id=run_id,
    )
    overall = next((r for r in results if r["slice_key"] == "overall"), None)

    return {
        "runId": run_id,
        "name": run["name"],
        # Frozen before the test — part of the anti-snooping record.
        "hypothesis": run["hypothesis"],
        "attemptNumber": run["attempt_number"],
        "status": run["status"],
        "blockedReason": run["blocked_reason"],
        "guardResults": run["guard_results"],
        "reproducibility": {
            "configHash": run["config_hash"],
            "modelVersion": run["model_version"],
            "codeCommit": run["code_commit"],
            "dataSnapshotIds": run["data_snapshot_ids"],
            "config": run["config"],
        },
        "universe": run["universe_definition"],
        "period": {"from": str(run["period_from"]), "to": str(run["period_to"])},
        "horizon": run["horizon"],
        "rebalance": run["rebalance_frequency"],
        "overall": overall,
        "slices": [r for r in results if r["slice_key"] != "overall"],
        "interpretation": overall["interpretation"] if overall else None,
        "limitations": overall["limitations"] if overall else [],
    }
