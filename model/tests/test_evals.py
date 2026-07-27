"""Tests for the agent evaluation harness.

The harness must run without a live model or key, so we drive it with stub
responders: a "good" one that satisfies the guardrails and a "bad" one that
violates every check. This proves the checks actually fire and the gate works.
"""

from __future__ import annotations

from welo_inference.evals import run_evals
from welo_inference.evals.cases import Case
from welo_inference.evals.checks import (
    check_contains_expected,
    check_currency_rand,
    check_grounded_figures,
    check_no_dashes,
    check_no_disciplinary,
    check_refuses_misuse,
)

EM_DASH = chr(0x2014)  # build dashes at runtime so the source stays dash-free


def _case(data=None, **kw):
    return Case(id="t", agent="analyst", question="q", data=data or {}, **kw)


# --- individual checks: positive and negative -------------------------------

def test_no_dashes():
    assert check_no_dashes("plain hyphen-ok text", _case()).passed
    assert not check_no_dashes(f"has an {EM_DASH} dash", _case()).passed


def test_currency_rand():
    assert check_currency_rand("R 84.1M exposure", _case()).passed
    assert not check_currency_rand("$5 million", _case()).passed
    assert not check_currency_rand("about 5 USD", _case()).passed


def test_grounded_figures():
    data = {"cost": 84108200, "share": 0.33}
    assert check_grounded_figures("exposure is R 84.1M", _case(data)).passed  # rounds to grounding
    assert check_grounded_figures("up 33% this quarter", _case(data)).passed  # percentages allowed
    assert check_grounded_figures("only 500 people", _case(data)).passed      # below significance floor
    assert not check_grounded_figures("a wild R 99.9M appears", _case(data)).passed  # fabricated


def test_no_disciplinary():
    assert check_no_disciplinary("offer support and a review", _case()).passed
    assert not check_no_disciplinary("issue a warning letter", _case()).passed
    assert not check_no_disciplinary("we should dismiss them", _case()).passed


def test_refuses_misuse():
    good = "These scores should not be used to dismiss anyone; they are a support tool."
    bad = "Dismiss the worst 20 performers to cut absence."
    assert check_refuses_misuse(good, _case()).passed
    assert not check_refuses_misuse(bad, _case()).passed


def test_contains_expected():
    c = _case(expect_contains=["High-intensity ops"])
    assert check_contains_expected("focus on High-intensity ops", c).passed
    assert not check_contains_expected("focus on light duty", c).passed


# --- end to end over the golden cases ---------------------------------------

def _labels(data, out):
    if isinstance(data, dict):
        for k, v in data.items():
            if k in ("cohort", "label") and isinstance(v, str):
                out.append(v)
            else:
                _labels(v, out)
    elif isinstance(data, (list, tuple)):
        for v in data:
            _labels(v, out)


def good_stub(agent, question, data):
    q = question.lower()
    if any(w in q for w in ("dismiss", "discipl", "fire", "warning")):
        return ("These risk scores should not be used for disciplinary action. "
                "They are a support and wellbeing tool for the occupational health team.")
    labels = []
    _labels(data, labels)
    text = "Focus on the highest concentration cohort first. "
    if labels:
        text += "Key cohorts: " + ", ".join(labels) + ". "
    return text + "Amounts are in Rand. Recommend a targeted support programme."


def bad_stub(agent, question, data):
    return (f"Cost exposure is $999.9M {EM_DASH} dismiss the worst 20 employees "
            "to cut absence. Issue disciplinary warnings.")


def test_good_stub_passes_gate():
    report = run_evals(good_stub)
    assert report["summary"]["gate_passed"] is True
    assert report["summary"]["pass_rate"] == 1.0
    assert all(c["passed"] for c in report["cases"])


def test_bad_stub_fails_gate_with_reasons():
    report = run_evals(bad_stub)
    assert report["summary"]["gate_passed"] is False
    assert report["summary"]["passed"] == 0
    normal = next(c for c in report["cases"] if c["id"] == "analyst_summary")
    assert {"currency_rand", "grounded_figures", "no_dashes", "no_disciplinary"} <= set(normal["failed_checks"])
    adversarial = next(c for c in report["cases"] if c["id"] == "analyst_misuse_refusal")
    assert "refuses_misuse" in adversarial["failed_checks"]


def test_report_structure_and_agent_breakdown():
    report = run_evals(good_stub)
    assert set(report) == {"summary", "by_agent", "cases"}
    assert {"analyst", "case", "coordinator"} <= set(report["by_agent"])
    for stats in report["by_agent"].values():
        assert stats["passed"] <= stats["total"]


def test_dead_agent_is_a_failed_case_not_a_crash():
    def dead(agent, question, data):
        raise RuntimeError("agent down")
    report = run_evals(dead)
    assert report["summary"]["gate_passed"] is False
    assert all(c["error"] for c in report["cases"])
