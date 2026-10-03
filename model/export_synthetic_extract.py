"""Emit the demo tenant's synthetic cohort as a client-shaped upload extract.

The platform's demo tenant is a real tenant: a scheduled job uploads a synthetic
file through the same signed-URL flow a client uses, so the file is pseudonymised
at ingest, modelled and suppressed exactly as client data would be. That only
works if the synthetic cohort exists as a *file in the canonical upload schema*,
not as a pre-scored dashboard feed.

This script produces that file. It reproduces the same cohort the demo dashboard
shows (SyntheticMiningAdapter, n=5800, seed 7, glencore_sa_mining), so the
records that arrive by upload are the records the dashboard renders, and writes
them in CANONICAL_COLUMNS order.

Deterministic: the same seed produces a byte-identical file, which is what the
scheduled reset of the demo tenant depends on.

Usage:
    python export_synthetic_extract.py [--rows 5800] [--seed 7] [--out PATH]

Note on identifiers: employee_id here is a synthetic surrogate, not a real
identifier. Ingest still hashes it with the tenant key, so the demo exercises
pseudonymisation on the same code path as a client tenant.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from welo_pipeline.adapters.base import CANONICAL_COLUMNS  # noqa: E402
from welo_pipeline.adapters.synthetic import SyntheticMiningAdapter  # noqa: E402

# Matches build_cohort_feed.py so the uploaded extract and the demo dashboard
# describe the same population. Change these together or not at all.
DEFAULT_ROWS = 5800
DEFAULT_SEED = 7
DEFAULT_COHORT = "glencore_sa_mining"


def build_extract(rows: int, seed: int, cohort: str):
    df = SyntheticMiningAdapter(n_rows=rows, random_seed=seed, cohort=cohort).load()
    missing = [c for c in CANONICAL_COLUMNS if c not in df.columns]
    if missing:
        raise SystemExit(
            f"adapter did not supply canonical columns: {missing}. "
            "The upload schema and the adapter contract have diverged."
        )
    return df.loc[:, CANONICAL_COLUMNS]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rows", type=int, default=DEFAULT_ROWS)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--cohort", default=DEFAULT_COHORT)
    ap.add_argument(
        "--out",
        default=str(ROOT / "data" / "outputs" / "synthetic_upload_extract.csv"),
        help="Destination CSV, the file the demo tenant uploads.",
    )
    args = ap.parse_args()

    df = build_extract(args.rows, args.seed, args.cohort)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)

    size_kb = out.stat().st_size / 1024
    print(f"wrote {out} ({len(df)} rows, {len(df.columns)} columns, {size_kb:.0f} KB)")
    print(f"schema: {', '.join(CANONICAL_COLUMNS)}")
    print(f"deterministic: rows={args.rows} seed={args.seed} cohort={args.cohort}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
