"""Observability: structured logs, request ids, and token/cost/latency metrics.

Deliberately dependency-free and vendor-neutral. JSON logs are parsed natively by
Cloud Logging (and anything else); the metrics are in-memory counters exposed at
/metrics as JSON, cheap at demo scale and mappable to Cloud Monitoring or an OTel
collector later without touching the call sites.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections import deque
from contextvars import ContextVar
from threading import Lock
from typing import Any, Deque, Dict, List, Optional

# --- request id (propagated through logs via a contextvar) ------------------

_request_id: ContextVar[Optional[str]] = ContextVar("request_id", default=None)


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


def set_request_id(rid: str):
    return _request_id.set(rid)


def reset_request_id(token) -> None:
    _request_id.reset(token)


def current_request_id() -> Optional[str]:
    return _request_id.get()


# --- JSON log formatter -----------------------------------------------------

# Standard LogRecord attributes we do not want echoed as "extra" fields.
_STD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "taskName", "asctime", "message",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        t = time.gmtime(record.created)
        ts = time.strftime("%Y-%m-%dT%H:%M:%S", t) + f".{int(record.msecs):03d}Z"
        payload: Dict[str, Any] = {
            "timestamp": ts,
            "severity": record.levelname,   # Cloud Logging reads this
            "logger": record.name,
            "message": record.getMessage(),
        }
        rid = current_request_id()
        if rid:
            payload["request_id"] = rid
        for k, v in record.__dict__.items():
            if k not in _STD_ATTRS and not k.startswith("_"):
                payload[k] = v
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler()
    if fmt == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root.addHandler(handler)
    root.setLevel(level.upper())


# --- cost model -------------------------------------------------------------

# USD per 1M tokens (input, output). Estimates for attribution, not billing.
_PRICING: Dict[str, tuple] = {
    "claude-opus-4-8": (5.0, 25.0),
    "claude-opus-4-7": (5.0, 25.0),
    "claude-opus-4-6": (5.0, 25.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-sonnet-4-6": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "claude-fable-5": (10.0, 50.0),
}


def estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> Optional[float]:
    price = _PRICING.get(model)
    if price is None:
        return None
    return round(input_tokens / 1e6 * price[0] + output_tokens / 1e6 * price[1], 6)


# --- metrics registry -------------------------------------------------------

def _pct(vals: List[float], p: float) -> Optional[float]:
    if not vals:
        return None
    s = sorted(vals)
    k = int(round((p / 100.0) * (len(s) - 1)))
    return round(s[k], 1)


class _Lat:
    """Bounded latency sample for cheap percentiles."""
    def __init__(self, maxlen: int = 512) -> None:
        self.samples: Deque[float] = deque(maxlen=maxlen)
        self.count = 0
        self.sum = 0.0
        self.max = 0.0

    def add(self, ms: float) -> None:
        self.samples.append(ms)
        self.count += 1
        self.sum += ms
        self.max = max(self.max, ms)

    def snapshot(self) -> Dict[str, Any]:
        vals = list(self.samples)
        return {
            "count": self.count,
            "avg_ms": round(self.sum / self.count, 1) if self.count else 0.0,
            "p50_ms": _pct(vals, 50),
            "p95_ms": _pct(vals, 95),
            "max_ms": round(self.max, 1),
        }


class MetricsRegistry:
    """Thread-safe in-memory metrics. Sync FastAPI handlers run in a threadpool."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._http: Dict[str, Dict[str, Any]] = {}
        self._agents: Dict[str, Dict[str, Any]] = {}
        self._scenario = {"calls": 0, "cache_hits": 0, "errors": 0, "lat": _Lat()}
        self._gov = {"calls": 0, "redactions": 0, "injection_flags": 0,
                     "dropped_fields": 0, "pseudonymized": 0}

    def record_http(self, method: str, path: str, status: int, ms: float) -> None:
        key = f"{method} {path}"
        with self._lock:
            e = self._http.get(key)
            if e is None:
                e = self._http[key] = {"count": 0, "errors": 0, "lat": _Lat()}
            e["count"] += 1
            if status >= 500:
                e["errors"] += 1
            e["lat"].add(ms)

    def record_agent(self, agent: str, model: str, input_tokens: int,
                     output_tokens: int, ms: float, error: bool = False) -> None:
        with self._lock:
            e = self._agents.get(agent)
            if e is None:
                e = self._agents[agent] = {
                    "calls": 0, "errors": 0, "input_tokens": 0,
                    "output_tokens": 0, "est_cost_usd": 0.0, "lat": _Lat(),
                }
            e["calls"] += 1
            if error:
                e["errors"] += 1
            e["input_tokens"] += input_tokens
            e["output_tokens"] += output_tokens
            cost = estimate_cost_usd(model, input_tokens, output_tokens)
            if cost:
                e["est_cost_usd"] = round(e["est_cost_usd"] + cost, 6)
            e["lat"].add(ms)

    def record_governance(self, report: Dict[str, Any]) -> None:
        with self._lock:
            g = self._gov
            g["calls"] += 1
            g["redactions"] += int(report.get("redactions", 0))
            g["injection_flags"] += int(report.get("injection_flags", 0))
            g["dropped_fields"] += len(report.get("dropped_fields", []))
            g["pseudonymized"] += len(report.get("pseudonymized", []))

    def record_scenario(self, ms: float, cached: bool, error: bool = False) -> None:
        with self._lock:
            s = self._scenario
            s["calls"] += 1
            if cached:
                s["cache_hits"] += 1
            if error:
                s["errors"] += 1
            s["lat"].add(ms)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            http = {k: {"count": v["count"], "errors": v["errors"], **v["lat"].snapshot()}
                    for k, v in self._http.items()}
            agents = {}
            total_cost = 0.0
            for a, v in self._agents.items():
                total_cost += v["est_cost_usd"]
                agents[a] = {
                    "calls": v["calls"], "errors": v["errors"],
                    "input_tokens": v["input_tokens"], "output_tokens": v["output_tokens"],
                    "est_cost_usd": round(v["est_cost_usd"], 6),
                    "latency": v["lat"].snapshot(),
                }
            scenario = {
                "calls": self._scenario["calls"],
                "cache_hits": self._scenario["cache_hits"],
                "errors": self._scenario["errors"],
                "latency": self._scenario["lat"].snapshot(),
            }
            governance = dict(self._gov)
        return {
            "http": http,
            "agents": agents,
            "scenario": scenario,
            "governance": governance,
            "totals": {"agent_est_cost_usd": round(total_cost, 6)},
        }
