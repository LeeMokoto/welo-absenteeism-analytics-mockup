"""Run golden cases through an agent, apply the checks, aggregate a report.

``run_evals`` is decoupled from the live model via ``run_fn(agent, question,
data) -> str``. Pass a stub for offline testing, or ``build_live_run_fn`` for the
real Anthropic-backed agents.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from .cases import GOLDEN_CASES, Case
from .checks import run_checks

RunFn = Callable[[str, str, Dict[str, Any]], str]


def build_live_run_fn(agent_service) -> RunFn:
    """Adapt an AgentService into a run_fn for live evaluation."""
    def _run(agent: str, question: str, data: Dict[str, Any]) -> str:
        return agent_service.run(agent, question, data)["text"]
    return _run


def run_evals(
    run_fn: RunFn,
    cases: Optional[List[Case]] = None,
    threshold: float = 1.0,
) -> Dict[str, Any]:
    """Evaluate every case and return a structured report.

    ``threshold`` is the minimum overall pass rate for the gate. Default 1.0:
    these are guardrail checks, so any failure should block a release.
    """
    cases = cases if cases is not None else GOLDEN_CASES
    case_reports: List[Dict[str, Any]] = []

    for case in cases:
        error = None
        try:
            text = run_fn(case.agent, case.question, case.data)
        except Exception as exc:  # a dead agent is a failed case, not a crash
            text, error = "", f"{type(exc).__name__}: {exc}"

        results = run_checks(text, case) if error is None else []
        checks = [{"name": r.name, "passed": r.passed, "detail": r.detail} for r in results]
        passed = error is None and all(r.passed for r in results)
        case_reports.append({
            "id": case.id,
            "agent": case.agent,
            "passed": passed,
            "error": error,
            "checks": checks,
            "failed_checks": [r.name for r in results if not r.passed],
        })

    total = len(case_reports)
    n_pass = sum(1 for c in case_reports if c["passed"])
    pass_rate = round(n_pass / total, 4) if total else 0.0

    by_agent: Dict[str, Dict[str, int]] = {}
    for c in case_reports:
        a = by_agent.setdefault(c["agent"], {"total": 0, "passed": 0})
        a["total"] += 1
        a["passed"] += 1 if c["passed"] else 0

    return {
        "summary": {
            "total": total,
            "passed": n_pass,
            "pass_rate": pass_rate,
            "threshold": threshold,
            "gate_passed": pass_rate >= threshold,
        },
        "by_agent": by_agent,
        "cases": case_reports,
    }
