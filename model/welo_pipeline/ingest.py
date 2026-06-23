"""Ingest stage.

Loads from the primary source adapter and (optionally) stacks an
augmentation source on top, returning a single canonical DataFrame.
"""

from __future__ import annotations

import pandas as pd

from .adapters import get_adapter
from .config import PipelineConfig


def ingest(config: PipelineConfig) -> pd.DataFrame:
    primary_opts = {"path": config.source.path} if config.source.path else {}
    primary = get_adapter(config.source.adapter, **primary_opts).load()
    primary["_source_tier"] = "primary"
    frames = [primary]

    if config.augmentation.enabled and config.augmentation.adapter:
        aug = get_adapter(
            config.augmentation.adapter,
            n_rows=config.augmentation.n_rows,
            cohort=config.augmentation.cohort or "default",
            random_seed=config.random_seed,
        ).load()
        aug["_source_tier"] = "augmentation"
        frames.append(aug)

    stacked = pd.concat(frames, ignore_index=True)
    return stacked
