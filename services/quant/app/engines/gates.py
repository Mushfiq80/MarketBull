"""Risk gates — non-compensatory controls.

Some exposures must not be offset by high momentum or growth. A suspended stock
with brilliant fundamentals is still un-buyable. Gates run BEFORE scoring and
produce their own column; they are never folded into the number.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from ..config import load_model_config
from .types import FactorContext, FactorValue, GateResult

#: Ordered by severity — the worst triggered gate decides the final state.
STATE_RANK = {"eligible": 0, "review_required": 1, "restricted": 2, "excluded": 3}


def evaluate(
    ctx: FactorContext,
    factors: dict[str, FactorValue],
    *,
    horizon: str,
    trading_state: str = "normal",
    has_audited_statements: bool = True,
    audited_age_days: int | None = None,
    identity_ambiguous: bool = False,
    open_conflicts: int = 0,
    shariah_status: str | None = None,
    shariah_filter_active: bool = False,
    config: dict[str, Any] | None = None,
) -> tuple[str, list[GateResult]]:
    """Return (final_state, all_gate_results)."""
    cfg = config or load_model_config("fox")
    gate_cfg: dict[str, Any] = cfg.get("gates", {})
    results: list[GateResult] = []

    # --- trading suspension --------------------------------------------
    suspended = trading_state in {"suspended", "halted", "delisted"}
    results.append(
        GateResult(
            gate="suspended",
            triggered=suspended,
            state="excluded" if suspended else "eligible",
            reason=f"Trading state is '{trading_state}'." if suspended else "Trading normally.",
            since=str(ctx.session_date),
        )
    )

    # --- liquidity -------------------------------------------------------
    liq = factors.get("liquidity_risk")
    threshold = Decimal(str(gate_cfg.get("max_days_to_liquidate", {}).get(horizon, 20)))
    if liq is None or not liq.usable:
        results.append(
            GateResult(
                gate="insufficient_liquidity",
                triggered=True,
                state="review_required",
                reason="Liquidity could not be measured — not enough turnover history.",
            )
        )
    else:
        days = liq.raw or Decimal(0)
        triggered = days > threshold
        results.append(
            GateResult(
                gate="insufficient_liquidity",
                triggered=triggered,
                state="restricted" if triggered else "eligible",
                reason=(
                    f"Estimated {days:.1f} sessions to liquidate at 10% participation, "
                    f"above the {threshold} session limit for the {horizon} horizon."
                    if triggered
                    else f"Estimated {days:.1f} sessions to liquidate."
                ),
            )
        )

    # --- audited statements ---------------------------------------------
    max_age = int(gate_cfg.get("max_audited_age_days", 545))  # ~18 months
    stale_audit = (not has_audited_statements) or (
        audited_age_days is not None and audited_age_days > max_age
    )
    results.append(
        GateResult(
            gate="missing_audited_statements",
            triggered=stale_audit,
            state="review_required" if stale_audit else "eligible",
            reason=(
                "No audited annual statement within the required window."
                if stale_audit
                else "Audited statements current."
            ),
        )
    )

    # --- identity --------------------------------------------------------
    results.append(
        GateResult(
            gate="identity_unresolved",
            triggered=identity_ambiguous,
            state="review_required" if identity_ambiguous else "eligible",
            reason=(
                "Ticker history or corporate-action mapping is ambiguous."
                if identity_ambiguous
                else "Identity resolved."
            ),
        )
    )

    # --- regulatory status ----------------------------------------------
    blocking = {"final_finding", "interim_order", "proceeding"}
    min_severity = str(gate_cfg.get("regulatory_min_severity", "high"))
    severity_rank = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    active = [
        g
        for g in ctx.governance
        if str(g.get("status")) in blocking
        and severity_rank.get(str(g.get("severity")), 0) >= severity_rank.get(min_severity, 3)
    ]
    results.append(
        GateResult(
            gate="regulatory_status",
            triggered=bool(active),
            state="restricted" if active else "eligible",
            reason=(
                f"{len(active)} active regulatory matter(s) at or above '{min_severity}' severity."
                if active
                else "No active regulatory matter above threshold."
            ),
            evidence=str(active[0].get("id")) if active else None,
        )
    )

    # --- data conflicts ---------------------------------------------------
    results.append(
        GateResult(
            gate="data_conflict",
            triggered=open_conflicts > 0,
            state="review_required" if open_conflicts > 0 else "eligible",
            reason=(
                f"{open_conflicts} unresolved source conflict(s) affect this issuer."
                if open_conflicts
                else "No unresolved source conflicts."
            ),
        )
    )

    # --- Shariah (user-scoped) -------------------------------------------
    if shariah_filter_active:
        failed = shariah_status == "fail"
        undetermined = shariah_status == "undetermined" or shariah_status is None
        results.append(
            GateResult(
                gate="shariah_excluded",
                triggered=failed or undetermined,
                # "Unable to determine" is NOT treated as a pass.
                state="excluded" if failed else ("review_required" if undetermined else "eligible"),
                reason=(
                    "Fails the selected screening methodology."
                    if failed
                    else (
                        "Screen could not be determined from available data."
                        if undetermined
                        else "Passes the selected screening methodology."
                    )
                ),
            )
        )

    final = "eligible"
    for r in results:
        if r.triggered and STATE_RANK[r.state] > STATE_RANK[final]:
            final = r.state
    return final, results


def triggered_only(results: list[GateResult]) -> list[dict[str, Any]]:
    return [
        {"gate": r.gate, "reason": r.reason, "evidence": r.evidence, "since": r.since}
        for r in results
        if r.triggered
    ]
