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
