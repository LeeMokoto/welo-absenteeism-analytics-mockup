# One tenant of the Welo platform.
#
# The architecture calls for each tenant to be an isolated instantiation rather
# than a row in a shared table. This module is that instantiation: a landing
# bucket the employer uploads to, a derived bucket holding only pseudonymised
# artifacts, a pseudonymisation key that belongs to this tenant alone, two
# least-privilege service accounts, and optionally the processing job and the
# application itself.
#
# Three things are deliberate.
#
# The pseudonymisation key is per tenant and Terraform never holds its value.
# Ingest reads it to hash employee identifiers, so one tenant's hashes can never
# be joined to another's, and a key that Terraform does not know cannot leak
# through state. Rotating it makes previously stored hashes unresolvable, which
# is why docs/data-governance.md treats rotation as a deliberate act.
#
# The buckets refuse public access unconditionally. Not a variable: a bucket
# holding employee records, pseudonymised or not, has no setting under which
# being world-readable is correct.
#
# The suppression floor is asserted here as well as in the application. The
# control should not depend on one side of the deployment getting it right.

locals {
  name = "welo-${var.tenant_key}"

  labels = merge(var.labels, {
    tenant     = var.tenant_key
    managed-by = "terraform"
  })

  agents_enabled = var.anthropic_secret_id != ""

  bool_env = {
    true  = "1"
    false = "0"
  }

  # The application manifest for this tenant. Exposed as an output so the
  # Vercel path sets exactly what the Cloud Run path sets: one definition of
  # what a tenant is, whoever hosts it.
  manifest_env = {
    WELO_TENANT_NAME           = var.display_name
    WELO_TENANT_ENV            = var.environment
    WELO_TENANT_SYNTHETIC      = local.bool_env[tostring(var.synthetic)]
    WELO_SUPPRESSION_THRESHOLD = tostring(var.suppression_threshold)
    WELO_MODULE_ABSENCE        = local.bool_env[tostring(var.modules.absence)]
    WELO_MODULE_SICK_LEAVE     = local.bool_env[tostring(var.modules.sick_leave)]
    WELO_MODULE_CONTROL_CENTRE = local.bool_env[tostring(var.modules.control_centre)]
    WELO_AGENT_MODEL           = var.agent_model
    SICK_LEAVE_AGENT_MODEL     = var.sick_leave_agent_model
  }
}

# --- Landing bucket ---------------------------------------------------------
# Where the employer uploads a canonical-schema extract through a signed URL.
# Short retention: this is a transfer point. Versioning is on so an overwrite
# of an upload in progress is recoverable rather than silently destructive.

resource "google_storage_bucket" "raw" {
  # checkov:skip=CKV_GCP_62: Access logging for this bucket is configured
  # project-wide through google_project_iam_audit_config in the root module, which
  # records every read and write of its objects in Cloud Audit Logs and covers
  # buckets added later. Per-bucket logging would be a second, partial copy.
  name     = "${var.bucket_prefix}-${var.tenant_key}-raw"
  location = var.region
  project  = var.project_id
  labels   = local.labels

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = var.force_destroy_buckets

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = var.raw_retention_days
    }
    action {
      type = "Delete"
    }
  }

  # Superseded versions go sooner than the live object: they exist to recover a
  # bad overwrite, not to accumulate copies of identifiable data.
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 7
    }
    action {
      type = "Delete"
    }
  }

  lifecycle_rule {
    condition {
      age            = 1
      with_state     = "ANY"
      matches_prefix = ["incomplete/"]
    }
    action {
      type = "Delete"
    }
  }

  dynamic "encryption" {
    for_each = var.kms_key_name != "" ? [1] : []
    content {
      default_kms_key_name = var.kms_key_name
    }
  }
}

# --- Derived bucket ---------------------------------------------------------
# Pseudonymised artifacts only: the dashboard feed, model outputs, aggregates.
# Nothing here should carry an employer identifier.

resource "google_storage_bucket" "derived" {
  # checkov:skip=CKV_GCP_62: Access logging for this bucket is configured
  # project-wide through google_project_iam_audit_config in the root module, which
  # records every read and write of its objects in Cloud Audit Logs and covers
  # buckets added later. Per-bucket logging would be a second, partial copy.
  name     = "${var.bucket_prefix}-${var.tenant_key}-derived"
  location = var.region
  project  = var.project_id
  labels   = local.labels

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = var.force_destroy_buckets

  versioning {
    enabled = true
  }

  dynamic "lifecycle_rule" {
    for_each = var.derived_retention_days > 0 ? [1] : []
    content {
      condition {
        age = var.derived_retention_days
      }
      action {
        type = "Delete"
      }
    }
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  dynamic "encryption" {
    for_each = var.kms_key_name != "" ? [1] : []
    content {
      default_kms_key_name = var.kms_key_name
    }
  }
}

# --- Pseudonymisation key ---------------------------------------------------
# The HMAC key ingest uses to hash employee identifiers for this tenant. The
# secret container is created here; the value is added out of band so it never
# enters Terraform state:
#
#   openssl rand -base64 48 | tr -d '\n' | \
#     gcloud secrets versions add <id> --data-file=- --project=<project>
#
# This key is also what makes a subject request answerable: the employer
# supplies the identifier, ingest hashes it with this key, and the records are
# located. Rotate it and the old hashes stop resolving.

resource "google_secret_manager_secret" "pseudonymisation_key" {
  project   = var.project_id
  secret_id = "${local.name}-pseudonymisation-key"
  labels    = local.labels

  replication {
    auto {}
  }
}

# --- Service accounts -------------------------------------------------------

resource "google_service_account" "ingest" {
  project      = var.project_id
  account_id   = "${local.name}-ingest"
  display_name = "Welo ingest and processing, tenant ${var.tenant_key}"
}

resource "google_service_account" "platform" {
  project      = var.project_id
  account_id   = "${local.name}-platform"
  display_name = "Welo platform application, tenant ${var.tenant_key}"
}

# Ingest reads the uploads and deletes them once processed, and writes the
# derived artifacts. objectUser covers read, write and delete on the landing
# bucket without granting bucket administration.
resource "google_storage_bucket_iam_member" "ingest_raw" {
  bucket = google_storage_bucket.raw.name
  role   = "roles/storage.objectUser"
  member = google_service_account.ingest.member
}

resource "google_storage_bucket_iam_member" "ingest_derived" {
  bucket = google_storage_bucket.derived.name
  role   = "roles/storage.objectUser"
  member = google_service_account.ingest.member
}

# The application reads derived artifacts and nothing else. It has no access to
# the landing bucket at all, so the identifiable upload is never reachable from
# the surface a user logs in to.
resource "google_storage_bucket_iam_member" "platform_derived" {
  bucket = google_storage_bucket.derived.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.platform.member
}

resource "google_secret_manager_secret_iam_member" "ingest_key" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.pseudonymisation_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.ingest.member
}

