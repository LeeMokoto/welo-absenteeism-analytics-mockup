"""Source-specific data adapters.

Every client or source implements the same contract through
``BaseAdapter.load``. Pipeline code never imports a specific adapter
directly. Instead it calls :func:`get_adapter` with the name from the
config, which keeps adding a new client to a single registry entry.
"""

from __future__ import annotations

from typing import Dict, Type

from .base import BaseAdapter
from .uci import UCIAdapter
from .synthetic import SyntheticMiningAdapter
from .glencore import GlencoreAdapter

_REGISTRY: Dict[str, Type[BaseAdapter]] = {
    "uci": UCIAdapter,
    "synthetic_mining": SyntheticMiningAdapter,
    "glencore": GlencoreAdapter,
}


def get_adapter(name: str, **kwargs) -> BaseAdapter:
    if name not in _REGISTRY:
        raise KeyError(
            f"Unknown adapter '{name}'. Known: {sorted(_REGISTRY)}. "
            f"Register a new client by adding it to welo_pipeline/adapters."
        )
    return _REGISTRY[name](**kwargs)


__all__ = ["BaseAdapter", "get_adapter"]
