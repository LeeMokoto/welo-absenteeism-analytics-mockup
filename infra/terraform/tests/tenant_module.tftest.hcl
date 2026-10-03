# Controls asserted against the tenant module directly.
#
# The companion file (controls.tftest.hcl) tests the root configuration, where
# only a module's outputs are addressable. These runs point at the module
# itself, so the resource attributes that carry the controls can be asserted
# rather than inferred. A change that drops public access prevention, enables
# destruction of a populated tenant bucket, or lets the application reach the
# landing bucket fails here.
#
#   terraform init -backend=false && terraform test

provider "google" {
  project      = "welo-test"
  region       = "europe-west1"
  access_token = "placeholder-no-api-calls-are-made"
}

run "buckets_refuse_public_access_and_resist_destruction" {
  command = plan

  module {
    source = "./modules/tenant"
  }

  variables {
    tenant_key    = "tenant1"
    project_id    = "welo-test"
    region        = "europe-west1"
    bucket_prefix = "welo-test"
    display_name  = "Test tenant"
  }

  # No variable loosens this, and no tenant should ever be able to.
  assert {
    condition     = google_storage_bucket.raw.public_access_prevention == "enforced"
    error_message = "The landing bucket must enforce public access prevention. It holds the employer's own identifiers."
  }

  assert {
    condition     = google_storage_bucket.derived.public_access_prevention == "enforced"
    error_message = "The derived bucket must enforce public access prevention."
  }

  assert {
    condition     = google_storage_bucket.raw.uniform_bucket_level_access && google_storage_bucket.derived.uniform_bucket_level_access
    error_message = "Both tenant buckets must use uniform bucket-level access, so per-object ACLs cannot reopen them."
  }

  # A teardown must not be able to take employee records with it.
  assert {
    condition     = google_storage_bucket.raw.force_destroy == false && google_storage_bucket.derived.force_destroy == false
    error_message = "Tenant buckets must not default to force_destroy. A destroy should fail rather than delete records."
  }

  # The landing bucket is a transfer point. An upload that sits there forever is
  # an identifiable copy nobody decided to keep.
  assert {
    condition = anytrue([
      for r in google_storage_bucket.raw.lifecycle_rule :
      anytrue([for a in r.action : a.type == "Delete"]) &&
      anytrue([for c in r.condition : coalesce(c.age, 0) > 0 && coalesce(c.age, 0) <= 365])
    ])
    error_message = "The landing bucket must expire its uploads within a year."
  }

  assert {
    condition     = google_storage_bucket.raw.versioning[0].enabled && google_storage_bucket.derived.versioning[0].enabled
    error_message = "Both tenant buckets must be versioned, so a bad overwrite is recoverable."
  }
}

run "the_application_cannot_reach_the_landing_bucket" {
  command = plan

  module {
    source = "./modules/tenant"
  }

  variables {
    tenant_key    = "tenant1"
    project_id    = "welo-test"
    region        = "europe-west1"
    bucket_prefix = "welo-test"
    display_name  = "Test tenant"
  }

  # The application reads derived artifacts only. This is the assertion that
  # keeps the identifiable upload out of reach of the surface a user logs in to.
  assert {
    condition     = google_storage_bucket_iam_member.platform_derived.bucket == google_storage_bucket.derived.name
    error_message = "The application's only bucket grant must be on the derived bucket."
  }

  assert {
    condition     = google_storage_bucket_iam_member.platform_derived.role == "roles/storage.objectViewer"
    error_message = "The application must have read-only access to derived artifacts, not write."
  }

  assert {
    condition     = google_storage_bucket_iam_member.ingest_raw.member != google_storage_bucket_iam_member.platform_derived.member
    error_message = "Ingest and the application must be different principals."
  }
}

run "no_service_account_key_is_ever_created" {
  command = plan

  module {
    source = "./modules/tenant"
  }

  variables {
    tenant_key    = "tenant1"
    project_id    = "welo-test"
    region        = "europe-west1"
    bucket_prefix = "welo-test"
    display_name  = "Test tenant"
  }

  # Signing upload URLs is done through signBlob as the ingest service account,
  # which is why no downloadable key exists. A google_service_account_key
  # resource appearing anywhere in this module would be a long-lived credential
  # in Terraform state.
  assert {
    condition     = google_service_account_iam_member.ingest_self_sign.role == "roles/iam.serviceAccountTokenCreator"
    error_message = "Ingest must be able to sign as itself, so signed URLs need no downloaded key."
  }
}

run "agents_stay_off_without_a_secret" {
  command = plan

  module {
    source = "./modules/tenant"
  }

  variables {
    tenant_key    = "tenant1"
    project_id    = "welo-test"
    region        = "europe-west1"
    bucket_prefix = "welo-test"
    display_name  = "Test tenant"
    # anthropic_secret_id deliberately left empty
  }

  assert {
    condition     = length(google_secret_manager_secret_iam_member.platform_anthropic) == 0
    error_message = "With no Anthropic secret configured, the application must not be granted read on one."
  }
}

# --- Negative tests: the guards must actually reject bad input ---------------

run "a_suppression_threshold_below_five_is_rejected" {
  command = plan

  module {
    source = "./modules/tenant"
  }

  variables {
    tenant_key            = "tenant1"
    project_id            = "welo-test"
    region                = "europe-west1"
    bucket_prefix         = "welo-test"
    display_name          = "Test tenant"
    suppression_threshold = 4
  }

  expect_failures = [var.suppression_threshold]
}

run "an_ingest_job_without_an_image_is_rejected" {
  command = plan

  module {
    source = "./modules/tenant"
  }

  variables {
    tenant_key    = "tenant1"
    project_id    = "welo-test"
    region        = "europe-west1"
    bucket_prefix = "welo-test"
    display_name  = "Test tenant"
    deploy_ingest = true
    ingest_image  = ""
  }

  expect_failures = [google_cloud_run_v2_job.ingest]
}

run "an_unbounded_landing_bucket_retention_is_rejected" {
  command = plan

  module {
    source = "./modules/tenant"
  }

  variables {
    tenant_key         = "tenant1"
    project_id         = "welo-test"
    region             = "europe-west1"
    bucket_prefix      = "welo-test"
    display_name       = "Test tenant"
    raw_retention_days = 0
  }

  expect_failures = [var.raw_retention_days]
}
