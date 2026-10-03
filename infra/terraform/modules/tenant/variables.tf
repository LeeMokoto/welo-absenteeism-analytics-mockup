# Inputs for one tenant.
#
# A tenant is one instantiation of this module. Everything here is tenant
# scoped: its own buckets, its own pseudonymisation key, its own service
# accounts, its own application instance. Nothing is shared between tenants
# except the container images and, optionally, the Anthropic key secret.

variable "tenant_key" {
  type        = string
  description = <<-EOT
    Short, stable identifier for the tenant, used in resource names. Lowercase
    letters, digits and hyphens, e.g. "demo" or "glencore". Changing it
    replaces every resource in this module, so treat it as permanent.
  EOT
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,18}[a-z0-9]$", var.tenant_key))
    error_message = "tenant_key must be 3-20 chars, lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "project_id" {
  type        = string
  description = "GCP project this tenant is provisioned into."
}

variable "region" {
  type        = string
  description = "Region for the tenant's buckets, job and service."
}

variable "bucket_prefix" {
  type        = string
  description = <<-EOT
    Prefix for the tenant's bucket names, which must be globally unique across
    all of GCS. Buckets are named <prefix>-<tenant_key>-raw and
    <prefix>-<tenant_key>-derived, so use something owned, e.g. "welo".
  EOT
}

# --- What the tenant sees (the application manifest) ------------------------
# These map one to one onto the environment variables lib/platform/manifest.js
# reads. The manifest is the contract between this module and the application:
# a tenant differs from another by these values, not by a fork of the code.

variable "display_name" {
  type        = string
  description = "Tenant name shown in the application shell (WELO_TENANT_NAME)."
}

variable "environment" {
  type        = string
  description = "Environment badge shown in the shell (WELO_TENANT_ENV), e.g. demo or production."
  default     = "demo"
}

variable "synthetic" {
  type        = bool
  description = <<-EOT
    Whether this tenant's data is synthetic (WELO_TENANT_SYNTHETIC). True marks
    the application as a demo. Set false only when the tenant is working on its
    own real data.
  EOT
  default     = true
}

variable "suppression_threshold" {
  type        = number
  description = <<-EOT
    Minimum cohort size before figures are reported (WELO_SUPPRESSION_THRESHOLD).
    A tenant may raise this but never lower it: the application clamps to five
    and so does this module, so a bad value cannot weaken the control from
    either side.
  EOT
  default     = 5
  validation {
    condition     = var.suppression_threshold >= 5
    error_message = "suppression_threshold must be at least 5. The small-cell floor is not configurable downwards."
  }
}

variable "modules" {
  type = object({
    absence        = bool
    sick_leave     = bool
    control_centre = bool
  })
  description = <<-EOT
    Which modules this tenant runs. Maps onto WELO_MODULE_ABSENCE,
    WELO_MODULE_SICK_LEAVE and WELO_MODULE_CONTROL_CENTRE. The control centre
    stays off until a tenant's actions store and outbound task integration have
    passed their delta test.
  EOT
  default = {
    absence        = true
    sick_leave     = true
    control_centre = false
  }
}

# --- Data retention ---------------------------------------------------------

variable "raw_retention_days" {
  type        = number
  description = <<-EOT
    Days before an uploaded file is deleted from the landing bucket. Raw
    uploads carry the employer's own identifiers until ingest pseudonymises
    them, so this is deliberately short: the landing bucket is a transfer
    point, not a store.
  EOT
  default     = 30
  validation {
    condition     = var.raw_retention_days >= 1 && var.raw_retention_days <= 365
    error_message = "raw_retention_days must be between 1 and 365. The landing bucket is a transfer point, not an archive."
  }
}

variable "derived_retention_days" {
  type        = number
  description = <<-EOT
    Days before a derived artifact (the feed, model outputs) is deleted. These
    are pseudonymised, so they live longer than the raw uploads. Set 0 to keep
    them indefinitely and manage retention by contract instead.
  EOT
  default     = 730
}

