"""Integration tests for the HTTP service.

Marked ``integration`` because they load the real trained artifacts and score
through the model. Run just these with ``pytest -m integration``; skip them with
``pytest -m 'not integration'`` on a machine without the model deps.
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path

import pytest

MODEL_DIR = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def client():
    models = MODEL_DIR / "models"
    feed = MODEL_DIR / "data" / "outputs" / "dashboard_feed.json"
    if not (models / "regressor.joblib").exists() or not feed.exists():
        pytest.skip("trained model artifacts or feed not present")

    os.environ["WELO_MODELS_DIR"] = str(models)
    os.environ["WELO_FEED_PATH"] = str(feed)
    os.environ.pop("ANTHROPIC_API_KEY", None)
    os.environ.pop("WELO_ANTHROPIC_API_KEY", None)

    # Reset the cached config singleton so it re-reads our env, then load app.
    import welo_inference.config as cfg
    cfg._singleton = None
    from fastapi.testclient import TestClient
    main = importlib.import_module("welo_inference.main")
    importlib.reload(main)

    with TestClient(main.app) as c:
        yield c


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["model_loaded"] is True


def test_readyz(client):
    assert client.get("/readyz").json()["status"] == "ready"


def test_agents_offline_without_key(client):
    body = client.get("/agents").json()
    assert body["available"] is False
    assert body["reason"]


def test_scenario_levers(client):
    names = {lv["name"] for lv in client.get("/scenario/levers").json()["levers"]}
    assert "overtime_pct" in names


def test_scenario_happy_path(client):
    r = client.post("/scenario", json={"adjustments": {"overtime_pct": -20}})
    assert r.status_code == 200
    body = r.json()
    assert body["cohort"]["covered_lives"] > 0
    assert body["delta"]["predicted_absent_days_90d"] >= 0
    assert body["cached"] is False


def test_scenario_is_cached_on_repeat(client):
    payload = {"adjustments": {"sleep_delta": 0.5}, "dimension": None, "cohort": None}
    first = client.post("/scenario", json=payload).json()
    second = client.post("/scenario", json=payload).json()
    assert first["cached"] is False
    assert second["cached"] is True
    assert first["delta"] == second["delta"]


def test_scenario_bad_lever_is_422(client):
    r = client.post("/scenario", json={"adjustments": {"overtime_pct": -999}})
    assert r.status_code == 422


def test_scenario_unknown_cohort_is_422(client):
    r = client.post("/scenario", json={
        "adjustments": {"overtime_pct": -10},
        "dimension": "cohort_load",
        "cohort": "Nonexistent cohort",
    })
    assert r.status_code == 422


def test_request_id_header_present(client):
    r = client.get("/healthz")
    assert r.headers.get("X-Request-ID")


def test_request_id_is_echoed_when_supplied(client):
    r = client.get("/healthz", headers={"X-Request-ID": "test-rid-123"})
    assert r.headers.get("X-Request-ID") == "test-rid-123"


def test_metrics_endpoint_counts_scenario_and_http(client):
    client.post("/scenario", json={"adjustments": {"overtime_pct": -15}})
    body = client.get("/metrics").json()
    assert set(body) >= {"http", "agents", "scenario", "governance", "totals"}
    assert body["scenario"]["calls"] >= 1
    assert any(k.startswith("POST /scenario") for k in body["http"])
