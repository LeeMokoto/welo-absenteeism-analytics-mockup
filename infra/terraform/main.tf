locals {
  use_anthropic = var.llm_provider == "anthropic"
  use_vertex    = var.llm_provider == "vertex"

  # The Anthropic API-key secret is only wired into the inference service for the
  # anthropic provider with agents enabled. Vertex authenticates as the runtime
  # service account, so it needs no secret.
  anthropic_key_env = local.use_anthropic && var.enable_agents

  # The Next.js sick-leave dashboard uses the first-party Anthropic key path, so
  # it wants the same secret whenever its agents are enabled.
  sick_leave_key_env = var.deploy_sick_leave && var.sick_leave_enable_agents

  # Create the Secret Manager secret when either service needs the Anthropic key
  # (the inference service on the anthropic provider, or the sick-leave app).
  create_key_secret = local.use_anthropic || local.sick_leave_key_env
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

# --- Sick Leave Intelligence dashboard (Next.js on Cloud Run) ---------------
# Wired the same way as the inference service: its own least-privilege runtime
# service account, and the Anthropic key injected from the same Secret Manager
# secret when its agents are enabled. Uses the first-party Anthropic key path
# (model claude-sonnet-5 by default). Deployed from the root Dockerfile.

resource "google_service_account" "sick_leave_run" {
  count        = var.deploy_sick_leave ? 1 : 0
  account_id   = "${var.sick_leave_service_name}-sa"
  display_name = "Welo sick-leave dashboard Cloud Run runtime"
}

# The sick-leave runtime SA may read the shared Anthropic key secret when its
# agents are enabled. Bound at the secret level, not the project.
resource "google_secret_manager_secret_iam_member" "sick_leave_access" {
  count     = local.sick_leave_key_env && local.create_key_secret ? 1 : 0
  secret_id = google_secret_manager_secret.anthropic[0].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.sick_leave_run[0].email}"
}

resource "google_cloud_run_v2_service" "sick_leave" {
  count               = var.deploy_sick_leave ? 1 : 0
  name                = var.sick_leave_service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  lifecycle {
    precondition {
      condition     = var.sick_leave_image != ""
      error_message = "sick_leave_image must be set when deploy_sick_leave = true. Build it with infra/scripts/build_and_push_sick_leave.sh."
    }
  }

  template {
    service_account = google_service_account.sick_leave_run[0].email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.sick_leave_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.sick_leave_memory
        }
        cpu_idle = true
      }

      env {
        name  = "SICK_LEAVE_AGENT_MODEL"
        value = var.sick_leave_agent_model
      }

      # The Anthropic API key is injected from Secret Manager only when the
      # sick-leave agents are enabled. Without it the dashboard still renders and
      # the three agent panels show a clear disabled state.
      dynamic "env" {
        for_each = local.sick_leave_key_env ? [1] : []
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

      # The Next server answers 200 at "/" once it is up.
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

  depends_on = [
    google_project_service.services,
    google_secret_manager_secret_iam_member.sick_leave_access,
  ]
}

# Public invoke for the demo. Same org-policy caveat as the inference service.
resource "google_cloud_run_v2_service_iam_member" "sick_leave_public" {
  count    = var.deploy_sick_leave && var.allow_unauthenticated ? 1 : 0
  name     = google_cloud_run_v2_service.sick_leave[0].name
  location = google_cloud_run_v2_service.sick_leave[0].location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
