# DevSecOps

How a change reaches a client project, and what has to be true before it can.

This document covers the pipeline and the supply chain. The data posture it
serves (POPIA roles, special personal information, subject requests,
pseudonymisation) is in `docs/data-governance.md`. The infrastructure it
provisions is in `infra/README.md`.

The reason any of this is stricter than a demo needs: the platform is built for
employee health data, which POPIA section 26 treats as special personal
information. A control that exists only as a sentence in a document is not a
control, so the ones that matter here are assertions in the pipeline that fail a
merge.

## What blocks a merge

Every item here fails the build. The `CI` job is the single required check, so
adding a job does not mean editing branch protection.

| Gate | Tool | What it catches |
| --- | --- | --- |
| Secrets | gitleaks, full history | A key committed by accident, before it is in `main` |
| Infrastructure misconfiguration | Checkov over Terraform, Dockerfiles and the workflow | A bucket that could be made public, a container running as root, an unpinned action |
| Infrastructure controls | `terraform test`, 17 assertions | A control that was quietly removed rather than argued about |
| Python advisories | pip-audit over the runtime lock | A known CVE in what the container actually installs |
| Node advisories | `npm audit --audit-level=high` | The same, for the platform |
| Runtime lock freshness | pip-compile diff | A lock nobody recompiled, so the image no longer matches its inputs |
| Provider lock coverage | hash count in `.terraform.lock.hcl` | A lock that works on Linux and fails on a reviewer's Mac |
| Non-root containers | `docker run id -u` on both images | A Dockerfile edit that dropped the `USER` line |
| Platform renders | production build plus a route smoke test | A screen that 500s, renders `NaN`, serves a disabled module under a 200, or leaks an identifier |
| Agent guardrails | live evals, where a key is available | A prompt change that lets an agent recommend disciplinary use |

Reported but not blocking: container CVEs (Trivy, `CRITICAL` and `HIGH`, unfixed
excluded) and the SBOM, both to the repository's security tab. A base-image CVE
with no available fix would otherwise stop all work until upstream moves, and
the finding still lands somewhere someone owns it.

## Supply chain

**Actions are pinned to commits, not tags.** A tag is mutable: whoever controls
an action's repository can move `v4` to new code, which then runs inside this
repository's CI with its token. Every `uses:` in the workflow is a 40-character
SHA with the version in a trailing comment. Dependabot understands that form and
bumps both together, which is what keeps pinning from decaying into
unpatched actions.

Pinning is only as good as the pin. Every SHA in the workflow was resolved
against the upstream repository rather than written from memory; two of ten were
wrong on the first pass, which is the whole argument for checking.

**The Python runtime is hash-pinned.** `model/requirements-runtime.txt` is
compiled from `requirements-runtime.in` with `--generate-hashes`, and the image
installs it with `--require-hashes`. Two things follow: the image shipped to a
client is the image that was tested, and a substituted package on the index
fails the build instead of entering the container. Regenerate with:

```bash
cd model && pip-compile --generate-hashes requirements-runtime.in
```

CI recompiles and diffs, so a raised range with a stale lock fails.

`requirements.txt` is the training and analysis environment (jupyter,
matplotlib, seaborn). It is deliberately not what the serving image installs.

**Node installs from the lockfile.** `npm ci`, never `npm install`, so CI
resolves nothing.

**Terraform providers are locked across platforms.** `.terraform.lock.hcl` is
committed and carries hashes for `linux_amd64`, `darwin_arm64`, `darwin_amd64`
and `windows_amd64`, so two operators cannot plan against different providers
and nobody hits a hash failure that tempts them to delete the lock.

## Credentials

**No long-lived cloud credential exists anywhere.** CI authenticates to GCP
through Workload Identity Federation: GitHub mints a short-lived OIDC token for
a workflow run, GCP exchanges it for one that expires within the hour. The
alternative, a downloaded service account key in a GitHub secret, is a permanent
credential to the project holding employee data, sitting in a system neither
Welo nor the client controls, that nothing rotates and nothing notices the loss
of.

Federation is only safe if the exchange is restricted. A pool provider with no
attribute condition accepts a valid GitHub OIDC token from any repository on
GitHub, which turns "no long-lived key" into "anyone's workflow can assume this
identity". It is the most common serious misconfiguration of WIF. Here the
condition pins two independent claims:

```
assertion.repository == 'owner/repo' && assertion.sub.startsWith('repo:owner/repo:')
```

`ci_github_repository` has no default, rejects a wildcard, and
`tests/ci_identity.tftest.hcl` fails if the condition is ever removed.

**The CI identity cannot read employee data.** It holds
`roles/storage.bucketViewer` (bucket metadata, not objects) and
`roles/secretmanager.viewer` (secret metadata, not payloads). `roles/viewer` is
deliberately not used, because it would hand CI the contents of every tenant
bucket. The only object-level grant is read on the state bucket, so a pull
request can plan. A test asserts no primitive role and no data-reading role is
ever added.

