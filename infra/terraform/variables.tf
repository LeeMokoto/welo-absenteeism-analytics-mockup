# All infrastructure is parameterised so the same config runs in your demo
# project today and the client's project later. To migrate, point Terraform at a
# new state and a new *.tfvars (see infra/README.md). Nothing here hardcodes a
# project.

variable "project_id" {
  type        = string
  description = "GCP project to deploy into."
}

variable "region" {
  type        = string
  description = "GCP region for Cloud Run, Artifact Registry and the bucket."
  default     = "europe-west1" # africa-south1 (Johannesburg) is an option for SA clients
}

# --- The inference service (Cloud Run) --------------------------------------

variable "service_name" {
  type        = string
  description = "Cloud Run service name."
  default     = "welo-inference"
}

variable "image" {
  type        = string
  description = <<-EOT
    Full image ref the service runs, e.g.
    europe-west1-docker.pkg.dev/PROJECT/welo/welo-inference:latest.
    Build and push it first (infra/scripts/build_and_push.sh).
  EOT
}

variable "memory" {
  type        = string
  description = "Container memory. 1Gi is needed to load the model + SHAP."
  default     = "1Gi"
}

variable "cpu" {
  type        = string
  description = "Container vCPU."
  default     = "1"
}

variable "min_instances" {
  type        = number
  description = "Minimum instances. 0 = scale to zero (cheapest for a demo)."
  default     = 0
}

variable "max_instances" {
  type        = number
  description = "Maximum instances."
  default     = 3
}

variable "allow_unauthenticated" {
  type        = bool
  description = "Public Cloud Run URL. True for a demo; an org policy may block allUsers."
  default     = true
}

# --- Sick Leave dashboard (Next.js on Cloud Run) ----------------------------

variable "deploy_sick_leave" {
  type        = bool
  description = <<-EOT
    Deploy the Next.js Sick Leave Intelligence dashboard as a second Cloud Run
    service. Defaults to false because that dashboard is currently hosted on
    Vercel; set it true (and supply sick_leave_image) only if you want to run it
    on Cloud Run instead, for example to keep it inside the client's project.
  EOT
  default     = false
}

variable "sick_leave_service_name" {
  type        = string
  description = "Cloud Run service name for the sick-leave dashboard."
  default     = "welo-sick-leave"
}

variable "sick_leave_image" {
  type        = string
  description = <<-EOT
    Full image ref for the sick-leave dashboard, e.g.
    europe-west1-docker.pkg.dev/PROJECT/welo/welo-sick-leave:latest.
    Build and push it with infra/scripts/build_and_push_sick_leave.sh. Required
    when deploy_sick_leave = true.
  EOT
  default     = ""
}

variable "sick_leave_memory" {
  type        = string
  description = "Container memory for the sick-leave service. The Next server is light."
  default     = "512Mi"
}

variable "sick_leave_enable_agents" {
  type        = bool
  description = <<-EOT
    Inject the Anthropic key into the sick-leave service so its three agents work.
    Leave false for the first deploy (the dashboard renders with the panels
    disabled); add the key to the secret, then set true and re-apply. This uses
    the first-party Anthropic key path.
  EOT
  default     = false
}

variable "sick_leave_agent_model" {
  type        = string
  description = "Model the sick-leave agents call."
  default     = "claude-sonnet-5"
}

# --- Agents (LLM provider) ---------------------------------------------------

variable "llm_provider" {
  type        = string
  description = <<-EOT
    Where the agents call Claude. "anthropic" (default) uses the first-party
    Anthropic API with an API key from Secret Manager: right for the public
    demo. "vertex" uses Claude on Google Vertex AI with the runtime service
    account (GCP IAM, no API key): the preferred path for Welo's own project,
    keeping data in a chosen Google region and removing a long-lived secret.
  EOT
  default     = "anthropic"
  validation {
    condition     = contains(["anthropic", "vertex"], var.llm_provider)
    error_message = "llm_provider must be \"anthropic\" or \"vertex\"."
  }
}

variable "vertex_region" {
  type        = string
  description = <<-EOT
    Vertex AI region that serves the Claude models when llm_provider = vertex,
    e.g. us-east5 or europe-west1. Choose one that meets data-residency needs.
  EOT
  default     = "us-east5"
}

