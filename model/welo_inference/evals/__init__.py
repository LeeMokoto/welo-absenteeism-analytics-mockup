"""Agent evaluation harness.

The agents are non-deterministic, so we cannot assert their exact words. Instead
we run golden cases through them and apply deterministic *property* checks:
grounded in the supplied data, no invented figures, amounts in Rand, no dashes,
and refuses misuse. This is the analog of the model's cross-validated metrics.

The runner (``run_evals``) is decoupled from the live model via a ``run_fn``
callback, so the checks can be unit-tested offline with stub responders and run
against the real Anthropic-backed agents in CI / locally when a key is present.
"""

from .cases import GOLDEN_CASES, Case
from .checks import CHECKS, CheckResult, run_checks
from .runner import build_live_run_fn, run_evals

__all__ = [
    "Case",
    "GOLDEN_CASES",
    "CHECKS",
    "CheckResult",
    "run_checks",
    "run_evals",
    "build_live_run_fn",
]
