# Production readiness: the agent service

The dashboard agents and what-if scoring are demo-ready today. This is the plan
to make them production-ready for migration into Welo's environment, where they
will process **real employee health data**. It mirrors the discipline of the ML
pipeline (modular, reproducible, documented) and adds what a live, non
deterministic, data-handling service needs on top.

## Decisions on record

Confirmed with the team, these shape the build:

- **Auth (cost-driven).** The proxy exists to stop strangers spending Welo's
  Anthropic budget. The control is a **hard Anthropic spend cap** plus app-level
  **token budgeting and per-client rate limits**, not an expensive gateway. For
  Welo's internal deployment, Cloud Run "require authentication" via their SSO /
  IAP is near-free and preferred over a shared secret; the public demo keeps the
  rate-limit + spend-cap guardrails.
- **Observability (cost-conscious, scale-aware).** Structured JSON logs plus
  OpenTelemetry-style output: vendor-neutral, native and cheap on Cloud
  Logging / Monitoring now, portable to anything later with no code change. No
  per-seat tooling.
- **Data governance (elevated to first-class).** Real health data will be sent
  for scoring. Health data is "special personal information" under POPIA, so we
  add PII redaction, a clear processing boundary, a documented data-flow and
  Anthropic retention / DPA posture, and prefer sending **derived / de-identified
  features rather than raw records** wherever the model allows it.

## What "production-ready" means here (vs the ML pipeline)

The pipeline is a batch job: correct, reproducible, documented. The agent layer
adds three hard properties:

1. It is a **live service**: uptime, latency, observability, cost per call.
2. It is **non-deterministic**: quality is measured with an **evaluation
   harness** (the analog of `model_metrics.json`), not exact-output unit tests.
3. It handles **real personal health data**: governance, redaction and a
   defensible data-flow are requirements, not polish.

## Phased plan

Each phase ships independently and leaves the service releasable.

### Phase 1 - Foundations  (DONE)

- `model/pyproject.toml`: installable, pinned package with `dev` extras.
- Test suite (`model/tests/`): deterministic unit tests for the scenario engine
  and agent logic (no model/network), plus integration tests that load the real
  model. `ruff` clean.
- Service documentation: `welo_inference/SERVICE_README.md`, this roadmap, and
  the runbook.

### Phase 2 - Agent evaluation harness  (DONE)

- `welo_inference/evals/`: golden cases per agent (`cases.py`) with deterministic
  property checks (`checks.py`): grounded in the supplied data (no fabricated
  large figures), amounts in Rand, no dashes, no disciplinary use, and an
  adversarial pair that must refuse to turn the scores into dismissals.
- `runner.py` aggregates a report; `python -m welo_inference.evals` runs it live
  against the Anthropic-backed agents, writes `reports/agent_eval.json` (the
  `model_metrics.json` analog), and exits non-zero if the pass rate is below the
  threshold, so Phase 5's CI can block a regression.
- The checks are decoupled from the live model via a `run_fn`, so the harness is
  unit-tested offline with good and bad stub responders (`tests/test_evals.py`)
  that prove each check fires. No key needed to test the harness itself.

### Phase 3 - Observability & cost

- Structured JSON logs with a request id on every line.
- Token, cost and latency captured per agent call; a lightweight metrics
  surface. Cost attribution per agent and per tenant.

### Phase 4 - Security & data governance  (highest-stakes)

- PII redaction before any data leaves the process; a de-identification boundary
  so raw health records are not sent where derived features suffice.
- Prompt-injection handling for free-text that arrives with real client data.
- Auth as above (IAP for internal; keyed + capped for public).
- Data-flow document: what is collected, what leaves to Anthropic, retention,
  DPA, POPIA lawful-basis and special-information safeguards.

### Phase 5 - CI/CD

- GitHub Actions: `ruff` + `pytest` + the Phase 2 eval gate on every PR, then
  build and deploy. Image digests pinned.

## Status

| Phase | State |
| --- | --- |
| 1 Foundations | Done |
| 2 Agent evaluation | Done |
| 3 Observability & cost | Not started |
| 4 Security & governance | Not started |
| 5 CI/CD | Not started |
