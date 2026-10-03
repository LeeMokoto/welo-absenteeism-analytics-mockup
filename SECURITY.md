# Security policy

## Scope

This repository holds the Welo workforce health platform: a Python inference
service, a Next.js application, and the Terraform that provisions the Google
Cloud projects both run in.

The data this platform is built for is employee health data, which South
Africa's Protection of Personal Information Act treats as special personal
information under section 26. Everything in `docs/data-governance.md` and
`docs/devsecops.md` follows from that. The repository currently contains only
synthetic data, and no client data has ever been used to train the model.

## Reporting a vulnerability

Report privately, not as a public issue:

- Open a draft security advisory on this repository, or
- Email the maintainer listed in `CODEOWNERS`.

Please include what you found, how to reproduce it, and what you think the
impact is. Expect an acknowledgement within three working days.

Do not test against a client tenant. If you need an environment to demonstrate
something, ask and one will be provisioned.

## What is enforced automatically

These are checks that block a merge rather than advice in a document. The detail
is in `docs/devsecops.md`.

| Check | Enforcement |
| --- | --- |
| Secret scanning (gitleaks, full history) | Blocks |
| Infrastructure misconfiguration (Checkov) | Blocks |
| Infrastructure control tests (`terraform test`) | Blocks |
| Python dependency advisories (pip-audit, runtime lock) | Blocks |
| Node dependency advisories (npm audit, high and above) | Blocks |
| Both container images run as a non-root user | Blocks |
| Agent guardrail evals | Blocks where a key is available |
| Container CVEs (Trivy) | Reported to the security tab |

## Things worth knowing before reporting

- **No credential should exist in this repository, in any form.** Terraform
  state is in GCS and gitignored, real `*.tfvars` and backend configs are
  gitignored, the Anthropic API key is injected from Secret Manager or set in
  the host platform, and each tenant's pseudonymisation key is written out of
  band and never enters Terraform state. If you find a credential anywhere in
  the tree or the history, that is a finding and we want to hear about it
  immediately.
- **CI holds no long-lived cloud credential.** It authenticates through
  Workload Identity Federation, restricted to this one repository, with a
  read-only identity that cannot read object data or secret payloads.
- **Small-cell suppression is a control, not a display preference.** A path that
  reports a figure for a cohort below the tenant threshold is a privacy finding
  even if the figure is an aggregate.
- **Individual-level data must not reach a cohort screen.** The module data the
  platform screens read is built by a script that allow-lists aggregate sections
  and explicitly deletes the per-person ones. A route that serves an individual
  record outside the clinical view is a finding.
