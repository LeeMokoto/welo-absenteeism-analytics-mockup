locals {
  use_anthropic = var.llm_provider == "anthropic"
  use_vertex    = var.llm_provider == "vertex"

  # The Anthropic API-key secret is only wired in for the anthropic provider
  # with agents enabled. Vertex authenticates as the runtime service account, so
  # it needs no secret.
  anthropic_key_env = local.use_anthropic && var.enable_agents

  # Only create the Secret Manager secret on the anthropic path; the vertex path
  # has no key to hold.
  create_key_secret = local.use_anthropic
}

# --- Enable the APIs this stack uses ----------------------------------------

resource "google_project_service" "services" {
  for_each = toset(concat([
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
  ], local.use_vertex ? ["aiplatform.googleapis.com"] : []))
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

# --- Secret for the Anthropic API key (anthropic provider only) -------------
# Created only when llm_provider = anthropic; the vertex path has no key. The
# container (secret) holds the key; the value is added out of band with gcloud
# by default (set create_secret_version = true to let Terraform write it, in
# which case the value lands in state).

resource "google_secret_manager_secret" "anthropic" {
  count     = local.create_key_secret ? 1 : 0
  secret_id = var.secret_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.services]
}

resource "google_secret_manager_secret_version" "anthropic" {
  count       = local.create_key_secret && var.create_secret_version && var.anthropic_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.anthropic[0].id
  secret_data = var.anthropic_api_key
}

# The runtime SA may read the secret. Bound at the secret level, not project.
resource "google_secret_manager_secret_iam_member" "run_access" {
  count     = local.create_key_secret ? 1 : 0
  secret_id = google_secret_manager_secret.anthropic[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.run.email}"
}

# --- Vertex AI access (vertex provider only) --------------------------------
# The runtime service account calls the Claude models on Vertex directly; no key
# or secret is involved. roles/aiplatform.user is the least-privilege role for
# invoking models. Bound at the project level, which Vertex requires.

resource "google_project_iam_member" "vertex_user" {
  count   = local.use_vertex ? 1 : 0
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.run.email}"

  depends_on = [google_project_service.services]
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
      env {
        name  = "WELO_LLM_PROVIDER"
        value = var.llm_provider
      }

      # Vertex path: point the service at the project and region. Auth is the
      # runtime service account (no key).
      dynamic "env" {
        for_each = local.use_vertex ? [1] : []
        content {
          name  = "WELO_VERTEX_PROJECT"
          value = var.project_id
        }
      }
      dynamic "env" {
        for_each = local.use_vertex ? [1] : []
        content {
          name  = "WELO_VERTEX_REGION"
          value = var.vertex_region
        }
      }

      # Anthropic path: the API key is injected from Secret Manager only when
      # agents are enabled.
      dynamic "env" {
        for_each = local.anthropic_key_env ? [1] : []
        content {
          name = "ANTHROPIC_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.anthropic[0].secret_id
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
    google_project_iam_member.vertex_user,
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
