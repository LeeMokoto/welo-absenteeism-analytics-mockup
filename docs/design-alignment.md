# Design document alignment

Checks the statements in *Welo Absence Analytics Platform: Solution Design,
Standards and Governance* (7 October 2026) against what this repository
actually builds.

The document says its "statements of fact describe the platform as designed",
which is the right framing: most of the distance below is a design that runs
ahead of the build, and that is expected. This file separates the distance that
is fine from the distance that is not.

Three categories:

- **Contradicts** — the document and the code disagree. One of them is wrong,
  and a client reading the document would be misled by the code or the reverse.
- **Promised, not built** — the document commits to a control that does not
  exist yet. Fine while the document is read as design, not fine in an
  assessment response.
- **Aligned** — worth recording, because it is most of the governance substance.

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
compliance statement rather than a configuration preference. Change the default
to the EU multi-region endpoint and validate the variable against the two values
the document permits.

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
the document states the opposite as fact. Either the document softens to "blocks
on a fixable critical finding", or the pipeline starts blocking and accepts the
stoppage. The document's version is also Artifact Registry scanning rather than
Trivy in CI, which is a different control at a different point.

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

### 1. Complementary suppression, and a demonstrated leak

The document commits to it twice, in the runtime guardrails table and under
disclosure control: "Where one cell in a row or column is suppressed, the next
smallest cell is suppressed with it, or the total is withheld, so the hidden
value cannot be derived by subtraction."

Nothing implements it. `model/feed_enrich.py` does primary suppression only:
`suppressed_row()` drops every measure for a cohort under the threshold.

This is not theoretical. Forcing one cohort below the threshold and rendering
`/absence/outcomes` produces:

```
High-intensity ops   2,030   38,054   R41.9m   67.0%   18.7
Standard ops         n<5     Suppressed, fewer than 5 covered lives
Light duty           2,523   18,768   R20.6m   33.0%    7.4

The cohort lens covers 5,800 lives, R62.5m of exposure.
```

The visible counts sum to 4,553 and the note states 5,800, so the suppressed
cohort's headcount is exactly 1,247 by subtraction. The suppression is defeated
by the total printed underneath it.

The same render exposes a second defect in that note, which is the vector: the
`5,800` is the full covered count while the `R62.5m` is the sum of visible rows
only, because a suppressed cohort contributes nothing to it. The note pairs a
complete count with an incomplete total, which is both misleading on its own and
what makes the subtraction work.

That note is in `modules/absence/screens/OutcomesScreen.jsx` and was written in
this repository, not inherited. Fixing it needs complementary suppression in the
feed and a rule that a total is withheld when any of its components is
suppressed, applied across every screen, export and agent grounding, as the
document says.

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

`/absence/outcomes` does show the cross-validated metrics, and its copy already
claims more than the code does: "A tenant model is backtested against a naive
baseline before its predictions are served, and withdrawn if it falls below that
baseline." That sentence describes the document, not the repository.

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

The document gives seven application roles, role checks in the API, group-to-role
mapping from the client's identity provider, Privileged Access Manager for Welo
access, and a sealed break-glass account.

None of it exists. There is no authentication in the application at all;
`allow_unauthenticated` on the Cloud Run service is the only access control. This
is the gap already named as the largest in `docs/devsecops.md`, and the document
makes it larger by committing to the role model above it.

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

## What to do first

In the order that the cost of delay suggests:

1. **Change the `vertex_region` default and validate it.** It is a one-line
   change against a compliance claim, and the current default sends inference to
   the United States.
2. **Settle the project name** before more is built in `absenteeism-demo`. A
   project cannot be renamed.
3. **Fix the complementary suppression leak**, or remove the claim. A suppressed
   cohort's headcount is currently recoverable by subtraction on a screen in this
   repository.
4. **Correct the copy on `/absence/outcomes`** that says a model is backtested
   and withdrawn. It describes the document, not the code.
5. **Reconcile the image-scanning guardrail** in one direction.
6. **Decide whether the manifest standard is the target or the specification.**
   Seven of twelve fields are absent, and the document says the pipeline
   validates all of them before any deployment.
