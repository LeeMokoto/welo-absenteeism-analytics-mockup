# Design document alignment

Checks the statements in *Welo Absence Analytics Platform: Solution Design,
Standards and Governance* (7 October 2026) against what this repository
actually builds.

The document says its "statements of fact describe the platform as designed",
which is the right framing: most of the distance below is a design that runs
ahead of the build, and that is expected. This file separates the distance that
is fine from the distance that is not.

Three categories:

- **Contradicts**: the document and the code disagree. One of them is wrong,
  and a client reading the document would be misled by the code or the reverse.
- **Promised, not built**: the document commits to a control that does not
  exist yet. Fine while the document is read as design, not fine in an
  assessment response.
- **Aligned**: worth recording, because it is most of the governance substance.

Re-check this file when either side changes.

## Contradicts

### 1. Agent inference region

The document: "Claude is called through the Vertex AI eu multi-region endpoint,
which routes only within the European Union. The global endpoint routes to any
region with capacity and is never used." The POPIA section 72 row depends on it.

The code: `infra/terraform/variables.tf`, `vertex_region` defaults to
`us-east5`. A single US region, not the EU multi-region endpoint. The variable's
own description offers "us-east5 or europe-west1" as examples, and
`europe-west1` is a single region, which the document says serves Sonnet 4.6 and
earlier only.

A tenant provisioned on defaults would send inference to the United States while
the document tells the client it goes to the European Union under their written
section 72 approval. This is the most serious item here, because it is a
compliance statement rather than a configuration preference.

**Resolved.** The default is now `eu`, and `global` is refused by a variable
validation, because it routes to any region with capacity and so cannot support
a residency statement. A second validation rejects anything that is not a Vertex
location, so a typo such as `europe` fails at plan time rather than becoming an
outage once agents are on. Three tests hold it: the default is EU, the configured
location reaches the container as `WELO_VERTEX_REGION`, and both `global` and a
non-location are rejected. The variable's description no longer offers
`europe-west1` as a casual example, and `infra/README.md` matches.

### 2. Region lock

The document: "every resource in africa-south1", enforced by the
`gcp.resourceLocations` organisation policy.

The code: `region` defaults to `europe-west1`. `demo.tfvars.example` sets
`africa-south1`, so the demo is right, but the default is not, and there is no
organisation policy anywhere in the repository to catch it.

### 3. Critical image findings

The document, pipeline guardrails: "Image vulnerabilities | Artifact Registry
scanning | Blocks promotion of any image with a critical finding."

The code: `.github/workflows/ci.yml` scans with Trivy at CRITICAL and HIGH,
`ignore-unfixed: true`, and uploads to the security tab. It does not block. That
was a deliberate choice, documented in `docs/devsecops.md`: a base-image CVE with
no available fix would otherwise stop all work. The reasoning still holds, but
the document states the opposite as fact.

**Resolved, by splitting it.** Scanning now runs twice. The reporting pass is
unchanged: CRITICAL and HIGH, unfixed excluded, published to the security tab,
blocking nothing. A second gate pass covers CRITICAL with unfixed excluded and
exits non-zero, so a build stops exactly when the remedy is a version bump
somebody can make. An unfixable critical still blocks nothing, because a gate
that halts every branch gets switched off and is then worth nothing. The gate
runs after the upload, so a blocked build still publishes its findings.

The document should soften to "blocks on a critical finding with a fix
available", which is now true. It should also stop describing this as Artifact
Registry scanning: Trivy in CI fires before an image is ever pushed, which is
earlier and cheaper, and it is not a substitute for registry scanning of images
already published. The first is wording; the second is a real gap.

### 4. Customer-managed keys

The document: an organisation policy makes CMEK mandatory
(`gcp.restrictNonCmekServices`), and "Customer-managed keys protect the landing
bucket, every BigQuery dataset, the actions store and the tenant's log buckets."