variable "enable_agents" {
  type        = bool
  description = <<-EOT
    Turn the AI agents on. For the anthropic provider this wires the
    ANTHROPIC_API_KEY secret into the service, so leave it false for the first
    deploy (the what-if panel works without a key), add the key to the secret,
    then flip it to true. For the vertex provider no secret is needed; set it
    true once the runtime service account has Vertex access.
  EOT
  default     = false
}

variable "agent_model" {
  type        = string
  description = "Model the agents call."
  default     = "claude-opus-4-8"
}

variable "rate_limit_per_min" {
  type        = number
  description = "Per-client cap on the /scenario endpoint. 0 disables it."
  default     = 60
}

variable "secret_id" {
  type        = string
  description = "Secret Manager secret id holding the Anthropic API key."
  default     = "anthropic-api-key"
}

variable "create_secret_version" {
  type        = bool
  description = <<-EOT
    If true, Terraform writes anthropic_api_key into the secret (value lands in
    state). Recommended: leave false and add the key out of band with gcloud so
    it never touches Terraform state.
  EOT
  default     = false
}

variable "anthropic_api_key" {
  type        = string
  description = "Only used when create_secret_version = true. Keep out of git."
  sensitive   = true
  default     = ""
}

# --- Tenants -----------------------------------------------------------------
# The platform's unit of isolation. Each entry becomes one instantiation of
# modules/tenant: its own buckets, its own pseudonymisation key, its own service
# accounts, and optionally its own application instance. Adding a tenant is
# adding a map entry, which is the whole point of the architecture: one
# codebase, many deployments, no fork.

variable "bucket_prefix" {
  type        = string
  description = <<-EOT
    Prefix for every tenant bucket name. A tenant's buckets are
    <prefix>-<tenant>-raw and <prefix>-<tenant>-derived.

    Deliberately has no default. Bucket names are global across all of GCS, so a
    guessable default would either collide with someone else's bucket or, worse,
    quietly be the name a future operator also guesses. Choose something that
    identifies this deployment, e.g. "welo-za" or the client's own prefix.
  EOT
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,28}[a-z0-9]$", var.bucket_prefix))
    error_message = "bucket_prefix must be 3-30 chars, lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "tenants" {
  type = map(object({
    display_name          = string
    environment           = optional(string, "demo")
    synthetic             = optional(bool, true)
    suppression_threshold = optional(number, 5)
    modules = optional(object({
      absence        = bool
      sick_leave     = bool
      control_centre = bool
      }), {
      absence        = true
      sick_leave     = true
      control_centre = false
    })
    region                 = optional(string, "")
    raw_retention_days     = optional(number, 30)
    derived_retention_days = optional(number, 730)
    kms_key_name           = optional(string, "")
    force_destroy_buckets  = optional(bool, false)
    deploy_ingest          = optional(bool, false)
    ingest_image           = optional(string, "")
    deploy_platform        = optional(bool, false)
    platform_image         = optional(string, "")
    allow_unauthenticated  = optional(bool, false)
    enable_agents          = optional(bool, false)
    labels                 = optional(map(string), {})
  }))
  description = <<-EOT
    Tenants to provision, keyed by tenant id (lowercase, hyphens). The id is
    permanent: changing it replaces every resource belonging to that tenant.

    Per tenant, `region` empty inherits var.region, `enable_agents` wires the
    shared Anthropic key secret into that tenant's application, and
    `deploy_platform` decides whether the application runs on Cloud Run here or
    stays on Vercel (in which case the tenant's environment still comes out of
    this module, as the tenant_platform_env output).

    Default is a single demo tenant, which is what the current deployment is.
  EOT
  default = {
    demo = {
      display_name = "Demo tenant"
      environment  = "demo"
      synthetic    = true
    }
  }
}

# --- CORS --------------------------------------------------------------------

variable "cors_origins" {
  type        = list(string)
  description = "Allowed browser origins. Lock to the dashboard origin in production."
  default     = ["*"]
}

# --- Dashboard static hosting (optional) ------------------------------------

variable "host_dashboard" {
  type        = bool
  description = "Create a GCS bucket to serve the static dashboard. Optional."
  default     = true
}

variable "dashboard_bucket" {
  type        = string
  description = "Globally-unique bucket name for the dashboard. Required if host_dashboard."
  default     = ""
}

variable "dashboard_public" {
  type        = bool
  description = "Make the dashboard bucket world-readable. An org policy may block this."
  default     = true
}
