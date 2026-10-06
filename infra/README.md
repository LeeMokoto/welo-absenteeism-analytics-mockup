# Welo infrastructure (Terraform)

Infrastructure for the Welo platform. Two layers:

- **Shared**: the inference service (agent proxy + model) on Cloud Run, the
  Anthropic key in Secret Manager (or Vertex AI access via the runtime service
  account), an Artifact Registry repo, and an optional GCS bucket for the
  static dashboard.
- **Per tenant**: one instantiation of `modules/tenant` for each entry in
  `var.tenants`. A tenant gets its own landing and derived buckets, its own
  pseudonymisation key, its own two service accounts, and optionally its own
  ingest job and application instance.

Everything is **parameterised**. Nothing hardcodes a project, and adding a
client is adding a map entry rather than forking the configuration.

## What it provisions

### Shared

| Resource | Purpose |
| --- | --- |
| Cloud Run service (`welo-inference`) | The model + agent proxy. 1 vCPU / 1 GiB, scale to zero. |
| Cloud Run service (`welo-sick-leave`) | The Next.js Sick Leave dashboard. 1 vCPU / 512 MiB, scale to zero. Optional (`deploy_sick_leave`). |
| Secret Manager secret | Holds `ANTHROPIC_API_KEY`, injected at runtime. Shared across services and tenants. |
| Vertex AI IAM grant | `roles/aiplatform.user` on the runtime SA. Vertex provider only. |
| Artifact Registry repo | Stores the container images. |
| Runtime service accounts | One per service, least-privilege. |
| GCS bucket (optional) | Serves the static dashboard. |
| API enablement | Run, Cloud Build, Artifact Registry, Secret Manager, Storage, IAM Credentials (+ Vertex AI when `llm_provider = vertex`). |

### Per tenant (`modules/tenant`)

| Resource | Purpose |
| --- | --- |
| Landing bucket (`<prefix>-<tenant>-raw`) | Where the employer uploads its canonical-schema extract through a signed URL. Short retention: a transfer point, not a store. |
| Derived bucket (`<prefix>-<tenant>-derived`) | Pseudonymised artifacts only: the feed, model outputs, aggregates. |
| Pseudonymisation key | A Secret Manager secret per tenant, holding the HMAC key ingest uses to hash employee identifiers. Terraform never sees its value. |
| Ingest service account | Runs ingest, and is the identity that signs upload URLs. Reads the landing bucket, writes the derived bucket, reads the tenant key. |
| Platform service account | Runs the application. Reads the derived bucket **only**: the identifiable upload is not reachable from the surface a user logs in to. |
| Cloud Run job (`<tenant>-ingest`) | Ingest and processing. Optional (`deploy_ingest`). |
| Cloud Run service (`<tenant>-platform`) | The Next.js platform for this tenant. Optional (`deploy_platform`); otherwise the tenant runs on Vercel. |

No database, no persistent disk, no GPU. Cache and rate-limit state live in
memory by design.

The pipeline that gets a change into these projects, and the supply chain it
depends on, are in `docs/devsecops.md`. The controls below are asserted by
`terraform test` in `infra/terraform/tests/`, which runs on every pull request
with no credentials.

### Controls asserted in the configuration, not left to convention

- **Buckets refuse public access unconditionally.** `public_access_prevention
  = "enforced"` on both tenant buckets, with no variable to loosen it. A bucket
  holding employee records has no setting under which being world-readable is
  correct.
- **The suppression floor is enforced here as well as in the application.**
  `suppression_threshold` validates `>= 5`; `lib/platform/manifest.js` clamps to
  the same floor. The control does not depend on one side getting it right.
- **`terraform destroy` cannot take a tenant's data with it.**
  `force_destroy_buckets` defaults false, so a destroy against a tenant holding
  objects fails rather than deleting them.
- **The pseudonymisation key never enters state.** Terraform creates the secret
  container; the value is added out of band. See
  `terraform output tenant_setup_commands`.
- **Raw uploads expire.** The landing bucket deletes objects after
  `raw_retention_days` (30 by default) and superseded versions after 7 days,
  because that is the only copy carrying the employer's own identifiers.

## Tenants

A tenant is the platform's unit of isolation. Declare them in your `*.tfvars`:

```hcl
bucket_prefix = "welo-za"      # global across GCS; no default on purpose

tenants = {
  demo = {
    display_name = "Demo tenant"
    environment  = "demo"
    synthetic    = true
  }

  glencore = {
    display_name          = "Glencore South Africa"
    environment           = "production"
    synthetic             = false
    suppression_threshold = 10            # may be raised, never lowered
    region                = "africa-south1"
    modules = { absence = true, sick_leave = false, control_centre = false }
    deploy_ingest         = true
    ingest_image          = "...-docker.pkg.dev/P/welo/welo-ingest:latest"
  }
}
```

The map key is the tenant id and it is **permanent**: changing it replaces every
resource belonging to that tenant.

### Where a tenant's application runs

`deploy_platform` decides, and the tenant's environment is the same either way:

- **`false` (Vercel).** Terraform provisions the backend and computes the
  tenant's environment. `terraform output tenant_platform_env` gives you exactly
  what to set in the Vercel project. The Anthropic key is set directly in Vercel
  and does not pass through Terraform.
- **`true` (Cloud Run).** Terraform runs the application in the tenant's project
  with the same environment, and injects the Anthropic key from Secret Manager
  when `enable_agents` is on. This is the answer for a client who requires the
  whole stack inside their own project.

Both paths read `local.manifest_env` in `modules/tenant`, so what defines a
tenant has one definition regardless of who hosts it.

### Adding a tenant

```bash
# 1. Add the map entry, then plan to see only that tenant's resources appear
terraform plan -var-file=demo.tfvars

terraform apply -var-file=demo.tfvars

# 2. Generate and load its pseudonymisation key (never in state, never in git)
terraform output tenant_setup_commands    # prints the exact command per tenant

# 3. Hand the employer a signed upload URL, signed as the tenant's ingest SA,
#    then run a pass
terraform output -json tenants
```

## Prerequisites

- `terraform` >= 1.5 and `gcloud`, authenticated: `gcloud auth application-default login`.
- A GCP project you own, with billing enabled.
- Roles for whoever runs this: `run.admin`, `artifactregistry.admin`,
  `secretmanager.admin`, `iam.serviceAccountAdmin`, `storage.admin`,
  `cloudbuild.builds.editor`, `serviceusage.serviceUsageAdmin`.

## State

State lives in GCS, not on an operator's laptop. For a configuration that
provisions client tenants this is not a preference: state records bucket names,
service account identities and secret ids, and a tenant must not be recoverable
only from whoever last ran apply.

`backend.tf` declares the backend with no arguments, because backend
configuration cannot use variables. The bucket and prefix come from a file at
init time, one per environment. The state bucket has to exist first, which is
what `bootstrap/` is for:

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply -var project_id=YOUR_PROJECT -var state_bucket=welo-tfstate-UNIQUE

cd ..
cp backend.demo.hcl.example backend.demo.hcl     # set bucket to the name above
terraform init -backend-config=backend.demo.hcl
```

`bootstrap/` keeps its own state locally, deliberately: the only thing it
manages is a bucket whose name you already know, so losing that state costs an
import rather than a tenant. Its bucket has versioning on and no
`force_destroy`, so a destroy cannot wipe every other deployment's state.

Use one prefix per environment (`welo-platform/demo`, `welo-platform/client`) so
two deployments never share state.

To validate or format without a backend at all: `terraform init -backend=false`.

## Provision the demo (scripted)

`infra/scripts/provision_demo.sh` runs the whole sequence against the
`absenteeism-demo` project. Every stage is idempotent, so a failed run is
resumed by running it again, and nothing in it deletes anything.

```bash
gcloud auth login
gcloud auth application-default login     # separate login; Terraform uses this one
gcloud config set project absenteeism-demo