**Apply stays human.** Nothing in CI has write access to any project. A plan runs
on a pull request; applying it is a person with their own credentials.

**Keys that do exist, and where.** The Anthropic API key lives in Secret Manager
and is injected at runtime, or is set directly in Vercel; it is never in an
image, a repository or Terraform state. Each tenant's pseudonymisation key is
created as an empty Secret Manager secret by Terraform and written out of band,
so the key that makes employee records re-identifiable cannot leak through
state. Terraform state itself is in GCS, versioned, never local, and gitignored
along with real `*.tfvars` and backend configs.

## Controls as tests

`infra/terraform/tests/` holds 17 assertions corresponding to claims made in
`infra/README.md` and above. They are plan-time, use a placeholder provider
token, reach no API and need no credentials, so they run on every pull request
including from a fork.

They were checked by breaking the thing they protect. Removing public access
prevention, forcing `force_destroy` on, giving the application write access to
derived artifacts, deleting the OIDC attribute condition and granting CI
`roles/viewer` each fail the suite; restoring each returns it to green. A test
that has never failed is not known to work.

What they cover:

- Both tenant buckets enforce public access prevention and uniform access.
- Neither defaults to `force_destroy`, so a teardown cannot take employee
  records with it.
- The landing bucket expires its uploads.
- The application's only bucket grant is read on derived artifacts; it cannot
  reach the raw upload.
- Ingest and the application are different principals, per tenant, with
  different pseudonymisation keys, so one tenant's hashes cannot be joined to
  another's.
- The small-cell floor cannot be set below five from the infrastructure side,
  matching the clamp in `lib/platform/manifest.js`.
- The control centre is never on by default.
- A synthetic tenant is marked synthetic, and a real one is not.
- The OIDC exchange is pinned to one repository, by two claims.
- CI holds no primitive role and nothing that reads object data or secret
  payloads.

## Exemptions

There are nine Checkov skips. All are `checkov:skip=ID: reason` comments on the
exact resource they apply to, so the justification sits next to the thing being
exempted and cannot widen to resources it was never considered for. There is no
`skip_check` list in the workflow.

| Resource | Skips | Why |
| --- | --- | --- |
| Static dashboard bucket | public access prevention, public binding, versioning, access logging | It is a public static site serving synthetic data by design. It has never held an employee record. `dashboard_public = false` removes the binding; `host_dashboard = false` removes the bucket. |
| Artifact Registry | CSEK | Images hold code and models trained on synthetic data. Customer-managed keys there would add key management without protecting personal data. The CMEK option exists where personal data lives, on tenant buckets. |
| Tenant and state buckets | per-bucket access logging | Covered project-wide by Cloud Audit Logs data access logging, which also covers buckets added later and secret payload reads. Per-bucket logging would be a second, partial copy. |
| OIDC pool provider | CKV_GCP_125 | The check requires exact equality on `assertion.sub`, which encodes the ref and event type and would pin CI to a single branch. This repository builds on `main`, on `claude/**` and on pull requests. Two claims are asserted instead, and a test enforces them. |

## Audit

Cloud Audit Logs data access logging is on for Cloud Storage and Secret Manager
(`enable_data_access_logs`, default true). Every read and write of a tenant's
objects is recorded, and so is every read of a pseudonymisation key, which is
the event that matters most: that key is what makes employee records
re-identifiable to the employer.

## Review

`CODEOWNERS` gives every path an owner, with named owners on infrastructure,
the agent prompts, the governance documents, the suppression floor and the
tenant manifest. Branch protection on `main` should require the `CI` check,
a code owner review, and conversation resolution, with force pushes and
deletions off. That is repository configuration rather than something this
repository can set.

## Not yet done

Named so the gaps are not mistaken for coverage.

- **No identity provider on the application.** `allow_unauthenticated` is still
  the only access control on a tenant's platform service. SSO is the next piece
  and the largest remaining hole: a client security review will go here first.
- **No image signing or admission control.** Nothing stops an unsigned image
  being deployed to Cloud Run. Binary Authorization with an attestation from
  this pipeline is the fix.
- **No model artifact provenance.** `model/models/manifest.joblib` records class
  labels and feature names but not the versions it was trained with, so nothing
  detects artifact and runtime skew. Loading currently warns that artifacts
  pickled with scikit-learn 1.9.0 are being read by 1.9.1. Recording the
  training environment in the manifest and asserting it at startup would turn
  that warning into a gate.
- **No automated apply.** Deliberate for now, but it means a plan reviewed on a
  pull request is not provably the plan that was applied. A saved plan file
  applied by an approval-gated environment is the next step.
- **No ingest container.** So the ingest job is behind a flag and nothing in
  this pipeline builds or scans it yet.
- **Agent evals skip without a key.** On a fork, the guardrail gate does not
  run. It is the one gate that is not unconditional.
