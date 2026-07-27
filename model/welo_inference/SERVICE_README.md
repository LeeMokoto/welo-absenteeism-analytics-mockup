# Welo inference & agent service

The runtime side of Welo: it loads the trained absenteeism model once at startup
and answers HTTP requests in memory. Three capabilities sit on the same FastAPI
app:

1. **Scoring** (`/score`) - per-employee predictions from the trained model.
2. **What-if** (`/scenario`) - re-score a real cohort through the model when an
   operational lever is pulled. Deterministic, no LLM, no key.
3. **Agents** (`/agents`) - Anthropic-powered Analyst, Case Assistant and Cover
   Coordinator that reason over the model output. Key stays server-side.

For the agent design and guardrails see [`AGENTS.md`](AGENTS.md). For deployment
see [`../../infra/README.md`](../../infra/README.md). For the production
hardening roadmap and the ops runbook see
[`../../docs/production-readiness.md`](../../docs/production-readiness.md) and
[`../../docs/runbook.md`](../../docs/runbook.md).

## Architecture

```
Browser (dashboard, static)
        |  HTTPS
        v
welo_inference (FastAPI, Cloud Run)         <- holds ANTHROPIC_API_KEY
  service.py    InferenceService: loads models/ + feed, scores in memory
  scenario.py   deterministic what-if re-scoring
  agents.py     AgentService: Anthropic Messages API, grounded, guarded
  main.py       routes, CORS, rate limit, cache, health/readiness
  config.py     all runtime knobs from env
        |  HTTPS (only for the agent routes)
        v
Anthropic Messages API
```

The service is stateless: model artifacts and the dashboard feed are baked into
the image; the what-if cache and rate-limit buckets are in-memory and safe to
lose on restart.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/healthz` | none | Liveness + model-loaded flag |
| GET | `/readyz` | none | Readiness (503 until the model is loaded) |
| GET | `/metadata` | none | Model version, features, metrics, provenance |
| GET | `/feed` | none | Cached dashboard payload |
| POST | `/score` | optional key | Per-employee predictions |
| POST | `/score/explain` | optional key | As above, always with SHAP reasons |
| GET | `/scenario/levers` | none | The what-if levers and their bounds |
| POST | `/scenario` | optional key + rate limit | Re-score a cohort before/after a lever |
| GET | `/agents` | none | Whether the AI agents are configured |
| POST | `/agents/{agent}` | optional key | Non-streaming agent answer |
| POST | `/agents/{agent}/stream` | optional key | Streamed (SSE) agent answer |
| GET | `/metrics` | optional key | Token, cost and latency counters (see Observability) |

Interactive OpenAPI docs are served at `/docs`.

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `WELO_MODELS_DIR` | `models` | Trained artifacts directory |
| `WELO_FEED_PATH` | `data/outputs/dashboard_feed.json` | Cached dashboard feed |
| `WELO_API_KEY` | (unset) | If set, `/score` and agent routes require `X-API-Key` |
| `WELO_CORS_ORIGINS` | `*` | Comma-separated browser allowlist; lock down in prod |
| `ANTHROPIC_API_KEY` / `WELO_ANTHROPIC_API_KEY` | (unset) | Enables the AI agents |
| `WELO_AGENT_MODEL` | `claude-opus-4-8` | Model the agents call |
| `WELO_AGENT_TIMEOUT_S` | `60` | Per-call Anthropic timeout |
| `WELO_AGENT_MAX_RETRIES` | `2` | Anthropic transient-error retries |
| `WELO_RATE_LIMIT_PER_MIN` | `60` | Per-client cap on `/scenario` (0 disables) |
| `WELO_LOG_FORMAT` | `json` | `json` (Cloud Logging native) or `text` (local dev) |
| `WELO_LOG_LEVEL` | `INFO` | Root log level |
| `WELO_HORIZON_DAYS` | `90` | Prediction horizon |

## Local development

```bash
cd model
pip install -e .[dev]          # installs the service + test/lint deps
uvicorn welo_inference.main:app --reload --port 8080
# open http://localhost:8080/docs
```

The what-if panel and `/scenario` work with no key. To exercise the agents,
`export ANTHROPIC_API_KEY=sk-ant-...` before starting.

## Tests and lint

```bash
cd model
pytest -m "not integration"    # fast unit tests: scenario engine + agent logic
pytest                          # + integration tests that load the real model
ruff check welo_inference tests
```

The unit tests need no model or network. The integration tests load the trained
artifacts from `models/` and score through them; they self-skip if the artifacts
are absent. See [`tests/`](../tests).

## Agent evaluations

The agents are non-deterministic, so quality is measured with a property-based
eval harness (`welo_inference/evals/`) rather than exact-output tests. Golden
cases per agent are checked for: grounded figures (no fabricated large numbers),
Rand-only amounts, no dashes, no disciplinary use, and refusal of misuse.

```bash
cd model
export ANTHROPIC_API_KEY=sk-ant-...        # evals run against the live agents
python -m welo_inference.evals --out reports/agent_eval.json
```

It writes `reports/agent_eval.json` (the `model_metrics.json` analog) and exits
non-zero if the pass rate is below `--threshold` (default 1.0), so CI can block a
regression. The checks are unit-tested offline (no key) in
[`tests/test_evals.py`](../tests/test_evals.py).

## Observability

Vendor-neutral by design: structured logs plus in-memory metrics, no external
dependency.

- **Structured JSON logs** (`WELO_LOG_FORMAT=json`, the default): one JSON object
  per line with `severity`, `message`, a `request_id`, and structured
  `event` records (`http_request`, `agent_call`) carrying method/path/status,
  latency and token counts. Cloud Logging parses these natively; `text` format is
  available for local dev.
- **Request id**: every request gets an `X-Request-ID` (honoured if the caller
  sends one) that is echoed on the response and stamped on every log line for
  that request.
- **Metrics** at `GET /metrics` (protected by the optional key): per-agent call
  counts, input/output tokens, estimated USD cost and latency percentiles;
  per-route HTTP counts, errors and latency; scenario calls and cache hits; and a
  total estimated agent spend. In-memory and reset on restart, so point Cloud
  Monitoring or an OTel collector at it for retention. Cost is estimated from a
  per-model price table and is for attribution, not billing.

## Deployment

Containerised via [`../Dockerfile`](../Dockerfile), provisioned with Terraform in
[`../../infra`](../../infra). The agents switch on only once a real
`ANTHROPIC_API_KEY` is present; without it the service still serves scoring and
what-if, and reports the agents as unavailable so the dashboard degrades
gracefully.
