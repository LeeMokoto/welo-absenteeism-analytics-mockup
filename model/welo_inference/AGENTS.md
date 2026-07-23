# Welo dashboard agents (Anthropic Messages API)

The dashboard shows what the model predicts. The **agents** turn those numbers
into language an HR team can act on. They are powered by the Anthropic Messages
API and run **inside this inference service**, because the API key must never
reach the browser.

## Why a server-side proxy (the one hard rule)

`index.html` is a static file. Anything it ships is visible with view-source, so
an Anthropic API key placed in the page, or in a self-contained claude.ai
artifact, is a leaked key. There is no safe browser-only version.

So the shape is fixed:

```
Browser (dashboard)  ->  welo_inference (holds ANTHROPIC_API_KEY)  ->  Anthropic API
```

The browser calls this service; this service holds the key and calls Anthropic.
The dashboard never sees the key.

## The three agents

Each agent reasons only over the model output it is handed (grounding), never
free-floating text. They map onto the three dashboard audiences:

| Agent | Screen | What it does | Grounding it receives |
| --- | --- | --- | --- |
| `analyst` | Portfolio / Cohorts | Answers open questions about where absence and cost concentrate and the highest-leverage move | headline, risk distribution, cohort summary |
| `case` | Individual profile | Drafts a short support and return-to-work plan from an employee's drivers and fatigue signal | one individual record: prediction, drivers, cohorts, profile |
| `coordinator` | HR and Ops | Turns predicted cover-gap and overtime exposure into concrete rostering actions | HR-ops aggregates by operational cohort |

Guardrails are baked into every system prompt: reason only from the supplied
data, treat records as synthetic screening signals (not a diagnosis of a real
person), talk cohorts and interventions rather than surveillance, quantify in
Rand, stay brief, and no em or en dashes.

All three are wired into the dashboard: the **Analyst** as an ask-anything box
(with suggested prompts) at the foot of the Portfolio screen, the **Case
Assistant** on the Individual profile screen, and the **Cover Coordinator** at
the foot of the HR and Ops screen. Each panel shows a "Live" chip when a proxy
is configured and an "Offline demo" chip otherwise; the offline path is a
built-in, data-driven summary computed from the same grounding, so the
shareable static build still shows real figures.

## Live what-if scoring (the model, operated)

Beyond talking about the numbers, the service can **re-score a real cohort
through the trained model** when you pull an operational lever. This is
deterministic (no LLM, no key), so it works the moment the service is deployed.

- `GET /scenario/levers` - the levers you can pull and their bounds (cut
  overtime, add sleep, add an active day, fewer consecutive shifts, cap the
  leave gap, ease workload).
- `POST /scenario` - body `{adjustments, dimension?, cohort?}`, e.g.
  `{"adjustments": {"overtime_pct": -20}, "dimension": "cohort_load", "cohort": "High-intensity ops"}`.
  Returns baseline vs scenario aggregates plus the delta: absent days avoided
  (90d), Rand saved (annual), and how many people move out of high or critical.

It takes the individual records the model already scored, applies the change to
their inputs, and runs both baseline and scenario back through the SAME model, so
the before / after delta is apples to apples. The levers are bounded, results are
cached, and the endpoint is rate limited. The dashboard surfaces this as the
**Live what-if** panel on the Outcomes and ROI screen; the agents can call the
same engine as a tool (`scenario.run_scenario`).

## Reliability (built for a live demo)

- The Anthropic client is constructed with a timeout and automatic retries
  (`WELO_AGENT_TIMEOUT_S`, `WELO_AGENT_MAX_RETRIES`), so a transient blip does
  not hang or kill a call in front of a client.
- `available` requires a **resolvable API key**. The current SDK no longer
  raises at construction when the key is missing, so without this check the
  dashboard would show "Live" and then fail on the first call; instead it stays
  on the offline fallback until a key is actually present.
- What-if results are cached (same levers, same cohort, same answer) and
  `/scenario` is rate limited per client (`WELO_RATE_LIMIT_PER_MIN`).

## Configuration (environment variables)

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (none) | The API key. Set this at deploy time (Cloud Run secret / env). Never bake it into the image. |
| `WELO_ANTHROPIC_API_KEY` | (none) | Optional namespaced override, takes precedence over `ANTHROPIC_API_KEY`. |
| `WELO_AGENT_MODEL` | `claude-opus-4-8` | Model the agents call. Swap to `claude-sonnet-5` or `claude-haiku-4-5` to trade quality for cost. |
| `WELO_AGENT_THINKING` | `1` | Adaptive thinking on. Set `0` for slightly snappier, lighter turns. |
| `WELO_AGENT_TIMEOUT_S` | `60` | Per-call timeout for the Anthropic client. |
| `WELO_AGENT_MAX_RETRIES` | `2` | Automatic retries on transient API errors. |
| `WELO_RATE_LIMIT_PER_MIN` | `60` | Per-client cap on `/scenario`. Set `0` to disable. |

If no key is configured the service starts normally, `/agents` reports
`available: false`, and the dashboard falls back to its built-in summaries. The
model scoring endpoints (`/score`, `/feed`) are unaffected either way.

## Endpoints

- `GET /agents` - status: `{available, model, agents, reason}`. The dashboard
  polls this to choose live vs offline.
- `POST /agents/{agent}` - non-streaming. Body `{question, data}`. Returns
  `{agent, model, text, usage}`.
- `POST /agents/{agent}/stream` - Server-Sent Events. Each token is a `data:`
  line; the stream ends with `event: done`. This is what the dashboard uses so
  the panel fills in live.

Both POST routes honour the existing optional `X-API-Key` header
(`WELO_API_KEY`), same as `/score`.

## Wiring the dashboard to a deployed proxy

The dashboard talks to the proxy through `config/agents.js`. Point it at the
service either per-link or globally:

- Per link: `index.html?api=https://welo-inference-xxxx.run.app`
- Globally: set `window.WELO_API_BASE = "https://..."` before `config/agents.js`
  loads.

Lock down CORS in production with `WELO_CORS_ORIGINS` set to the dashboard
origin only.

## Cost

These are short, grounded turns (a few thousand tokens each way). Rough
per-interaction cost:

| Model | Approx per interaction |
| --- | --- |
| `claude-opus-4-8` | a couple of US cents |
| `claude-sonnet-5` | under a cent |
| `claude-haiku-4-5` | a fraction of a cent |

A full client demo session is cents, not dollars. The per-agent system prompt is
marked cacheable, so repeated calls in a session are cheaper still.

## Local run

```bash
cd model
pip install -r requirements.txt        # includes anthropic
export ANTHROPIC_API_KEY=sk-ant-...     # server-side only
uvicorn welo_inference.main:app --reload --port 8080
```

Then open `index.html?api=http://localhost:8080`. Without the key set, the same
page still works and shows the built-in summaries.
