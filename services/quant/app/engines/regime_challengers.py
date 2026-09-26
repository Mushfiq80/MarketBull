"""Challenger regime models.

The transparent rules baseline stays in production until a challenger passes
pre-registered criteria out of sample. A model is never promoted because it fits
training history better — that is the definition of overfitting, and in a market
with this few independent cycles it is very easy to do.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from ..logging import get_logger

logger = get_logger(__name__)


@dataclass(slots=True)
class ChallengerResult:
    name: str
    states: list[int]
    state_probabilities: list[list[float]]
    converged: bool
    n_states: int
    notes: list[str]


def hmm_regimes(returns: list[float], n_states: int = 3, max_iter: int = 200) -> ChallengerResult:
    """Gaussian HMM over index returns, fitted with a compact EM implementation.

    Kept dependency-light on purpose. Interpretation of the latent states is NOT
    automatic — a state is only meaningful once a human maps it to a regime and
    that mapping holds out of sample.
    """
    notes: list[str] = []
    x = np.asarray(returns, dtype=float)
    if x.size < 250:
        return ChallengerResult("hmm", [], [], False, n_states, ["insufficient_history"])

    rng = np.random.default_rng(42)
    n = x.size

    # init
    means = np.quantile(x, np.linspace(0.2, 0.8, n_states))
    variances = np.full(n_states, float(np.var(x)) + 1e-8)
    trans = np.full((n_states, n_states), 1.0 / n_states)
    start = np.full(n_states, 1.0 / n_states)

    def gaussian(v: np.ndarray, mu: float, var: float) -> np.ndarray:
        return np.exp(-0.5 * (v - mu) ** 2 / var) / np.sqrt(2 * np.pi * var)

    converged = False
    prev_ll = -np.inf

    for iteration in range(max_iter):
        emission = np.column_stack([gaussian(x, means[k], variances[k]) for k in range(n_states)])
        emission = np.clip(emission, 1e-300, None)

        # forward
        alpha = np.zeros((n, n_states))
        scale = np.zeros(n)
        alpha[0] = start * emission[0]
        scale[0] = alpha[0].sum()
        alpha[0] /= scale[0]
        for t in range(1, n):
            alpha[t] = (alpha[t - 1] @ trans) * emission[t]
            scale[t] = alpha[t].sum()
            alpha[t] /= scale[t]

        # backward
        beta = np.zeros((n, n_states))
        beta[-1] = 1.0
        for t in range(n - 2, -1, -1):
            beta[t] = (trans @ (emission[t + 1] * beta[t + 1])) / scale[t + 1]

        gamma = alpha * beta
        gamma /= np.clip(gamma.sum(axis=1, keepdims=True), 1e-300, None)

        xi = np.zeros((n_states, n_states))
        for t in range(n - 1):
            num = (
                alpha[t][:, None]
                * trans
                * emission[t + 1][None, :]
                * beta[t + 1][None, :]
            )
            xi += num / np.clip(num.sum(), 1e-300, None)

        start = gamma[0] / gamma[0].sum()
        trans = xi / np.clip(xi.sum(axis=1, keepdims=True), 1e-300, None)
        weights = gamma.sum(axis=0)
        means = (gamma * x[:, None]).sum(axis=0) / np.clip(weights, 1e-300, None)
        variances = np.clip(
            (gamma * (x[:, None] - means[None, :]) ** 2).sum(axis=0) / np.clip(weights, 1e-300, None),
            1e-10,
            None,
        )

        ll = float(np.log(np.clip(scale, 1e-300, None)).sum())
        if abs(ll - prev_ll) < 1e-6:
            converged = True
            notes.append(f"converged_at_iteration_{iteration}")
            break
        prev_ll = ll

    if not converged:
        notes.append("did_not_converge_within_max_iter")

    states = gamma.argmax(axis=1).tolist()
    notes.append(
        "Latent states are unlabelled. Map them to regimes explicitly and verify the "
        "mapping holds out of sample before considering promotion."
    )
    return ChallengerResult("hmm", states, gamma.tolist(), converged, n_states, notes)


def promotion_gate(
    baseline_metrics: dict[str, float],
    challenger_metrics: dict[str, float],
    criteria: dict[str, Any],
) -> tuple[bool, list[str]]:
    """Pre-registered promotion criteria. All must pass; none may be added after the run."""
    reasons: list[str] = []
    passed = True

    min_improvement = float(criteria.get("min_oos_improvement", 0.05))
    metric = str(criteria.get("primary_metric", "brier_score"))
    lower_is_better = metric in {"brier_score", "log_loss", "false_transition_rate"}

    base = baseline_metrics.get(metric)
    chal = challenger_metrics.get(metric)
    if base is None or chal is None:
        return False, [f"missing_metric:{metric}"]

    improvement = (base - chal) / abs(base) if lower_is_better else (chal - base) / abs(base)
    if improvement < min_improvement:
        passed = False
        reasons.append(
            f"out_of_sample_improvement {improvement:.1%} below required {min_improvement:.1%}"
        )

    max_false = criteria.get("max_false_transition_rate")
    if max_false is not None and challenger_metrics.get("false_transition_rate", 1.0) > float(max_false):
        passed = False
        reasons.append("false_transition_rate above threshold")

    min_sample = criteria.get("min_oos_sample")
    if min_sample is not None and challenger_metrics.get("sample_size", 0) < float(min_sample):
        passed = False
        reasons.append("out-of-sample sample size too small to conclude anything")

    if passed:
        reasons.append("all pre-registered criteria met")
    return passed, reasons
