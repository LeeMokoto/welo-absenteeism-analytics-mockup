# Data governance and POPIA posture

How the Welo agent service handles personal data, and the controls that make it
defensible once **real employee health data** flows through it. The demo uses
synthetic data; this document governs the move to live client data.

## Data classification

The service processes employee health and workload attributes (BMI, smoking,
alcohol, sleep, fatigue, absence). Under South Africa's Protection of Personal
Information Act (POPIA), health data is **special personal information**
(section 26), which carries a higher bar: processing needs a specific ground
(section 27), and the security safeguards of section 19 apply.

## Data-flow and the processing boundary

```
Client HR / health data
      |
      v
Welo model scoring  (welo_inference, in the client's cloud project)
      |  model output: predictions, drivers, cohort aggregates
      v
Governance boundary  (governance.sanitize)   <-- nothing crosses without this
      |  minimised + de-identified grounding
      v
Anthropic Messages API  (agent reasoning only)
```

The trained model runs **inside the client's environment**. Only the model's
*output* (predictions, drivers, cohort aggregates) is ever considered for the
agent step, and even that passes through the governance boundary first.

## What leaves to Anthropic, and what does not

`welo_inference/governance.py` runs on every agent request before anything is
sent:

- **Direct identifiers are dropped** (names, email, phone, ID number, address,
  date of birth, next of kin, ...): removed entirely, never sent.
- **Id fields are pseudonymised** (`employee_id` and friends) with a keyed
  HMAC-SHA256 so the agent can refer to "this employee" without the real id. Set
  `WELO_PSEUDONYM_SALT` to a secret so pseudonyms are not guessable or linkable
  across environments.
- **Free-text values are redacted** for email, SA ID number and phone patterns,
  in case identifiers hide in a notes field.
- **Prompt-injection is neutralised** in any free text (instruction-like phrases
  are stripped), so untrusted content in real client data cannot steer the agent.

The agents are additionally instructed to reason only from the supplied data and
never to recommend disciplinary use (see `AGENTS.md`), and this is enforced by
the evaluation harness (`welo_inference/evals`).

## LLM provider: Anthropic API vs Vertex AI

The agent layer can call Claude through one of two providers, selected with
`WELO_LLM_PROVIDER` (see `welo_inference/config.py`). This choice materially
affects the data-flow, the responsible processor and the cross-border-transfer
analysis, so it is a governance decision, not just a deployment detail.

| | `anthropic` (default) | `vertex` |
| --- | --- | --- |
| Endpoint | Anthropic API | Claude on Google Vertex AI |
| Auth | API key (Secret Manager) | GCP IAM / service account (no key) |
| Processor | Anthropic | Google (Vertex), running Claude |
| Data location | Anthropic infrastructure | The Google region you pin (`WELO_VERTEX_REGION`) |
| Contract | Anthropic DPA | Google Cloud DPA / CDPA |
| Best for | Public demo | Welo's real deployment |

The **demo runs on `anthropic`**. For the **real deployment we recommend
`vertex`**: the request stays inside Welo's own Google project and a chosen
region, authentication is Google IAM (no long-lived key to leak or rotate), and
the processor relationship is covered by the Google Cloud DPA Welo already holds
for the rest of its Google estate. The governance boundary
(`governance.sanitize`) runs identically on both paths, so minimisation and
de-identification are unchanged.

## Cross-border transfer, retention and the DPA

Where the agent request goes depends on the provider above.

**Anthropic provider.** Anthropic's API is operated outside South Africa, so
agent use is a **cross-border transfer** under POPIA section 72. Before go-live
with real data on this path, Welo must:

- Execute Anthropic's **Data Processing Addendum** and confirm the
  **zero-retention / no-training** posture for the API (Anthropic does not train
  on API traffic; a DPA and, where offered, zero-retention should be in place).
- Record the transfer ground (adequate protection via the DPA, or data-subject
  consent).

**Vertex provider.** The request is processed by **Google** in the region set by
`WELO_VERTEX_REGION`. Pinning a region (for example an EU region, or Google's
data-residency commitments) can keep the processing within a chosen jurisdiction
and narrows or removes the section 72 transfer question depending on the region
chosen. The applicable contract is Welo's **Google Cloud DPA**, and Anthropic's
terms for Claude-on-Vertex confirm the same no-training posture on prompts and
outputs. Record the region and the transfer basis in the POPIA documentation.

**Either path**, Welo must complete a short **DPIA** for the special-information
processing.

The service holds no personal data at rest: model artifacts and the dashboard
feed are baked into the image; the cache and metrics are in-memory and reset on
restart.

## Access control

Two low-cost methods (`welo_inference/auth.py`):

- **Cloud IAP** for Welo's internal deployment: IAP authenticates staff upstream
  and sets a signed assertion header; set `WELO_TRUST_IAP=1` and restrict ingress
  to IAP. Preferred for the environment that touches real data.
- **Shared API key** (`X-API-Key`) for the public demo, with the Anthropic spend
  cap and per-client rate limiting as the cost guardrails.

Set `WELO_REQUIRE_AUTH=1` in any environment with real data so an unauthenticated
request is refused. Lock `WELO_CORS_ORIGINS` to the dashboard origin.

## Audit trail

Every agent call emits an `agent_call` log event with a `request_id` and the
governance counts (redactions, dropped fields, injection flags) but **never the
personal values themselves**. Aggregates are exposed at `GET /metrics` under
`governance`. This gives a defensible record of what was minimised without
creating a second copy of the personal data.

## Data-subject rights and retention

- Because the service keeps no personal data at rest, access / deletion requests
  are served from the client's source systems, not here.
- Pseudonymised ids are one-way (keyed hash); rotating `WELO_PSEUDONYM_SALT`
  breaks linkability.
- Model retraining and the source feed are governed by the model pipeline, not
  this service.

## Responsibilities before go-live (checklist for Welo)

- [ ] LLM provider chosen and recorded (`WELO_LLM_PROVIDER`). Vertex is
      recommended for the real-data environment; if Anthropic, the Anthropic DPA
      is signed and the zero-retention / no-train posture confirmed. If Vertex,
      the Google Cloud DPA covers it and `WELO_VERTEX_REGION` is pinned to an
      approved region.
- [ ] DPIA completed for the special-information processing.
- [ ] `WELO_PSEUDONYM_SALT` set to a managed secret.
- [ ] `WELO_REQUIRE_AUTH=1` and IAP (or key) enforced; ingress restricted.
- [ ] `WELO_CORS_ORIGINS` locked to the dashboard origin.
- [ ] Lawful ground and cross-border transfer basis recorded in Welo's PAIA /
      POPIA documentation.
- [ ] Review the field denylist / id list in `governance.py` against the real
      client schema so no new identifier field is missed.

The controls in code are necessary but not sufficient on their own: the
checklist items above are organisational and must be completed by Welo's
information officer.