infra/scripts/provision_demo.sh           # all stages
infra/scripts/provision_demo.sh 5         # just one
```

| Stage | What it does |
| --- | --- |
| 0 | Preflight: both logins, project exists, billing, creates `demo.tfvars` and `backend.demo.hcl` from the examples, prints your billing account id for the budget |
| 1 | Creates the Terraform state bucket through `./bootstrap` |
| 2 | `terraform init` against that bucket, then validate |
| 3 | Enables the APIs and creates the Artifact Registry repository |
| 4 | Builds and pushes the inference image with Cloud Build |
| 5 | Applies everything: Cloud Run, the tenant's buckets and identities, the secret containers |
| 6 | Generates the tenant's pseudonymisation key, loads the Anthropic key |
| 7 | Re-applies with the agents switched on |
| 8 | Health checks, prints the outputs and what to do next |

The staging is not arbitrary. The registry has to exist before an image can be
pushed to it, the image before Cloud Run can reference it, and the secrets have
to hold values before the agents can be switched on. A single apply fails on the
first of those.

Secrets are piped to `gcloud` on stdin, never passed as an argument, because
arguments are visible in the process list. Stage 6 skips a secret that already
holds a version rather than rotating it: rotating a tenant's pseudonymisation
key makes every existing pseudonym unresolvable (see `docs/data-governance.md`).

Overrides are environment variables: `PROJECT_ID`, `REGION`, `STATE_BUCKET`,
`TFVARS`, `BACKEND`, `IMAGE_TAG`, `ANTHROPIC_API_KEY`.

### Two decisions to make before the first run

**Region.** `demo.tfvars.example` is set to `africa-south1`, which keeps the
demo in country for a South African client. It is a tier 2 region, roughly 40
percent more per vCPU-second than `europe-west1`, which on demo volumes is about
USD 10 a year. **Bucket location is immutable**, so changing this after the
first apply replaces every bucket.

**Bucket prefix.** `welo-ad` gives `welo-ad-demo-raw` and `welo-ad-demo-derived`.
Bucket names are global across all of GCS, so if the apply fails with "bucket
already exists", someone else has the name and this needs changing.

Both are one-line edits in `demo.tfvars` and both are cheap to change before the
first apply, awkward after it.

### What the demo costs

Single digits a month with nothing kept warm. `demo.tfvars.example` sets a
budget of USD 50, which needs only the billing account id filling in; stage 0
prints it for you. See `docs/run-cost-model.md` for where the money goes and for
the one setting (`cpu_idle`) worth guarding.

## Deploy (demo, by hand)

```bash
cd infra/terraform
cp demo.tfvars.example demo.tfvars      # then edit project_id, bucket_prefix, region

# 1. Create the registry (and enable APIs) so we have somewhere to push the image
terraform init -backend-config=backend.demo.hcl
terraform apply -var-file=demo.tfvars \
  -target=google_project_service.services \
  -target=google_artifact_registry_repository.welo

# 2. Build and push the inference image; paste the printed ref into demo.tfvars
#    as image = "..."
../scripts/build_and_push.sh YOUR_PROJECT_ID europe-west1

# 3. Apply the rest (Cloud Run, secret, bucket)
terraform apply -var-file=demo.tfvars

# 4. Put the Anthropic key in the secret, then switch the agents on
printf 'sk-ant-YOURKEY' | gcloud secrets versions add anthropic-api-key \
  --data-file=- --project=YOUR_PROJECT_ID
terraform apply -var-file=demo.tfvars -var="enable_agents=true"

# 5. (optional) upload the static absenteeism dashboard to the bucket
../scripts/upload_dashboard.sh YOUR_DASHBOARD_BUCKET
```

`terraform output service_url` prints the Cloud Run URL. Open the absenteeism
dashboard with `?api=<service_url>` and the **Live what-if** panel works
immediately with no key; the three agent panels come alive once step 4 is done.

This deploys the inference service only. The sick-leave dashboard is hosted on
Vercel, so `deploy_sick_leave` defaults to false; see the section below to run it
on Cloud Run as well.

## LLM provider: Anthropic API or Vertex AI

The agents call Claude one of two ways, set by `llm_provider`:

- **`anthropic`** (default): the first-party Anthropic API with a key in Secret
  Manager. Simplest for the public demo. Terraform creates the secret and grants
  the runtime SA read access to it.
- **`vertex`**: Claude on Google Vertex AI, authenticated as the runtime service
  account (Application Default Credentials, no API key). Terraform enables the
  Vertex API and grants the SA `roles/aiplatform.user`; it creates no key secret.
  The data stays inside the chosen Google region, and there is no long-lived
  secret to rotate, which is why it is preferred for Welo's own project. See
  `docs/data-governance.md` for the POPIA posture.

To deploy on Vertex, set in your `*.tfvars`:

```hcl
llm_provider  = "vertex"
vertex_region = "us-east5"   # a region that serves the Claude models
enable_agents = true         # no key needed; the SA authenticates to Vertex
```

The same image runs either way; only config changes.

## Switch the AI agents on (Anthropic provider)

On the Anthropic path the agents need the API key. Add it to the secret, then
flip the toggle:

```bash
# add the key value (never in git / state)
printf 'sk-ant-YOURKEY' | gcloud secrets versions add anthropic-api-key \
  --data-file=- --project=YOUR_PROJECT_ID

