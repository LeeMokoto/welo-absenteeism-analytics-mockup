"""Pipeline configuration loader.

Configs live as YAML under ``configs/``. One file per client or per demo
run. Everything downstream consumes a :class:`PipelineConfig` so swapping
``configs/demo.yaml`` for ``configs/glencore.yaml`` is the whole switch.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict

import yaml


@dataclass
class SourceConfig:
    adapter: str
    path: str | None = None
    options: Dict[str, Any] = field(default_factory=dict)


@dataclass
class AugmentationConfig:
    enabled: bool = False
    adapter: str | None = None
    n_rows: int = 0
    cohort: str | None = None


@dataclass
class TargetConfig:
    regression: str
    risk_band_thresholds: Dict[str, float]


@dataclass
class ModelSpec:
    name: str
    cv_folds: int = 5


@dataclass
class ModelConfig:
    regression: ModelSpec
    classification: ModelSpec


@dataclass
class OutputConfig:
    models_dir: str
    predictions_dir: str
    dashboard_json: str
    reports_dir: str


@dataclass
class PipelineConfig:
    run_name: str
    random_seed: int
    source: SourceConfig
    augmentation: AugmentationConfig
    target: TargetConfig
    model: ModelConfig
    output: OutputConfig

    def ensure_dirs(self) -> None:
        for path in (
            self.output.models_dir,
            self.output.predictions_dir,
            self.output.reports_dir,
            Path(self.output.dashboard_json).parent,
        ):
            Path(path).mkdir(parents=True, exist_ok=True)


def load_config(path: str | Path) -> PipelineConfig:
    raw = yaml.safe_load(Path(path).read_text())
    return PipelineConfig(
        run_name=raw["run_name"],
        random_seed=int(raw.get("random_seed", 7)),
        source=SourceConfig(**raw["source"]),
        augmentation=AugmentationConfig(**raw.get("augmentation", {"enabled": False})),
        target=TargetConfig(**raw["target"]),
        model=ModelConfig(
            regression=ModelSpec(**raw["model"]["regression"]),
            classification=ModelSpec(**raw["model"]["classification"]),
        ),
        output=OutputConfig(**raw["output"]),
    )