The code: `modules/tenant` takes an optional `kms_key_name` defaulting to empty,
which means Google-managed keys. No key ring is created, no rotation schedule is
set, and the security log bucket has no CMEK at all. A tenant provisioned on
defaults has none of what the document promises.

### 5. Project naming and the project that now exists

The document: projects follow `welo-<tenant>-prod`, and its resource table names
`welo-demo-prod` for the demo tenant.

Actual: the project created for this work is `absenteeism-demo`, which matches
neither the pattern nor the table. Worth settling before more is built in it,
because a project cannot be renamed.

### 6. Project per tenant

The document: "Each tenant is a dedicated Google Cloud project with its own VPC
Service Controls perimeter, Cloud KMS key ring, identity configuration and
data", inside a Tenants folder with one sub-folder per tenant, under an
organisation holding eight projects.

The code: one project, with `var.tenants` as a map and `modules/tenant`
instantiated per entry. Isolation is by bucket, service account and
pseudonymisation key, not by project boundary. There is no landing zone module,
no folder structure and no organisation-level configuration.

This is the largest structural difference and it is already recorded as a gap in
`infra/README.md`. The configuration supports a tenant in its own project (a
separate state prefix and tfvars), so the path exists; the estate does not.

### 7. Data plane storage

The document's data plane is BigQuery throughout: datasets named `ingest`,
`pseudo`, `modelled`, `model`, `serving` and `reference`, authorised views,
policy tags on special personal information columns, table snapshots and time
travel.

The code has no BigQuery at all. Data is a landing bucket, a derived bucket and a
JSON feed. The serving boundary the document describes as IAM on a BigQuery
dataset is implemented as the platform service account holding read on the
derived bucket only, which is the same intent by a different mechanism, but the
column-level policy tags have no equivalent.

### 8. Named integrations

The document: "the signed-URL upload, Finch as the unified HR aggregator, and
direct BambooHR and Gusto connectors", each with "a real implementation and a
mock that speaks the identical contract".

The code: `model/welo_pipeline/adapters/` holds `base`, `synthetic`, `uci` and a
`glencore` stub. None of Finch, BambooHR or Gusto exists.

### 9. Application edge

The document: each tenant runs behind an external HTTPS load balancer with Cloud
Armor, on its own hostname.

The code: no load balancer, no Cloud Armor, no custom hostname. The platform runs
on Vercel or optionally on Cloud Run with a default URL. Cloud Armor was
deliberately removed from `modules/security-monitoring` when it was adapted,
precisely because there is no load balancer to attach it to.

## Promised, not built

### 1. Complementary suppression

**Fixed.** The document commits to it twice, and nothing implemented it. The
gap was demonstrated rather than inferred: forcing one cohort below the
threshold and rendering `/absence/outcomes` gave visible counts summing to
4,553 under a note stating 5,800 covered lives, so the suppressed cohort's
headcount was 1,247 exactly.

Withholding the total on that screen would not have been enough, because
`covered_cohort.count` is published on the portfolio screen as well: the margin
is available whatever any one screen does. So the fix hides a second cohort.
`apply_complementary_suppression` in `model/feed_enrich.py` now runs over every
cohort dimension and over `hr_ops.by_cohort`, and withholds the smallest
visible cohort whenever exactly one is suppressed. Subtraction then returns the
sum of two cohorts and splits no further, which leaves the suppressed one
inside the range the threshold already concedes.

The feed marks which suppression is which, and the screens say so. Labelling a
complementary suppression "fewer than 5 covered lives" would be a false
statement about a cohort that may hold thousands, shown to a client, and the
same text was being fed to the agents as grounding.

Covered by 17 tests in `model/tests/test_suppression.py`, including the
subtraction itself, and verified end to end against all four platform screens
and the standalone dashboard.

### 2. Lineage on screen

The document: "Serving views expose `data_as_of` and `model_version`, so every
screen, export and briefing carries both", and every risk score carries
`model_version` and `score_date` linked to a model run record.

Neither `data_as_of`, `model_version`, `score_date` nor `batch_id` appears
anywhere in the repository. The feed carries `run_name` and nothing else.

