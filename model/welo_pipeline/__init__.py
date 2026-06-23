"""Welo absenteeism pipeline.

End-to-end stages for turning a workforce + screening feed into per-employee
absence risk scores and dashboard-ready aggregates. Designed so the data
source is the only thing that changes when Glencore (or any other client)
goes live: see ``welo_pipeline.adapters``.
"""

from .config import PipelineConfig, load_config

__all__ = ["PipelineConfig", "load_config"]
__version__ = "0.1.0"
