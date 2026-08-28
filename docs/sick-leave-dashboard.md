# Sick Leave Intelligence dashboard

A Next.js App Router sibling to the static absenteeism dashboard, built on
statutory sick leave. Route: `/sick-leave`. Synthetic sample data only, sized to
look like a mining division (4,200 employees, four sites). No client data.

## The constraint that shapes it

Sick leave intelligence here is oriented at **care pathways and workforce
planning, never HR review or disciplinary use**. This is a POPIA position, not a
tone preference. In code that means:

- No individual-level pattern features exist anywhere: no day-of-week adjacency,
  no post-payday clustering, no spell-frequency "suspicion" score, no
  credibility indicator. The data generator documents their deliberate absence.
- Day-of-week and seasonality are cohort-level planning inputs only.
- Entitlement position is neutral planning context on a record, never a flag or
  a colour-coded warning.
- No employee names anywhere; pseudonymous ids only (`EMP-#####`).
- ICD-10 is stored and shown at **chapter level only**. Aggregate cells under
  five employees are suppressed and shown as `n<5`.

## Layout

```
app/
  layout.jsx                     root layout, brand fonts, globals.css
  page.jsx                       root, links to /sick-leave
  globals.css                    Welo brand tokens + component styles
  sick-leave/
    page.jsx                     server: reads key presence, renders the app
    SickLeaveApp.jsx             client: tabs across the three screens
  api/sick-leave/agent/route.js  server: the agent proxy (key stays here)
components/sick-leave/            all screen + shared components
lib/sick-leave/
  costModel.js                   indicative, editable cost constants
  agentMeta.js                   client-safe agent role/description/chips
  agentPrompts.js                server-only system prompts (verbatim)
  context.js                     builds the grounding object per screen
  format.js                      Rand / percent / n<5 helpers
  sampleData.js                  GENERATED: meta + aggregates + light index
  sampleData.employees.js        GENERATED: full records (case view only)
  sampleData.events.js           GENERATED: spell history (case view only)
scripts/generate-sick-leave-data.mjs   deterministic generator
```

## Run it

```bash
npm install
npm run generate-data     # regenerate the checked-in sample data (optional)
npm run dev               # http://localhost:3000/sick-leave
```

The page renders standalone with **no environment variable set**: the three
agent panels show a clear disabled state and everything else works. To enable
the agents, set the server-side key before starting:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
# optional model override (default claude-sonnet-4-6):
export SICK_LEAVE_AGENT_MODEL=claude-sonnet-4-6
npm run dev
```

The key is read only in `app/api/sick-leave/agent/route.js` and in
`app/sick-leave/page.jsx` (as a boolean). It never reaches the client bundle.

## The agents

One server route, three identifiers (`analyst`, `case`, `coordinator`). Each
receives a compact JSON context assembled from the figures on its screen and
reasons over that and nothing else. Every response carries the human-in-the-loop
line: *Generated from the sample figures on this screen. A human decides the
action.* The Case Assistant carries a hard constraint: it produces care and
support actions only and declines any disciplinary, legitimacy, timing-pattern
or colleague-comparison request.

## Compliance controls in the product

Persistent non-dismissible sample-data banner; `MODELLED` (never `LIVE`) on the
risk score; indicative labels on every Rand figure; `n<5` suppression on
chapter-cut aggregates and the concentration matrix; the human-in-the-loop line
under every agent response; a governance note in the footer; and a visibly gated
case view with a simulated audit log (the `allowedRoles` prop and `onRecordOpen`
callback are threaded through, stubbed).

## Verified

`npm run build` compiles and type-checks clean. Verified by grep on the built
output: no employee name fields in the data, no `LIVE` claim, `ANTHROPIC_API_KEY`
and the system prompts absent from `.next/static`. The API rejects an unknown
agent (400) and refuses without a key (503).

## Needs a live key to verify (not runnable here)

Two acceptance checks require a configured `ANTHROPIC_API_KEY` and so were not
executed in this build. The behaviour is implemented via the verbatim system
prompts; run these before shipping:

- The Case Assistant declines all three test prompts (genuine-looking pattern,
  disciplinary write-up, colleague comparison) and offers the support plan.
- All three agents refuse to invent a figure absent from the supplied context.

## Deploy (Cloud Run, the same as the absenteeism service)

The app ships as a container (`Dockerfile` at the repo root, Next.js standalone
output) and deploys on Cloud Run through the same Terraform stack as the
inference service, reading the Anthropic key from the same Secret Manager secret.

```bash
# build + push the image (Cloud Build), paste the ref into your *.tfvars
infra/scripts/build_and_push_sick_leave.sh YOUR_PROJECT_ID europe-west1

cd infra/terraform
terraform apply -var-file=demo.tfvars           # brings up both services
terraform output sick_leave_url                 # the dashboard URL

# turn the agents on once the key is in the shared secret
terraform apply -var-file=demo.tfvars -var="sick_leave_enable_agents=true"
```

The key is injected as `ANTHROPIC_API_KEY` at runtime and never baked into the
image. With agents off, the dashboard renders with the three panels disabled.
Full deploy and migration notes are in [`../infra/README.md`](../infra/README.md).

The app does not yet support the Vertex path that the inference service has; it
uses the first-party Anthropic key. Vertex parity for this route is a
self-contained follow-up (the `@anthropic-ai/vertex-sdk` client plus a provider
switch, mirroring `model/welo_inference/agents.py`).

## Coexistence and the routes

The deployment serves both dashboards:

| Route | What it is |
| --- | --- |
| `/` | Branded hub linking both products |
| `/absenteeism` | The original static dashboard (redirects to `/absenteeism/index.html`) |
| `/sick-leave` | This Next.js app |
| `/api/sick-leave/agent` | The agent proxy (server side, holds the key) |

The original `index.html` is not edited or duplicated in git. A prebuild step
(`scripts/stage-static-dashboard.mjs`, wired to npm's `prebuild`) copies it plus
the assets it actually loads (`config/*.js` and the three `dashboard_feed.*.js`
files) into `public/absenteeism/`, mirroring the same relative layout so the HTML
works unmodified. `public/absenteeism/` is generated and git-ignored.

`/absenteeism` is a **redirect**, not a rewrite, and that is deliberate:
`index.html` loads its config and feed by relative path, so serving it at a URL
without a trailing segment would resolve `config/industry.js` to
`/config/industry.js` and 404. A trailing-slash rewrite is not an option either,
because Next normalises `/absenteeism/` back to `/absenteeism` and would loop.

The Python inference service under `model/` is unchanged and deploys
independently; the absenteeism dashboard reaches it with `?api=<service_url>`.