### 3. The tenant manifest standard

The document gives a twelve-field schema that the pipeline validates before any
deployment. Three fields are present, two are partial, seven are absent.

| Field | State |
| --- | --- |
| Tenant id | Present. Validated and documented as permanent. |
| Modules | Present. `absence`, `sick_leave`, `control_centre`. |
| Suppression threshold | Present. Validated at five or above on both the Terraform and application side. |
| Retention | Partial. Per tenant (`raw_retention_days`, `derived_retention_days`), not per layer as the document's table requires. |
| Agent position | Partial. A boolean `enable_agents`, not the three-way off / EU multi-region / first-party API with an approval reference. |
| Identity provider | Absent. |
| Upload schema | Absent from the manifest. `CANONICAL_COLUMNS` lives in code, and no minimum history window exists anywhere. |
| Upload access level | Absent. |
| Reporting dimensions | Absent from the manifest. Dimensions come from the feed. |
| Targeting dimensions | Absent. |
| Adapters | Absent. |
| Hostname | Absent. |

The pipeline guardrail the document names, "Blocks a suppression threshold below
five, a mock adapter in a client tenant, a missing agent position and a targeting
dimension outside the coarse list", enforces the first of four.

### 4. Model gating and the model run record

The document: a client tenant "serves no predictions until its own model has
trained on at least the minimum history window in its manifest, typically 12 to
24 months, and passed its backtest. Until then its dashboards show descriptive
analytics only." Drift is monitored at every rescore, a model below its baseline
is withdrawn, and every run is recorded with version, training window, backtest
results and status, shown on a model card.

None of that is implemented. There is no backtest against a naive baseline, no
withdrawal path, no descriptive-only mode and no drift monitoring.
`model/models/manifest.joblib` holds class labels and feature names only, so
there is no version, no training window and nothing to put on a model card.

`/absence/outcomes` does show the cross-validated metrics, and its copy used to
claim more than the code does: "A tenant model is backtested against a naive
baseline before its predictions are served, and withdrawn if it falls below that
baseline." That sentence described the document, not the repository.

**The copy is fixed.** The screen now says the metrics are cross-validated on
the training cohort, that this is not a backtest because there is no held-out
period, that the extract carries no time axis, and that neither the backtest nor
the withdrawal path is built. The rest of this item stands: the gating, the
drift monitoring and the model run record are still absent, and none of them can
be built until the schema carries a time axis.

Loading the artifacts also warns that they were pickled with scikit-learn 1.9.0
and are read by 1.9.1, which is the skew the model run record would catch.

### 5. Organisation guardrails

Seven organisation policies, none present. There are no `google_org_policy`
resources anywhere.

| Policy | State |
| --- | --- |
| `gcp.resourceLocations` | Absent |
| `gcp.restrictNonCmekServices` | Absent |
| `iam.disableServiceAccountKeyCreation` | Absent as a policy. The security module alerts on key creation, which is detective, not preventive. |
| `iam.allowedPolicyMemberDomains` | Absent |
| `storage.uniformBucketLevelAccess` | Set per bucket, not as a policy |
| `storage.publicAccessPrevention` | Set per bucket and asserted by test, not as a policy |
| `compute.vmExternalIpAccess` | Absent |

The two that are set per resource are the two that matter most for tenant data,
and a test enforces them, so the substance is better than the table suggests.
But the document's claim is that a tenant "inherits every organisation guardrail
and cannot weaken one", and per-resource settings can be weakened by editing the
resource. Organisation policies need organisation-level permissions, which a
project-scoped deployment does not have.

### 6. Runtime and pipeline guardrails