variable "kms_key_name" {
  type        = string
  description = <<-EOT
    Optional customer-managed encryption key for both buckets, e.g.
    projects/P/locations/L/keyRings/R/cryptoKeys/K. Empty uses Google-managed
    keys. A client who requires CMEK supplies the key; the Cloud Storage
    service agent must already be granted roles/cloudkms.cryptoKeyEncrypterDecrypter
    on it.
  EOT
  default     = ""
}

variable "force_destroy_buckets" {
  type        = bool
  description = <<-EOT
    Allow `terraform destroy` to delete a tenant's buckets while they still
    hold objects. False by default and should stay false for any tenant with
    real data: a destroy must not be able to quietly take employee records with
    it.
  EOT
  default     = false
}

# --- Ingest and processing --------------------------------------------------

variable "deploy_ingest" {
  type        = bool
  description = <<-EOT
    Deploy the ingest and processing Cloud Run job. The buckets, the
    pseudonymisation key secret and the service accounts are created either
    way, so a tenant has a working signed-URL upload target before the job
    exists. Set true once ingest_image is built.
  EOT
  default     = false
}

variable "ingest_image" {
  type        = string
  description = "Full image ref for the ingest and processing job. Required when deploy_ingest = true."
  default     = ""
}

variable "ingest_memory" {
  type        = string
  description = "Memory for the ingest job. The pipeline loads pandas and the model."
  default     = "2Gi"
}

variable "ingest_cpu" {
  type        = string
  description = "vCPU for the ingest job."
  default     = "2"
}

variable "ingest_timeout_seconds" {
  type        = number
  description = "How long one ingest run may take before Cloud Run stops it."
  default     = 3600
}

# --- The platform application ----------------------------------------------

variable "deploy_platform" {
  type        = bool
  description = <<-EOT
    Run the Next.js platform as a Cloud Run service for this tenant. False
    leaves the application on Vercel, in which case this module still computes
    the tenant's environment variables and exposes them as an output for you to
    set there. True puts the whole stack inside the tenant's project, which is
    what a client who requires that will ask for.
  EOT
  default     = false
}

variable "platform_image" {
  type        = string
  description = "Full image ref for the Next.js platform. Required when deploy_platform = true."
  default     = ""
}

variable "platform_memory" {
  type        = string
  description = "Memory for the platform service. The Next server is light."
  default     = "512Mi"
}

variable "platform_cpu" {
  type        = string
  description = "vCPU for the platform service."
  default     = "1"
}

variable "min_instances" {
  type        = number
  description = "Minimum platform instances. 0 scales to zero."
  default     = 0
}

variable "max_instances" {
  type        = number
  description = "Maximum platform instances."
  default     = 3
}

variable "allow_unauthenticated" {
  type        = bool
  description = <<-EOT
    Public URL for the tenant's platform service. True suits a demo. For a real
    tenant this should be false, with access through the identity provider the
    architecture specifies rather than an open URL.
  EOT
  default     = false
}

# --- Agents -----------------------------------------------------------------

variable "anthropic_secret_id" {
  type        = string
  description = <<-EOT
    Secret Manager secret id holding the Anthropic API key, created by the root
    module. The tenant's platform service account is granted read on it and the
    key is injected into the service. Empty means the agents are off for this
    tenant: the application still renders and the agent panels show a clear
    disabled state.
  EOT
  default     = ""
}

variable "agent_model" {
  type        = string
  description = "Model the absence agents call (WELO_AGENT_MODEL)."
  default     = "claude-opus-4-8"
}

variable "sick_leave_agent_model" {
  type        = string
  description = "Model the sick-leave agents call (SICK_LEAVE_AGENT_MODEL)."
  default     = "claude-sonnet-5"
}

variable "labels" {
  type        = map(string)
  description = "Extra labels applied to the tenant's resources, on top of the tenant label."
  default     = {}
}
