"""Runtime configuration for the inference service.

Every field can be overridden through an environment variable, so a
Cloud Run service can be tuned per environment without touching the
code or rebuilding the image.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_list(name: str, default: str) -> list[str]:
    raw = _env(name, default)
    return [s.strip() for s in raw.split(",") if s.strip()]


@dataclass(frozen=True)
class InferenceConfig:
    models_dir: Path = Path(_env("WELO_MODELS_DIR", "models"))
    dashboard_feed_path: Path = Path(_env("WELO_FEED_PATH", "data/outputs/dashboard_feed.json"))
    feature_thresholds_low: float = float(_env("WELO_BAND_LOW", "4"))
    feature_thresholds_medium: float = float(_env("WELO_BAND_MEDIUM", "16"))
    feature_thresholds_high: float = float(_env("WELO_BAND_HIGH", "40"))
    api_key: str | None = _env("WELO_API_KEY", "") or None
    cors_origins: list[str] = None
    horizon_days: int = int(_env("WELO_HORIZON_DAYS", "90"))
    hours_per_day: float = float(_env("WELO_HOURS_PER_DAY", "8"))
    # Agent layer (Anthropic Messages API). The key is read server-side only.
    # ANTHROPIC_API_KEY is the SDK's own env var; WELO_ANTHROPIC_API_KEY is an
    # explicit override if you prefer to namespace it with the other WELO_ vars.
    anthropic_api_key: str | None = (
        _env("WELO_ANTHROPIC_API_KEY", "") or _env("ANTHROPIC_API_KEY", "") or None
    )
    agent_model: str = _env("WELO_AGENT_MODEL", "claude-opus-4-8")
    agent_thinking: bool = _env("WELO_AGENT_THINKING", "1") not in ("0", "false", "False", "")
    # Reliability knobs: keep a demo alive in front of a client. The Anthropic
    # client retries transient errors and times out rather than hanging; the
    # scenario endpoint is rate limited so one open URL cannot be hammered.
    agent_timeout_s: float = float(_env("WELO_AGENT_TIMEOUT_S", "60"))
    agent_max_retries: int = int(_env("WELO_AGENT_MAX_RETRIES", "2"))
    rate_limit_per_min: int = int(_env("WELO_RATE_LIMIT_PER_MIN", "60"))

    def __post_init__(self) -> None:
        # CORS defaults to permissive for the demo. Lock this down in production
        # by setting WELO_CORS_ORIGINS to the dashboard origin only.
        object.__setattr__(
            self, "cors_origins", _env_list("WELO_CORS_ORIGINS", "*")
        )

    @property
    def risk_band_thresholds(self) -> dict[str, float]:
        return {
            "low": self.feature_thresholds_low,
            "medium": self.feature_thresholds_medium,
            "high": self.feature_thresholds_high,
        }


_singleton: InferenceConfig | None = None


def get_config() -> InferenceConfig:
    global _singleton
    if _singleton is None:
        _singleton = InferenceConfig()
    return _singleton