| Guardrail | State |
| --- | --- |
| VPC Service Controls perimeter per tenant | Absent |
| Egress allowlist through a tenant VPC | Absent. There is no VPC. |
| BigQuery column policy tags | Absent. There is no BigQuery. |
| Serving boundary | Present in substance: the application service account reads the derived bucket only, asserted by test. |
| Payload logging off | Present in substance: agent events carry no content, and nothing logs request bodies. |
| Agent guardrails in module code | Present. |
| Disclosure control | Partial: suppression yes, complementary suppression no, fixed dimensions partly, fixed periods no. |
| Binary Authorization and image signing | Absent |
| Encryption coverage policy check on the plan | Absent |
| Response contract tests | Partial. CI greps rendered pages for `employee_id` and `EMP\d+`; it is not an API contract test and does not look for `employee_key`, the identifier the document names. |
| Nightly drift plan per tenant | Absent |
| Terraform plan on every pull request | Partial. CI validates and runs the control tests but does not plan. The keyless identity to do it exists and is unused. |

### 7. Identity, roles and access

**Partly closed.** The document gives seven application roles, role checks in
the API, group-to-role mapping from the client's identity provider, Privileged
Access Manager for Welo access, and a sealed break-glass account.

All seven roles now exist and are enforced. `lib/platform/roles.js` holds the
permissions, every screen calls a route guard, the agent API refuses a role
without `use.agents`, and navigation is filtered to what a session can actually
open. A denial is a 403 rather than a hidden menu item, which is what the
document asks for: "role checks run in the API, so a hidden menu item is never
the only control".

What is still mocked is the identity, not the authorisation. There is no SAML
assertion and no OIDC exchange: an Entra-styled account picker sets a cookie
holding a role key. The cookie is unsigned and trivially forgeable, which is why
the whole mechanism refuses to run in a tenant that is not marked synthetic: no
sign-in page, no session, and therefore no access at all. A tenant with real
data fails closed rather than open.

Still absent: group-to-role mapping, Privileged Access Manager, and the sealed
break-glass account. `break_glass_principals` is wired into the security module,
so the detection is ready for an account that does not exist yet.

### 7a. The case view contradicts the role table

The document says "No role, including client admin, can see data below cohort
level." The Analyst row gives "HR, wellness and occupational health staff" the
Case Assistant, which sits on an individual case view this repository ships.
Both cannot hold.

Implemented as the role table reads, so Analyst holds `view.case` and a test
asserts no other role does. The cleaner resolution is probably to split Analyst
into an HR analyst without the case view and a clinical role with it, since the
current arrangement gives an HR business partner the same reach as an
occupational health nurse. That is a decision for the document rather than the
code.

`break_glass_principals` is wired into the security module, so the detection is
ready for an account that does not exist yet.

### 8. Audit event fields

The document: each agent call emits an `agent_call` event recording "the request
id, tenant, agent, model, token counts and governance counts with no content."

`model/welo_inference/main.py` emits `agent_call` with agent, model, input and
output tokens, latency and three governance counts, and no content. Close, and
the no-content part is the part that matters. Missing the request id and the
tenant, which are what make an event traceable to a session and attributable to a
client.

### 9. Three rings

The document: every release moves through staging, then demo, then client
tenants. There is one environment.

## Aligned

Most of the governance substance matches, which is worth stating plainly because
the lists above are longer.

- **POPIA roles.** Welo as operator, each employer as responsible party, matching
  `docs/data-governance.md` and `GovernanceNote.jsx`. The section 21 and 22 split
  on breach notification is stated correctly, and the section 26, 27 and 32
  citation for health information is right.
- **Data subject requests.** The employer supplies the identifier, ingest hashes
  it with the tenant key, Welo never holds the mapping. This matches the
  governance doc exactly, including the consequence that rotating the key breaks
  lookup for everything ingested before it. The provisioning script refuses to
  rotate a key that already holds a version for that reason.
- **Suppression floor.** Five or higher, enforced in `lib/platform/manifest.js`
  by clamping and in Terraform by validation, with a test asserting it cannot be
  lowered from either side.
- **No individual-level score from a module.** Asserted in the module guardrails,
  enforced by `scripts/build-absence-module-data.mjs` allow-listing aggregate
  sections and deleting the per-person ones, and checked in CI.
