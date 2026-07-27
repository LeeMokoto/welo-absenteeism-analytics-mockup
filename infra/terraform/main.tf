locals {
  # Agent env is only attached when enabled AND a secret version exists, so the
  # first deploy (no key) never fails on a missing secret version.
  agent_env_enabled = var.enable_agents
}

# --- Enable the APIs this stack uses ----------------------------------------

resource "google_project_service" "services" {
  for_each = toset([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# --- Artifact Registry (holds the container image) --------------------------

resource "google_artifact_registry_repository" "welo" {
  location      = var.region
  repository_id = "welo"
  description   = "Welo inference container images"
  format        = "DOCKER"

  depends_on = [google_project_service.services]
}

# --- Runtime service account (least privilege) ------------------------------

resource "google_service_account" "run" {
  account_id   = "${var.service_name}-sa"
  display_name = "Welo inference Cloud Run runtime"
}

# --- Secret for the Anthropic API key ---------------------------------------
# The container (secret) is always created so the key has a home. The value is
# added out of band with gcloud by default; set create_secret_version = true to
# let Terraform write it (value then lives in state).

resource "google_secret_manager_secret" "anthropic" {
  secret_id = var.secret_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "anthropic" {
  count       = var.create_secret_version && var.anthropic_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.anthropic.id
  secret_data = var.anthropic_api_key
}

# The runtime SA may read the secret. Bound at the secret level, not project.
resource "google_secret_manager_secret_iam_member" "run_access" {
  secret_id = google_secret_manager_secret.anthropic.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

# --- Cloud Run service ------------------------------------------------------

resource "google_cloud_run_v2_service" "welo" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.run.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }

      env {
        name  = "WELO_CORS_ORIGINS"
        value = join(",", var.cors_origins)
      }
      env {
        name  = "WELO_AGENT_MODEL"
        value = var.agent_model
      }
      env {
        name  = "WELO_RATE_LIMIT_PER_MIN"
        value = tostring(var.rate_limit_per_min)
      }

      # The API key is injected from Secret Manager only when agents are enabled.
      dynamic "env" {
        for_each = local.agent_env_enabled ? [1] : []
        content {
          name = "ANTHROPIC_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.anthropic.secret_id
              version = "latest"
            }
          }
        }
      }

      # Model load takes a few seconds; give startup room before routing traffic.
      startup_probe {
        http_get {
          path = "/readyz"
          port = 8080
        }
        initial_delay_seconds = 5
        period_seconds        = 10
        timeout_seconds       = 5
        failure_threshold     = 12
      }

      liveness_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        period_seconds = 30
      }
    }
  }

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret_iam_member.run_access,
  ]
}

# Public invoke for the demo. An org policy (iam.allowedPolicyMemberDomains) may
# block allUsers; set allow_unauthenticated = false and front it another way.
resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.welo.name
  location = google_cloud_run_v2_service.welo.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Dashboard static hosting (optional) ------------------------------------

resource "google_storage_bucket" "dashboard" {
  count                       = var.host_dashboard ? 1 : 0
  name                        = var.dashboard_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "index.html"
  }

  depends_on = [google_project_service.services]
}

resource "google_storage_bucket_iam_member" "dashboard_public" {
  count  = var.host_dashboard && var.dashboard_public ? 1 : 0
  bucket = google_storage_bucket.dashboard[0].name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
