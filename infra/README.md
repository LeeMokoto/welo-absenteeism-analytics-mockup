# Welo infrastructure (Terraform)

Infrastructure for the Welo demo: the inference service (agent proxy + model)
on Cloud Run, the Anthropic key in Secret Manager, an Artifact Registry repo for
the image, and an optional GCS bucket for the static dashboard.

It is deliberately **stateless and parameterised**. Build it in your own project
for the demo now, and migrate to the client's project later by pointing
Terraform at a new state and a new `*.tfvars`. Nothing hardcodes a project.

## What it provisions

| Resource | Purpose |
| --- | --- |
| Cloud Run service (`welo-inference`) | The only compute. Runs the model + agent proxy. 1 vCPU / 1 GiB, scale to zero. |
| Secret Manager secret | Holds `ANTHROPIC_API_KEY`, injected into the service at runtime. |
| Artifact Registry repo | Stores the container image. |
| Runtime service account | Least-privilege identity; may read only the one secret. |
| GCS bucket (optional) | Serves the static dashboard. |
| API enablement | Run, Cloud Build, Artifact Registry, Secret Manager. |

No database, no persistent disk, no GPU. Cache and rate-limit state live in
memory by design.

## Prerequisites

- `terraform` >= 1.5 and `gcloud`, authenticated: `gcloud auth application-default login`.
- A GCP project you own, with billing enabled.
- Roles for whoever runs this: `run.admin`, `artifactregistry.admin`,
  `secretmanager.admin`, `iam.serviceAccountAdmin`, `storage.admin`,
  `cloudbuild.builds.editor`, `serviceusage.serviceUsageAdmin`.

## Deploy (demo)

```bash
cd infra/terraform
cp demo.tfvars.example demo.tfvars      # then edit project_id, region, bucket

# 1. Create the registry (and enable APIs) so we have somewhere to push the image
terraform init
terraform apply -var-file=demo.tfvars \
  -target=google_project_service.services \
  -target=google_artifact_registry_repository.welo

# 2. Build and push the image; paste the printed ref into demo.tfvars (image = ...)
../scripts/build_and_push.sh YOUR_PROJECT_ID europe-west1

# 3. Apply the rest (Cloud Run, secret, bucket)
terraform apply -var-file=demo.tfvars

# 4. (optional) upload the static dashboard
../scripts/upload_dashboard.sh YOUR_DASHBOARD_BUCKET
```

`terraform output service_url` prints the Cloud Run URL. Open the dashboard with
`?api=<service_url>` and the **Live what-if** panel works immediately, no key
required.

## Switch the AI agents on

The agents (Analyst, Case Assistant, Cover Coordinator) need the Anthropic key.
Add it to the secret, then flip the toggle:

```bash
# add the key value (never in git / state)
printf 'sk-ant-YOURKEY' | gcloud secrets versions add anthropic-api-key \
  --data-file=- --project=YOUR_PROJECT_ID

# enable the agents and re-apply
terraform apply -var-file=demo.tfvars -var="enable_agents=true"
```

Until the key exists and `enable_agents = true`, the service reports the agents
as offline and the dashboard shows its built-in summaries, so it never breaks.

## Migrating to the client's environment

The whole point of the parameterisation. When the client is ready:

1. **New state.** Either `terraform workspace new client`, or set a GCS backend
   with a client-specific `prefix` (see `backend.tf`). Never share state between
   the demo and the client deployment.
2. **New vars.** `cp demo.tfvars client.tfvars`, change `project_id`, `region`
   (`africa-south1` keeps it in-country), `dashboard_bucket`, and lock
   `cors_origins` to the client's dashboard origin.
3. **Build into their project** with `build_and_push.sh THEIR_PROJECT_ID`, then
   `terraform apply -var-file=client.tfvars`.
4. **Their key.** The client adds their own Anthropic key to their secret; you
   never move keys between environments.

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