- **Case Assistant refusals.** The document names disciplinary,
  pattern-observation and genuineness-assessment requests.
  `modules/sick-leave/agentPrompts.js` refuses those three by name, plus
  colleague comparison framed as a concern and content for a capability process.
- **Model shape.** Gradient boosted over a 90-day horizon:
  `HistGradientBoostingRegressor` and `HistGradientBoostingClassifier`, and the
  feed's `predicted_absent_days_90d`. The open decision that names
  "scikit-learn on Cloud Run jobs" as the modelling fallback is what the repo
  already does.
- **Agents off by default.** `enable_agents` defaults false on every path, and a
  test asserts no secret binding exists without it.
- **No long-lived credential.** Workload identity federation for CI, `signBlob`
  for upload URLs, no `google_service_account_key` anywhere, asserted by test.
  This matches "No long-lived key exists anywhere in the platform".
- **Landing bucket as a transfer point.** Deleted after ingest with a lifecycle
  rule as the backstop: the rule exists at 30 days, and the document's wording
  matches.
- **Detective controls.** Alerts on break-glass use, IAM changes and KMS key
  changes all exist in `modules/security-monitoring`, along with audit config
  changes, logging tampering, public buckets and public Cloud Run services.
  Perimeter violations and Security Command Center findings do not, because
  neither exists.
- **Module content.** The BCEA entitlement burn panel and the ICD-10 chapter
  groupings the document attributes to the sick leave module are both built
  (`EntitlementBurn.jsx`, `ConditionMix.jsx`).
- **Agent grounding.** Cohort aggregates with no raw records or direct
  identifiers, and outputs not persisted. The browser sends only on-screen
  figures, which is also what keeps the inference cost at about a cent a call.

## Inconsistencies inside the document set

Not alignment issues, but worth resolving before a client reads them.

1. **Security Command Center tier, three answers.** The detective controls table
   states Premium as fact. The open decisions table lists "Security Command
   Center tier for staging and demo" as undecided before mobilisation. The
   `security-monitoring` module README supplied separately says Standard. The
   tiers differ materially in price.
2. **Agent position, prose against table.** The AI processing prose reads as
   though the EU multi-region endpoint is the route. The table immediately below
   makes "agents off" the default for every client tenant and the EU endpoint
   conditional on written approval. The table is the safer statement; the prose
   should match it.
3. **Platform project names.** The document says they "are proposed and are fixed
   when the landing zone is built", which is honest, but `welo-platform-state`
   and the rest appear as statements of fact in the resource table.

## Fixed since this check

- **Complementary suppression.** See above. The demonstrated leak is closed in
  the pipeline, on all four platform screens, on the standalone dashboard and
  in the agent grounding.
- **`roles/aiplatform.user` was granted whenever `llm_provider` was vertex,
  regardless of whether agents were on.** A client tenant whose recorded
  position is "agents off" would have held a service account able to call
  Vertex AI, so the permission preceded the client's written section 72
  approval. Now gated on `enable_agents` as well, with two tests asserting the
  permission is absent while agents are off and present when they are on.
- **The demo tenant was framed as a mining division, and the solution design
  describes mining clients.** The demo is the artifact distributed to
  prospective buyers, most of whom are not miners, so the tenant that ships is
  now a sector-neutral blue collar industrial employer. The mining framing is
  one selectable profile rather than the baseline. The decision is held by
  `lib/platform/demoVocabulary.test.mjs`, which fails if a named client or a
  word only one vertical uses reaches a demo surface.
- **The synthetic cohort was labelled `synthetic_mining_v1__glencore_sa_mining`,
  which named a client whose data was never used.** The label was misleading in
  both directions: it put a prospective buyer's competitor in the model card,
  and it implied Glencore data was in the training set when none was. Now
  `synthetic_industrial_v1__sa_shift_workforce`. The calibration anchor is
  unchanged and is stated plainly in the adapter docstring, `MODEL_README.md`
  and the README: the input distributions are anchored to published South
  African mining-cohort epidemiology, because that is the best-documented
  published source for a South African frontline workforce on a shift roster.
  Relabelling the provenance string changed no prediction, because
  `source_dataset` is carried alongside the feature matrix rather than inside
  it.
