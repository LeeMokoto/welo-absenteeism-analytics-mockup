# Keyless CI authentication to GCP (Workload Identity Federation).
#
# The alternative is a downloaded service account key in a GitHub secret: a
# long-lived credential to the project that holds employee data, sitting in a
# system neither Welo nor the client controls, that nothing rotates and nothing
# notices the loss of. This replaces it. GitHub mints a short-lived OIDC token
# for a workflow run, GCP exchanges it for a token that expires in an hour, and
# there is no secret to leak.
#
# Two conditions do the actual work.
#
# The attribute condition on the provider restricts the exchange to one
# repository. Without it, any GitHub Actions workflow anywhere in the world can
# present a valid GitHub OIDC token and assume this identity. This is the most
# common and most serious misconfiguration of Workload Identity Federation, so
# the repository is a required variable with no default and a test asserts the
# condition is present.
#
# The CI identity can plan, not read. It is granted bucket metadata, not object
# data, so a workflow run can tell you a bucket's configuration changed and
# cannot read a single record inside it. Apply stays a human action with its own
# credentials; nothing here grants write.

locals {
  deploy_ci = var.ci_github_repository != ""
}

resource "google_project_service" "ci" {
  for_each = local.deploy_ci ? toset([
    "iam.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]) : toset([])
  service            = each.value
  disable_on_destroy = false
}

resource "google_iam_workload_identity_pool" "github" {
  count                     = local.deploy_ci ? 1 : 0
  workload_identity_pool_id = "${var.ci_pool_id}-${var.ci_pool_suffix}"
  display_name              = "GitHub Actions"
  description               = "Short-lived credentials for CI. No downloaded service account keys."

  depends_on = [google_project_service.ci]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  count                              = local.deploy_ci ? 1 : 0
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[0].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  # checkov:skip=CKV_GCP_125: The check requires exact equality on
  # assertion.sub, which for GitHub Actions encodes the ref and the event type
  # (repo:owner/name:ref:refs/heads/main). Pinning to one such value would
  # restrict CI to a single branch and event, and this repository's CI runs on
  # main, on claude/** branches and on pull requests, so an equality condition
  # could not be satisfied without either breaking CI or widening to a wildcard.
  # The condition below asserts the repository and the subject prefix, which
  # bounds the exchange to this repository's workflows by two independent
  # claims. Tested in tests/ci_identity.tftest.hcl.

  # The exchange is refused unless the token says it came from this repository.
  # Everything else about the request can be forged by anyone with a GitHub
  # account; these two claims cannot. The subject prefix is belt and braces: it
  # would still bound the exchange if the repository claim were ever dropped
  # from the mapping.
  attribute_condition = join(" && ", [
    "assertion.repository == '${var.ci_github_repository}'",
    "assertion.sub.startsWith('repo:${var.ci_github_repository}:')",
  ])

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "ci" {
  count        = local.deploy_ci ? 1 : 0
  account_id   = "welo-ci-plan"
  display_name = "Welo CI, plan only"
  description  = "Assumed by GitHub Actions through Workload Identity Federation. Read-only; cannot read object data."
}

# Only this repository's workflows may assume the identity, and the attribute
# condition above has already refused anything else.
resource "google_service_account_iam_member" "ci_workload_identity" {
  count              = local.deploy_ci ? 1 : 0
  service_account_id = google_service_account.ci[0].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[0].name}/attribute.repository/${var.ci_github_repository}"
}

# What CI may see. Chosen so a plan is possible and a read of employee data is
# not: storage.bucketViewer is bucket metadata only, and secretmanager.viewer is
# secret metadata without the payload. roles/viewer is deliberately not used,
# because it would hand CI the contents of the buckets.
resource "google_project_iam_member" "ci" {
  for_each = local.deploy_ci ? toset([
    "roles/serviceusage.serviceUsageViewer",
    "roles/run.viewer",
    "roles/artifactregistry.reader",
    "roles/secretmanager.viewer",
    "roles/storage.bucketViewer",
    "roles/iam.serviceAccountViewer",
  ]) : toset([])
  project = var.project_id
  role    = each.value
  member  = google_service_account.ci[0].member
}

# The state bucket is the one place CI needs object access, because a plan reads
# state. Granted on that bucket alone rather than at the project level.
resource "google_storage_bucket_iam_member" "ci_state" {
  count  = local.deploy_ci && var.ci_state_bucket != "" ? 1 : 0
  bucket = var.ci_state_bucket
  role   = "roles/storage.objectViewer"
  member = google_service_account.ci[0].member
}

output "ci_workload_identity_provider" {
  description = "Value for the GitHub Actions auth step's workload_identity_provider input."
  value       = local.deploy_ci ? google_iam_workload_identity_pool_provider.github[0].name : "not configured (ci_github_repository is empty)"
}

output "ci_service_account" {
  description = "Value for the GitHub Actions auth step's service_account input."
  value       = local.deploy_ci ? google_service_account.ci[0].email : "not configured (ci_github_repository is empty)"
}
