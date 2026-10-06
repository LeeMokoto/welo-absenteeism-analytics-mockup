# Inputs for security logging and alerting on one project.

variable "project_id" {
  type        = string
  description = "Project to monitor. The module is applied once per project."
}

variable "project_label" {
  type        = string
  description = "Short name used in alert titles, e.g. \"demo\" or \"glencore\"."
}

# --- Central log storage -----------------------------------------------------

variable "central_logging_project_id" {
  type        = string
  description = <<-EOT
    Project holding the central security log bucket. Empty keeps the logs in
    the monitored project, which is right while there is one project. When
    tenants move to their own projects, point them all at one bucket here so an
    investigation reads one place.
  EOT
  default     = ""
}

variable "create_log_bucket" {
  type        = bool
  description = "Create the log bucket. True for exactly one module instance per central project."
  default     = true
}

variable "log_bucket_id" {
  type        = string
  description = "Id of the security log bucket."
  default     = "security-logs"
}

variable "log_bucket_location" {
  type        = string
  description = "Region for the log bucket. Keep it with the data it describes."
  default     = "africa-south1"
}

variable "log_retention_days" {
  type        = number
  description = <<-EOT
    How long security logs are kept. 365 days is the usual answer to an
    assessment question and is what a breach investigation needs, since
    intrusions are routinely found months after the fact.
  EOT
  default     = 365
  validation {
    condition     = var.log_retention_days >= 30
    error_message = "Security logs must be kept at least 30 days. A shorter window cannot support an investigation."
  }
}

variable "lock_log_bucket" {
  type        = bool
  description = <<-EOT
    Lock the bucket's retention. Irreversible: a locked bucket cannot have its
    retention shortened and cannot be deleted, which is the point (it stops an
    attacker, or a mistake, shortening the window). Leave false until retention
    is agreed with the client.
  EOT
  default     = false
}

# --- Audit logging -----------------------------------------------------------

variable "data_access_audit_services" {
  type        = list(string)
  description = <<-EOT
    Services that get Data Access audit logs. Admin Activity logs are always on
    and cannot be turned off.

    This module is the single owner of audit config for this project. The
    resource is authoritative per project and service, so two Terraform
    resources covering the same service overwrite each other on every apply
    without Terraform reporting a conflict. If something else needs a service
    audited, add it to this list rather than declaring it elsewhere.

    Empty disables Data Access logging entirely, which is a decision to record
    rather than a default to drift into.
  EOT
  default = [
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "cloudkms.googleapis.com",
  ]
}

# --- Notifications -----------------------------------------------------------

variable "alert_emails" {
  type        = list(string)
  description = "Addresses that receive every alert. Empty creates the detections but notifies nobody."
  default     = []
}

variable "extra_notification_channel_ids" {
  type        = list(string)
  description = "Existing channel resource names to add, e.g. a Slack channel created in the console."
  default     = []
}

variable "notification_rate_limit" {
  type        = string
  description = "Minimum gap between notifications for the same detection."
  default     = "300s"
}

# --- Detection tuning --------------------------------------------------------

variable "disabled_detections" {
  type        = list(string)
  description = "Detection keys to skip. Prefer tuning a threshold to switching a detection off."
  default     = []
}

variable "break_glass_principals" {
  type        = list(string)
  description = <<-EOT
    Break-glass accounts. Any activity by one raises a critical alert, because
    break-glass use should always be rare, deliberate and already expected.
    Empty creates no such detection.
  EOT
  default     = []
}

variable "public_run_services" {
  type        = list(string)
  description = <<-EOT
    Cloud Run services that are meant to be publicly invocable, excluded from
    the alert that fires when a service is opened to allUsers.

    Keep this list short and justified. Every name in it is a service nobody
    will be told about when it becomes reachable by anyone on the internet.
  EOT
  default     = []
}

variable "enable_application_event_detections" {
  type        = bool
  description = <<-EOT
    Create the detections that depend on services emitting the structured
    security events described in this module's README (cross-tenant access, MFA
    removal, privileged role assignment, data export, login and authorisation
    failures).

    False by default, and deliberately so. Nothing in this repository emits
    those events yet, and most of them presuppose authentication that does not
    exist. An alert policy that cannot fire is worse than no policy, because it
    reads as coverage on a dashboard and in an assessment response. Turn this on
    in the same change that starts emitting the events.
  EOT
  default     = false
}

variable "thresholds" {
  type = object({
    http_401_403   = number
    login_failures = number
    authz_denials  = number
  })
  description = <<-EOT
    Event counts in five minutes above which the spike detections fire.

    The upstream module also carries firewall and Cloud Armor denial
    thresholds. Neither is here: without a VPC or a load balancer there is no
    log source to count, and a threshold with no source is a dial that does
    nothing.
  EOT
  default = {
    http_401_403   = 100
    login_failures = 20
    authz_denials  = 50
  }
}