- **CI was not running the RBAC unit tests.** The step used the glob
  `modules/**/*.test.mjs`, which without `globstar` expands one level, so every
  test under `lib/` was silently skipped, including the role matrix added with
  the mocked sign-in. The step now names both roots and fails if it collects
  fewer test files than exist.
- **Nothing asserted the tenant manifest contract.** The environment variables
  Terraform emits are the only thing connecting the module to
  `lib/platform/manifest.js`, and a key added on one side and missed on the
  other produces a tenant that falls back to a default rather than failing. Two
  tests now assert the full key set and the descriptor's value, verified by
  removing the wiring and watching them fail.

- **`control.create` was held by no role, and creation was gated on
  `control.view`.** The permission existed, was referenced, and nobody had it,
  so the test asserting that no role can both create and approve passed on a
  vacuum. Meanwhile the control centre's create form was gated on
  `control.view`, which the Approver holds, so the role whose entire purpose is
  to approve what it did not create could create. Granted to Analyst and
  Prospect, the roles that act on cohorts; the Approver still cannot create. A
  new test fails if any permission is held by nobody, because that is either a
  missing grant or dead code and both make a test about who holds it pass for
  the wrong reason.
- **Creating an intervention had no server-side check at all.** The store is
  browser-local, which is not a reason to have no authorisation. There is now a
  write API that enforces `control.create`, revalidates the target against the
  targeting rules, refuses a record carrying an employee identifier rather than
  cleaning it, and stamps the creator from the session rather than the body, so
  a record cannot claim to have been drafted by somebody else. The persistence
  stays browser-local; when it becomes Cloud SQL it moves into that handler and
  nothing above it changes.
- **Playbooks exist, which makes `control.approve` mean something.** It was held
  by the Approver and consumed by nothing. See below.
- **A condition-data target was refused for the wrong reason.** Because
  `cohort_condition` is absent from this tenant's feed, the lookup missed and
  the refusal said "unknown dimension", which is true and teaches the wrong
  lesson: the reason is that it is condition data, and that does not depend on
  whether the feed reports it. Fixed, with a test over every never-targetable
  dimension.
- **The smoke test's employee-identifier leak check was measuring a dead
  port.** It ran after the first server was stopped, so curl returned nothing,
  grep found nothing in nothing, and it passed. Moved before the stop, and it
  now fails if the body is empty. Same class as the disabled-module check fixed
  earlier: a check that cannot fail reads as coverage.

## Control centre, phase 4: playbooks

Built. A playbook is the plan attached to an intervention: steps, the function
that owns each, a horizon, and a measure the platform actually reports. An agent
drafts it and a person decides it.

Four controls, each with tests written as the thing that must not get through:

1. A playbook carries no target of its own and inherits the intervention's, so a
   plan cannot reach a wider group than the record it hangs off. Carrying its
   own is refused even when the target would be valid.
2. No step names a person. An employee key, an email address, an identity
   number or a per-person field is refused rather than stripped, because a step
   whose meaning depended on a name is not the same step with the name removed.
3. No step may be a disciplinary action, an attendance-management action,
   surveillance of a person, or an employment consequence attached to a health
   measure. This is the one an agent draft drifts into while sounding helpful,
   so the refusal names the step and the line it crossed.
4. At least one step must name a reportable measure, or nothing can close the
   plan out and an intervention gets declared a success on no evidence.

Drafting is deliberately not streamed. A streamed draft reaches the screen
before anything has checked it, and a disciplinary step then reads as a
suggestion the product made. The whole draft is parsed and validated server
side, so what arrives is either a plan that passes or a refusal attributed to a
step.

Approval is separate from drafting by identity, not only by role: the drafter
cannot approve their own plan even if their role holds the permission, because
roles are configuration and this is the invariant. One seeded playbook is a
rejected agent draft that proposed a disciplinary step, kept rather than deleted
so the refusal is visible without anybody having to trigger one.

