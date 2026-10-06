# Security logging and alerting for one project.
#
# Adapted from the security-monitoring module written for the wider Welo estate,
# cut down to what this deployment can actually monitor. The original assumes a
# Shared VPC, an external load balancer, Firestore and Identity Platform; this
# deployment is serverless Cloud Run with no VPC and no load balancer, so VPC
# flow logs, Cloud Armor and the IAP detections are not here. They belong in the
# estate-wide module, against projects that have those things.
#
# What is kept is everything that works against a project shaped like this one,
# which turns out to be most of the value: the control plane is where an attack
# on a small serverless deployment actually shows up.
#
# This module is the single owner of Data Access audit config for the project.
# google_project_iam_audit_config is authoritative per project and service, so
# two resources covering one service silently overwrite each other on every
# apply. Having one owner is the only way that stays correct.

locals {
  central_project = var.central_logging_project_id != "" ? var.central_logging_project_id : var.project_id
  same_project    = local.central_project == var.project_id
  bucket_path     = "projects/${local.central_project}/locations/${var.log_bucket_location}/buckets/${var.log_bucket_id}"

  # What gets routed to the security bucket. Audit logs, the structured security
  # events services emit, and the Cloud Run requests that were refused.
  #
  # No VPC flow logs and no load balancer logs: there is neither here, and they
  # are the two sources that would dominate the Logging bill if there were.
  sink_filter = join(" OR ", [
    "logName:\"cloudaudit.googleapis.com\"",
    "jsonPayload.log_type=\"security\"",
    "(logName:\"run.googleapis.com%2Frequests\" AND httpRequest.status=(401 OR 403))",
  ])
}

resource "google_project_service" "services" {
  for_each           = toset(["logging.googleapis.com", "monitoring.googleapis.com"])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# --- Central log bucket and routing ------------------------------------------

resource "google_logging_project_bucket_config" "security" {
  count            = var.create_log_bucket ? 1 : 0
  project          = local.central_project
  location         = var.log_bucket_location
  bucket_id        = var.log_bucket_id
  retention_days   = var.log_retention_days
  locked           = var.lock_log_bucket
  enable_analytics = true
  description      = "Security logs. Retention ${var.log_retention_days} days."

  depends_on = [google_project_service.services]
}

resource "google_logging_project_sink" "security" {
  name                   = "security-logs-to-central"
  project                = var.project_id
  destination            = "logging.googleapis.com/${local.bucket_path}"
  filter                 = local.sink_filter
  unique_writer_identity = true
  description            = "Routes audit logs, application security events and refused Cloud Run requests to ${local.bucket_path}."

  depends_on = [google_logging_project_bucket_config.security]
}

# Only needed when the bucket is in another project. Scoped by condition to the
# one bucket, so the sink's identity cannot write anywhere else.
resource "google_project_iam_member" "sink_writer" {
  count   = local.same_project ? 0 : 1
  project = local.central_project
  role    = "roles/logging.bucketWriter"
  member  = google_logging_project_sink.security.writer_identity

  condition {
    title      = "security-bucket-only"
    expression = "resource.name.endsWith(\"locations/${var.log_bucket_location}/buckets/${var.log_bucket_id}\")"
  }
}

# --- Data Access audit logs --------------------------------------------------
# ADMIN_READ is included where the upstream module has it. Reading a secret's
# metadata is a weaker signal than reading its payload, but together they are
# what reconstructs who went looking at what.

resource "google_project_iam_audit_config" "data_access" {
  for_each = toset(var.data_access_audit_services)
  project  = var.project_id
  service  = each.value

  audit_log_config { log_type = "ADMIN_READ" }
  audit_log_config { log_type = "DATA_READ" }
  audit_log_config { log_type = "DATA_WRITE" }

  depends_on = [google_project_service.services]
}

# --- Notification channels ---------------------------------------------------

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "Security alerts: ${each.value}"
  type         = "email"
  labels       = { email_address = each.value }

  depends_on = [google_project_service.services]
}

locals {
  notification_channels = concat(
    [for c in google_monitoring_notification_channel.email : c.id],
    var.extra_notification_channel_ids,
  )
}
