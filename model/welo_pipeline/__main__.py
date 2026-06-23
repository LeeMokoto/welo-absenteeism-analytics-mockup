"""Command-line entry point.

Run the full pipeline against a YAML config like so::

    python -m welo_pipeline --config configs/demo.yaml
"""

from __future__ import annotations

import argparse
import json

from .config import load_config
from .pipeline import run_pipeline


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Welo absenteeism pipeline.")
    parser.add_argument(
        "--config", "-c", default="configs/demo.yaml", help="Path to a pipeline config YAML."
    )
    args = parser.parse_args()

    config = load_config(args.config)
    result = run_pipeline(config)

    print(f"\n=== {config.run_name} ===")
    print(f"  rows in       : {len(result.raw):,}")
    print(f"  rows scored   : {len(result.predictions):,}")
    print(f"  validation    : {len(result.validation_report['warnings'])} warning(s)")
    for w in result.validation_report["warnings"]:
        print(f"      - {w}")
    print("\n  model metrics:")
    print(json.dumps(result.artifacts.metrics, indent=2, default=float))
    print("\n  timings (s):", result.elapsed_seconds)
    print("\n  outputs:")
    for k, v in result.output_paths.items():
        print(f"    {k:20s} {v}")


if __name__ == "__main__":
    main()