Honest limits. The drafting endpoint needs a configured agent, so in this
deployment it returns 503 and the screen says so rather than inventing a plan.
Decisions can only be recorded on playbooks drafted in the same browser, since
the seeded ones are shared and overwriting them would show the next visitor
somebody else's choice; the interface does not offer a button the store would
refuse. Outcome measurement is still blocked on the schema time axis, so a
playbook reports an observed difference against comparable cohorts over a fixed
period and says in as many words that this is not evidence it caused anything.

## Outcome tracking, built

The schema decision was monthly snapshots. The canonical extract is now 25
columns: `period_start` and `data_as_of` ahead of the 23 that were there.

`period_start` is the first day of the month a row describes. `data_as_of` is
when the extract was taken, which is a different thing and is why both exist: a
month is restated as late certificates arrive, so two extracts of the same month
disagree and neither is wrong. Without the second field a reader cannot tell
which vintage they are holding.

Both are **required**, not NA-filled. `BaseAdapter._coerce_to_canonical` used to
fill every missing canonical column with NA, which was fine for a body
measurement the imputer handles and became dangerous the moment the time axis
arrived: an extract with no period would have passed ingest and produced an
undated dataset that looks complete, surfacing months later as an outcome report
nobody can compute. Four columns are now refused rather than invented, and an
adapter for a source that genuinely has no period has to set one explicitly and
say so, which is what the UCI subset now does against its documented window.

### The four decisions

**Comparators freeze when the intervention is created.** Chosen after the
result, they are the ones that flatter it, and nobody doing that experiences
themselves as cheating. The write API picks them once, from the other reportable
cohorts of the same dimension, and stores them on the record. A caller-supplied
comparators field is ignored. There is no fallback to a live list: an
intervention with none is reported as unmeasurable, which is a better outcome
than a measurable one assembled in hindsight. One seeded record is deliberately
in that state so the refusal is visible.

**Cohort membership freezes at the baseline period.** `cohort_load` is banded on
within-period z-scores, so a roster change that lowers overtime would re-band
those people out of the high-load cohort and the group measured at the end would
not be the group the intervention named. The series fixes membership at baseline
and follows it, and a test asserts the headcount cannot move between periods.

**Suppression holds across the series.** A cohort visible in one month and
withheld in the next leaks the withheld count through the difference, so a
cohort under the floor is withheld for every period rather than per period. A
frozen comparator that is withheld is carried through marked as withheld rather
than dropped, so a reader can see the comparison is narrower than the one
registered.

**No single percentage improvement is published.** The measurement returns the
targeted change, the comparator change, and the difference between them, with no
field that collapses them into one number and no percentage anywhere. A test
asserts the refusal. The difference is deliberately not called an effect: it is
what is left after removing the movement common to cohorts nobody intervened on,
which is a better estimate than the raw change and still not a causal one. The
caveat names the selection problem, because a cohort picked for being extreme
moves toward the average on its own and that is the thing a reader is least
likely to think of.

### What the measure is

Actual absence, not predicted absence. The model targets; the actuals measure.
Measuring an intervention with the model that selected the cohort for it would
be measuring our own prediction and would report a success whenever the model
revised its view. `build_outcome_series.py` loads no model.

### The demo series, stated plainly

Twelve monthly periods. The intervention is simulated **mechanistically**: from
April the targeted cohort's overtime falls and consecutive shifts are capped,
and the absence that follows is whatever the data-generating process produces.
No outcome is written in by hand. A winter term is layered on every cohort,
because South African absence rises June to August for reasons not in the
feature set.

That combination produces the case worth showing. The targeted cohort's raw
change is 1.4 days per head lower, the comparators moved 0.9 days per head
*higher* on winter alone, and the honest estimate is therefore 2.3 days lower,
larger than the naive before-and-after. July on its own reads worse than
baseline. So the naive read understates the change overall and panics in the
middle, and the comparator correction fixes both. It is worth knowing that
careful measurement here finds more than the careless kind, not less.

