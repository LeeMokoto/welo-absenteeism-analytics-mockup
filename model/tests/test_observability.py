"""Unit tests for observability: JSON formatter, cost model, metrics registry.

No model or network required.
"""

from __future__ import annotations

import json
import logging

from welo_inference.observability import (
    JsonFormatter,
    MetricsRegistry,
    estimate_cost_usd,
    reset_request_id,
    set_request_id,
)


def _record(msg="hello", **extra):
    rec = logging.LogRecord("welo.test", logging.INFO, __file__, 1, msg, None, None)
    for k, v in extra.items():
        setattr(rec, k, v)
    return rec


def test_json_formatter_basic():
    d = json.loads(JsonFormatter().format(_record("hi")))
    assert d["severity"] == "INFO"
    assert d["message"] == "hi"
    assert d["logger"] == "welo.test"
    assert "timestamp" in d


def test_json_formatter_includes_extras_and_request_id():
    rec = _record("evt", event="agent_call", input_tokens=10)
    token = set_request_id("abc123def")
    try:
        d = json.loads(JsonFormatter().format(rec))
    finally:
        reset_request_id(token)
    assert d["event"] == "agent_call"
    assert d["input_tokens"] == 10
    assert d["request_id"] == "abc123def"


def test_cost_estimate():
    assert estimate_cost_usd("claude-opus-4-8", 1_000_000, 0) == 5.0
    assert estimate_cost_usd("claude-opus-4-8", 0, 1_000_000) == 25.0
    assert estimate_cost_usd("claude-haiku-4-5", 1_000_000, 1_000_000) == 6.0
    assert estimate_cost_usd("unknown-model", 100, 100) is None


def test_registry_agent_aggregation():
    m = MetricsRegistry()
    m.record_agent("analyst", "claude-opus-4-8", 1000, 500, 120.0)
    m.record_agent("analyst", "claude-opus-4-8", 2000, 1000, 80.0)
    a = m.snapshot()["agents"]["analyst"]
    assert a["calls"] == 2
    assert a["input_tokens"] == 3000
    assert a["output_tokens"] == 1500
    assert a["est_cost_usd"] > 0
    assert a["latency"]["count"] == 2
    assert m.snapshot()["totals"]["agent_est_cost_usd"] > 0


def test_registry_scenario_and_http():
    m = MetricsRegistry()
    m.record_scenario(50.0, cached=False)
    m.record_scenario(2.0, cached=True)
    m.record_http("POST", "/scenario", 200, 50.0)
    m.record_http("POST", "/scenario", 500, 10.0)
    s = m.snapshot()
    assert s["scenario"]["calls"] == 2
    assert s["scenario"]["cache_hits"] == 1
    assert s["http"]["POST /scenario"]["count"] == 2
    assert s["http"]["POST /scenario"]["errors"] == 1


def test_error_agent_call_counted():
    m = MetricsRegistry()
    m.record_agent("case", "claude-opus-4-8", 0, 0, 5.0, error=True)
    a = m.snapshot()["agents"]["case"]
    assert a["calls"] == 1 and a["errors"] == 1