# enable the agents and re-apply
terraform apply -var-file=demo.tfvars -var="enable_agents=true"
```

Until the key exists and `enable_agents = true` (Anthropic), or the SA has Vertex
access and `enable_agents = true` (Vertex), the service reports the agents as
offline and the dashboard shows its built-in summaries, so it never breaks.

### The sick-leave dashboard's agents

The Next.js sick-leave service uses the first-party Anthropic key path and reads
the **same** Secret Manager secret. Add the key once (above), then enable its
three agents with their own toggle:

```bash
terraform apply -var-file=demo.tfvars -var="sick_leave_enable_agents=true"
```

Its runtime service account is granted read access to the shared secret only
when this toggle is on. Until then the dashboard renders normally with the three
agent panels showing a clear disabled state. The sick-leave app does not yet
support the Vertex path, so run it with the anthropic key even if the inference
service is on Vertex; setting `sick_leave_enable_agents = true` makes Terraform
create the shared key secret in that case.

## Migrating to the client's environment

The whole point of the parameterisation. When the client is ready:

1. **New state.** `cp backend.demo.hcl client.hcl`, change the `prefix` (and the
   bucket if the client's project owns its own), then
   `terraform init -backend-config=client.hcl -reconfigure`. Never share state
   between the demo and the client deployment.
2. **New vars.** `cp demo.tfvars client.tfvars`, change `project_id`, `region`
   (`africa-south1` keeps it in-country), `bucket_prefix`, `dashboard_bucket`,
   and lock `cors_origins` to the client's dashboard origin. Declare their
   tenant in `tenants` with `synthetic = false` and
   `allow_unauthenticated = false`.
3. **Build into their project** with `build_and_push.sh THEIR_PROJECT_ID`, then
   `terraform apply -var-file=client.tfvars`.
4. **Their credentials.** On the Anthropic path the client adds their own key to
   their secret; you never move keys between environments. On the Vertex path
   there is no key: set `llm_provider = "vertex"` and Terraform grants the
   client project's runtime SA `roles/aiplatform.user`, so Claude runs inside
   their Google project with their IAM. This is the recommended posture for the
   environment that touches real employee health data.

Because the model artifacts and feed are baked into the image, the client
deployment is the same image scoring the same model, only the project and the
key change.

## Production hardening (for the client deploy, not the demo)

- Set `allow_unauthenticated = false` and front the service appropriately, or
  keep it public but rely on the app's `WELO_API_KEY` gate and the Anthropic
  spend cap.
- Set `cors_origins` to the exact dashboard origin.
- Consider `dashboard_public = false` and serving the static site behind a load
  balancer / IAP if the client's org policy forbids public buckets.
- `allUsers` bindings (public Cloud Run and public bucket) may be blocked by the
  org policy `iam.allowedPolicyMemberDomains`; the toggles above let you turn
  them off.

## Teardown

```bash
terraform destroy -var-file=demo.tfvars
```

The secret's key version is retained unless you also remove it; delete the
secret manually if you want it gone.

A destroy will **fail** on any tenant bucket that still holds objects, because
`force_destroy_buckets` defaults to false. That is the intended behaviour: a
teardown must not be able to take employee records with it. To tear down a
tenant on purpose, empty its buckets first, or set `force_destroy_buckets = true`
for that tenant and accept what that means.

## Not yet provisioned

Stated plainly so the gap is not mistaken for coverage:

- **No ingest container exists yet.** `deploy_ingest` defaults to false and the
  job has a precondition on `ingest_image`, so the buckets, keys and identities
  come up without it and the signed-URL upload target works before the processor
  does. Build the image, then turn the flag on.
- **No automatic trigger.** Ingest runs when you execute the job. An Eventarc
  trigger on bucket finalize, or a Cloud Scheduler cadence, is the next step.
- **No identity provider.** `allow_unauthenticated` is still the only access
  control on a tenant's application. SSO belongs here and is not wired yet.
- **No per-tenant project.** Every tenant currently lands in one `project_id`,
  isolated by bucket, key and service account rather than by project boundary.
  Moving a tenant to its own project means a separate state prefix and a
  separate `*.tfvars`, which the configuration already supports.