On a client's data the mechanism is unknown, and the platform reports an
observed difference rather than a cause.

### What this unblocks and what it does not

Unblocked: outcome tracking, and the model history window now has a field to
rest on. Still absent: model gating, the backtest and the drift monitoring, all
of which need a trained-per-tenant model rather than just a time axis. The copy
on `/absence/outcomes` still says so.

## The agent backend is mocked for the control centre

The playbook screen's point is the governance: a plan is drafted, checked
against rules that can refuse it, and decided by somebody who did not draft it.
None of that depends on a language model, and all of it was unreachable without
one, because the drafting endpoint returned 503 with no key configured. A demo
tenant that cannot demonstrate its own approval flow is a worse problem than a
demo tenant without an LLM.

With no key, a plan is now assembled from a template filled with the targeted
cohort's own reported figures: deterministic, one template per targetable
dimension because the lever differs, and the WHY paragraph is arithmetic over
the cohort's row against the rest of its dimension.

Two rules it keeps, both tested:

- **It goes through the same validation as a model draft.** A template exempt
  from the checks would make the checks look like theatre.
- **It cannot pass as a model draft.** `drafted_with` is `template`, not
  `agent`, on the record and in the response; the screen badges it; the button
  reads "Assemble from a template"; and the notice says in as many words that
  no language model was called. The CI smoke step asserts the label over the
  wire, because it has to survive the route and not only the module.

It proposes nothing a model draft would be refused for. Writing disciplinary
language into the product in order to demonstrate that the product rejects
disciplinary language is not a trade worth making, so the refusal story stays
with the seeded rejected playbook, which is a real example kept on purpose.

What it is not: a reason the model is unnecessary. The steps are generic by
construction and the screen says so. A model reads the cohort's actual driver
mix and writes to it, which is the difference a buyer should see once a key is
configured. The other two agents, the Portfolio Analyst and the Case Assistant,
are untouched and still report that they are not configured.

### Three things the walkthrough found

Worth recording because none of them would have shown up in a unit test.

**Every seeded intervention already had a playbook**, so the screen offered
nothing to draft and a visitor could not try the flow at all without first
creating an intervention. A fourth seeded intervention now has no playbook, so
drafting is available on arrival while the three playbook states are kept.

**The individual-reference screen refused a correctly worded step.**
`INDIVIDUAL_FIELDS` is used to catch a step naming per-person data, and three of
its entries are ordinary English words, so "applied to the roster rather than to
individuals" was refused for containing the word for nobody. "Send an email to
the cohort" would have gone the same way. A screen that refuses the right
sentence teaches people to write a worse one. The ambiguous words are no longer
matched as field references; the actual identifiers are still caught by pattern,
and both directions are now tested.

**A CI check was asserting against the wrong session.** The new template check
reused a cookie jar the role matrix had left holding a refused account, so it
drafted as the viewer and asserted the label against a 403 body. It failed
loudly rather than passing, which is the only reason it was found before merge.

## What to do first

The schema time axis is settled and built, and is recorded above. What is left
needs a decision rather than a commit, in the order that the cost of delay
suggests:

1. **Settle the project name** before more is built in `absenteeism-demo`. A
   project cannot be renamed.
2. **Split the Analyst role, or change the sentence.** The document says no role
   sees data below cohort level and then gives Analyst the Case Assistant, which
   sits on an individual case view. Both cannot hold, and the code implements
   the role table, so an HR business partner currently has an occupational
   health nurse's reach. See 7a.
3. **Decide whether the manifest standard is the target or the specification.**
   Seven of twelve fields are absent, and the document says the pipeline
   validates all of them before any deployment.
4. **Soften two sentences in the document** to match what now exists: the image
   guardrail blocks on a fixable critical finding, and the scanner is Trivy in
   CI rather than Artifact Registry. Registry scanning of published images
   remains a genuine gap.
