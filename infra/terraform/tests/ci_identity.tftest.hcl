# The CI identity's controls.
#
# Workload Identity Federation replaces a downloaded service account key with a
# short-lived token, which is a clear improvement, but only if the exchange is
# restricted. A pool provider without an attribute condition will accept a valid
# GitHub OIDC token from any repository on GitHub, which turns "no long-lived
# key" into "anyone's workflow can assume this identity". That is the failure
# this file exists to prevent.
#
#   terraform init -backend=false && terraform test

provider "google" {
  project      = "welo-test"
  region       = "europe-west1"
  access_token = "placeholder-no-api-calls-are-made"
}

variables {
  project_id    = "welo-test"
  bucket_prefix = "welo-test"
  image         = "europe-west1-docker.pkg.dev/welo-test/welo/welo-inference:latest"

  host_dashboard   = false
  dashboard_bucket = ""

  tenants = {}
}

run "no_ci_identity_unless_a_repository_is_named" {
  command = plan

  variables {
    ci_github_repository = ""
  }

  assert {
    condition     = length(google_iam_workload_identity_pool.github) == 0
    error_message = "No CI identity should exist until a repository is named."
  }

  assert {
    condition     = length(google_service_account.ci) == 0
    error_message = "No CI service account should exist until a repository is named."
  }
}

run "the_token_exchange_is_pinned_to_one_repository" {
  command = plan

  variables {
    ci_github_repository = "LeeMokoto/welo-absenteeism-analytics-mockup"
    ci_state_bucket      = "welo-test-tfstate"
  }

  # Without this condition, any workflow on GitHub can assume the identity.
  assert {
    condition     = google_iam_workload_identity_pool_provider.github[0].attribute_condition != null && google_iam_workload_identity_pool_provider.github[0].attribute_condition != ""
    error_message = "The pool provider must carry an attribute condition. Without one, any GitHub repository can assume this identity."
  }

  assert {
    condition     = can(regex("assertion.repository == 'LeeMokoto/welo-absenteeism-analytics-mockup'", google_iam_workload_identity_pool_provider.github[0].attribute_condition))
    error_message = "The attribute condition must pin the exchange to the configured repository."
  }

  # The impersonation binding is scoped to the same repository rather than to
  # the whole pool. Its member string embeds the pool's resource name, which GCP
  # only assigns on apply, so it cannot be asserted at plan time; what is
  # checkable here is that exactly one binding exists and that it grants only
  # impersonation. The attribute condition above is the control that holds
  # regardless, because it is evaluated before any binding is consulted.
  assert {
    condition     = length(google_service_account_iam_member.ci_workload_identity) == 1
    error_message = "There must be exactly one workload identity binding."
  }

  assert {
    condition     = google_service_account_iam_member.ci_workload_identity[0].role == "roles/iam.workloadIdentityUser"
    error_message = "The binding must grant impersonation only."
  }

  assert {
    condition     = google_iam_workload_identity_pool_provider.github[0].oidc[0].issuer_uri == "https://token.actions.githubusercontent.com"
    error_message = "The issuer must be GitHub's OIDC endpoint."
  }
}

run "ci_cannot_read_employee_data_or_write_anything" {
  command = plan

  variables {
    ci_github_repository = "LeeMokoto/welo-absenteeism-analytics-mockup"
    ci_state_bucket      = "welo-test-tfstate"
  }

  # roles/viewer would hand CI the contents of every tenant bucket. The granted
  # set is metadata only, and nothing in it writes.
  assert {
    condition = alltrue([
      for r in google_project_iam_member.ci :
      !contains([
        "roles/viewer",
        "roles/editor",
        "roles/owner",
        "roles/storage.objectViewer",
        "roles/storage.objectUser",
        "roles/storage.admin",
        "roles/secretmanager.secretAccessor",
      ], r.role)
    ])
    error_message = "The CI identity must not hold a role that reads object data or secret payloads, and must not hold a primitive role."
  }

  assert {
    condition     = alltrue([for r in google_project_iam_member.ci : endswith(r.role, "viewer") || endswith(r.role, "Viewer") || endswith(r.role, "reader")])
    error_message = "Every project role held by CI must be read-only."
  }

  # The single object-level grant is the state bucket, granted on that bucket
  # rather than at the project level.
  assert {
    condition     = google_storage_bucket_iam_member.ci_state[0].bucket == "welo-test-tfstate"
    error_message = "CI's only object access must be the state bucket."
  }
}

run "a_wildcard_repository_is_rejected" {
  command = plan

  variables {
    ci_github_repository = "LeeMokoto/*"
  }

  expect_failures = [var.ci_github_repository]
}

# --- Budget -----------------------------------------------------------------
# The budget is optional because it needs a billing account id and the
# permission to read it. Optional must mean absent, not half-created.

run "no_budget_unless_a_billing_account_and_amount_are_given" {
  command = plan

  variables {
    billing_account = ""
    budget_amount   = 50
  }

  assert {
    condition     = length(google_billing_budget.project) == 0
    error_message = "A budget must not be created without a billing account."
  }
}

run "a_budget_alerts_before_it_is_exceeded_not_after" {
  command = plan

  variables {
    billing_account = "012345-67890A-BCDEF0"
    budget_amount   = 50
  }

  assert {
    condition     = length(google_billing_budget.project) == 1
    error_message = "A billing account and an amount should produce a budget."
  }

  # A budget that only alerts at 100 percent tells you after the money is spent.
  assert {
    condition = anytrue([
      for r in google_billing_budget.project[0].threshold_rules :
      r.threshold_percent < 1.0
    ])
    error_message = "The budget must alert below 100 percent, not only once it is exceeded."
  }

  # A step change in run rate partway through a month only shows up in actual
  # spend near month end. The forecast rule is what catches it early.
  assert {
    condition = anytrue([
      for r in google_billing_budget.project[0].threshold_rules :
      r.spend_basis == "FORECASTED_SPEND"
    ])
    error_message = "The budget must carry a forecast rule, or a mid-month run-rate change is caught too late."
  }

  # Scoped to this project, so another project in the billing account cannot
  # consume the budget and silence the alert.
  assert {
    condition     = contains(google_billing_budget.project[0].budget_filter[0].projects, "projects/welo-test")
    error_message = "The budget must be scoped to this project."
  }
}
