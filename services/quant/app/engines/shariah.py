"""Shariah screening.

A **screen**, not a certification and not a fatwa. The methodology, its version
and the data date are stored with every result, and each rule's outcome is shown
so a user can see exactly why something passed or failed.

Where data is missing or activity is ambiguous, the result is **undetermined** —
never a silent pass. That distinction is the whole reason this module exists.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from ..config import load_model_config


@dataclass(slots=True)
class RuleOutcome:
    rule: str
    outcome: str  # pass | fail | undetermined
    detail: str
    threshold: str | None = None
    actual: str | None = None
    evidence_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule,
            "outcome": self.outcome,
            "detail": self.detail,
            "threshold": self.threshold,
            "actual": self.actual,
            "evidenceId": self.evidence_id,
        }


@dataclass(slots=True)
class ScreenResult:
    status: str  # pass | fail | undetermined
    methodology: str
    methodology_version: str
    business_activity: list[RuleOutcome] = field(default_factory=list)
    financial_ratios: list[RuleOutcome] = field(default_factory=list)
    undetermined_reasons: list[str] = field(default_factory=list)
    data_date: date | None = None

    @property
    def disclaimer(self) -> str:
        return (
            f"Screened under {self.methodology} v{self.methodology_version} using data as of "
            f"{self.data_date}. This is a data screen, not a religious certification or fatwa."
        )


def screen(
    *,
    issuer: dict[str, Any],
    financials: dict[str, Decimal | None],
    market_cap: Decimal | None,
    methodology: str = "aaoifi_style",
    data_date: date | None = None,
    config: dict[str, Any] | None = None,
) -> ScreenResult:
    cfg = config or load_model_config("shariah")
    method_cfg = cfg["methodologies"].get(methodology)
    if method_cfg is None:
        raise ValueError(f"Unknown Shariah methodology '{methodology}'.")

    result = ScreenResult(
        status="pass",
        methodology=methodology,
        methodology_version=str(method_cfg["version"]),
        data_date=data_date,
    )

    # ---- 1. business activity -------------------------------------------
    sector = str(issuer.get("sector_code") or "").upper()
    description = str(issuer.get("business_description") or "").lower()

    prohibited_sectors: list[str] = [s.upper() for s in method_cfg["prohibited_sectors"]]
    prohibited_keywords: list[str] = [k.lower() for k in method_cfg["prohibited_keywords"]]

    if not sector and not description:
        result.business_activity.append(
            RuleOutcome(
                rule="business_activity",
                outcome="undetermined",
                detail="No sector classification or business description on file.",
            )
        )
        result.undetermined_reasons.append("business_activity_unknown")
    else:
        matched_sector = sector in prohibited_sectors
        matched_keyword = next((k for k in prohibited_keywords if k in description), None)
        if matched_sector or matched_keyword:
            result.business_activity.append(
                RuleOutcome(
                    rule="business_activity",
                    outcome="fail",
                    detail=(
                        f"Sector '{sector}' is excluded by this methodology."
                        if matched_sector
                        else f"Business description mentions '{matched_keyword}'."
                    ),
                )
            )
        else:
            result.business_activity.append(
                RuleOutcome(
                    rule="business_activity",
                    outcome="pass",
                    detail=f"Sector '{sector or 'unclassified'}' is not on the exclusion list.",
                )
            )

    # ---- 2. financial ratios ---------------------------------------------
    denominator_choice = str(method_cfg.get("ratio_denominator", "market_cap"))
    denominator = market_cap if denominator_choice == "market_cap" else financials.get("total_assets")

    if denominator is None or denominator <= 0:
        result.financial_ratios.append(
            RuleOutcome(
                rule="ratio_denominator",
                outcome="undetermined",
                detail=f"Denominator ({denominator_choice}) unavailable, so ratio tests cannot run.",
            )
        )
        result.undetermined_reasons.append("ratio_denominator_unavailable")
    else:
        for rule in method_cfg["ratio_rules"]:
            metric = rule["metric"]
            limit = Decimal(str(rule["max_ratio"]))
            value = financials.get(metric)
            if value is None:
                result.financial_ratios.append(
                    RuleOutcome(
                        rule=metric,
                        outcome="undetermined",
                        detail=f"'{metric}' is not reported, so this test cannot be evaluated.",
                        threshold=f"< {limit:.0%}",
                    )
                )
                result.undetermined_reasons.append(f"{metric}_unavailable")
                continue
            ratio = value / denominator
            result.financial_ratios.append(
                RuleOutcome(
                    rule=metric,
                    outcome="pass" if ratio < limit else "fail",
                    detail=rule.get("description", ""),
                    threshold=f"< {limit:.0%} of {denominator_choice}",
                    actual=f"{ratio:.2%}",
                )
            )

    # ---- 3. combine -------------------------------------------------------
    all_outcomes = [o.outcome for o in (*result.business_activity, *result.financial_ratios)]
    if "fail" in all_outcomes:
        result.status = "fail"
    elif "undetermined" in all_outcomes:
        # Unable to determine is NEVER promoted to a pass.
        result.status = "undetermined"
    else:
        result.status = "pass"

    return result
