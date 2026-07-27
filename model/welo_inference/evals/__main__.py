"""CLI: run the agent evals against the live Anthropic-backed agents.

    python -m welo_inference.evals --out reports/agent_eval.json

Needs a real ANTHROPIC_API_KEY (the agents must be available). Writes the report
and exits non-zero if the gate fails, so CI can block a regression.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from ..config import get_config
from .runner import build_live_run_fn, run_evals


def main() -> int:
    ap = argparse.ArgumentParser(description="Run Welo agent evaluations.")
    ap.add_argument("--out", default="reports/agent_eval.json", help="Report output path.")
    ap.add_argument("--threshold", type=float, default=1.0, help="Min pass rate for the gate.")
    args = ap.parse_args()

    # Imported here so the module still imports without the SDK present.
    from ..agents import AgentService

    cfg = get_config()
    svc = AgentService(
        model=cfg.agent_model,
        api_key=cfg.anthropic_api_key,
        thinking=cfg.agent_thinking,
        timeout_s=cfg.agent_timeout_s,
        max_retries=cfg.agent_max_retries,
    )
    if not svc.available:
        print(f"Agents unavailable, cannot run live evals: {svc.reason_unavailable}", file=sys.stderr)
        print("Set ANTHROPIC_API_KEY and retry.", file=sys.stderr)
        return 2

    report = run_evals(build_live_run_fn(svc), threshold=args.threshold)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))

    s = report["summary"]
    print(f"agent evals: {s['passed']}/{s['total']} cases passed "
          f"(pass_rate={s['pass_rate']}, gate={'PASS' if s['gate_passed'] else 'FAIL'})")
    for c in report["cases"]:
        if not c["passed"]:
            why = c["error"] or ", ".join(c["failed_checks"])
            print(f"  FAIL {c['id']} ({c['agent']}): {why}")
    return 0 if s["gate_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