# Signing an upload URL means signing as this service account. Granting it
# tokenCreator on itself lets it call signBlob, so the signed URL flow needs no
# downloaded service account key anywhere.
resource "google_service_account_iam_member" "ingest_self_sign" {
  service_account_id = google_service_account.ingest.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.ingest.member
}

resource "google_secret_manager_secret_iam_member" "platform_anthropic" {
  count     = local.agents_enabled ? 1 : 0
  project   = var.project_id
  secret_id = var.anthropic_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.platform.member
}

# --- Ingest and processing job ---------------------------------------------
# A batch job rather than a service: ingest is a file arriving, being
# pseudonymised, scored and turned into a feed, then the upload being deleted.
# Run it after an upload (or on a schedule) with:
#
#   gcloud run jobs execute <name> --region <region> --project <project>

resource "google_cloud_run_v2_job" "ingest" {
  count    = var.deploy_ingest ? 1 : 0
  name     = "${local.name}-ingest"
  location = var.region
  project  = var.project_id
  labels   = local.labels

  deletion_protection = false

  lifecycle {
    precondition {
      condition     = var.ingest_image != ""
      error_message = "ingest_image must be set when deploy_ingest = true."
    }
  }

  template {
    task_count = 1
    labels     = local.labels

    template {
      service_account = google_service_account.ingest.email
      max_retries     = 1
      timeout         = "${var.ingest_timeout_seconds}s"

      containers {
        image = var.ingest_image

        resources {
          limits = {
            cpu    = var.ingest_cpu
            memory = var.ingest_memory
          }
        }

        env {
          name  = "WELO_TENANT_KEY"
          value = var.tenant_key
        }
        env {
          name  = "WELO_RAW_BUCKET"
          value = google_storage_bucket.raw.name
        }
        env {
          name  = "WELO_DERIVED_BUCKET"
          value = google_storage_bucket.derived.name
        }
        env {
          name  = "WELO_SUPPRESSION_THRESHOLD"
          value = tostring(var.suppression_threshold)
        }

        # The pseudonymisation key reaches the job from Secret Manager at run
        # time. It is never an argument, never in state and never in an image.
        env {
          name = "WELO_PSEUDONYMISATION_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.pseudonymisation_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.ingest_key,
    google_storage_bucket_iam_member.ingest_raw,
    google_storage_bucket_iam_member.ingest_derived,
  ]
}

# --- The platform application (optional) -----------------------------------
# Only when this tenant runs on Cloud Run rather than Vercel. The environment
# is local.manifest_env either way, so the two hosting paths cannot drift.

resource "google_cloud_run_v2_service" "platform" {
  count               = var.deploy_platform ? 1 : 0
  name                = "${local.name}-platform"
  location            = var.region
  project             = var.project_id
  labels              = local.labels
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  lifecycle {
    precondition {
      condition     = var.platform_image != ""
      error_message = "platform_image must be set when deploy_platform = true."
    }
  }

  template {
    service_account = google_service_account.platform.email
    labels          = local.labels

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.platform_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.platform_cpu
          memory = var.platform_memory
        }
        cpu_idle = true
      }

      dynamic "env" {
        for_each = local.manifest_env
        content {
          name  = env.key
          value = env.value
        }
      }

      # Without the key the application still renders and the agent panels show
      # a clear disabled state, so this is additive rather than required.
      dynamic "env" {
        for_each = local.agents_enabled ? [1] : []
        content {
          name = "ANTHROPIC_API_KEY"
          value_source {
            secret_key_ref {
              secret  = var.anthropic_secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/"
          port = 8080
        }
        initial_delay_seconds = 3
        period_seconds        = 5
        timeout_seconds       = 3
        failure_threshold     = 12
      }

      liveness_probe {
        http_get {
          path = "/"
          port = 8080
        }
        period_seconds = 30
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.platform_anthropic]
}

# A public URL suits the demo tenant. For a real tenant this should be false and
# access should come through the identity provider, not an open endpoint.
resource "google_cloud_run_v2_service_iam_member" "platform_public" {
  count    = var.deploy_platform && var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  name     = google_cloud_run_v2_service.platform[0].name
  location = google_cloud_run_v2_service.platform[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
