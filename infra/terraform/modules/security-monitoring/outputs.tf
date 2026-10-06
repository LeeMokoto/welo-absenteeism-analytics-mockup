output "log_bucket" {
  description = "Security log bucket the sink writes to."
  value       = local.bucket_path
}

output "sink_writer_identity" {
  description = "Service account the log sink writes as."
  value       = google_logging_project_sink.security.writer_identity
}

output "audited_services" {
  description = "Services with Data Access audit logging. This module is their single owner."
  value       = var.data_access_audit_services
}

# Useful as assessment evidence, and honest about what is actually watching.
# A detection marked "awaiting instrumentation" is correct but has no log source
# yet, so it is not created unless enable_application_event_detections is set.
output "detections" {
  description = "Active detections by key, with layer, severity, trigger and status."
  value = merge(
    { for k, v in local.log_match_detections : k => "${v.layer} | ${v.severity} | any event | ${v.status}" },
    { for k, v in local.threshold_detections : k => "${v.layer} | ${v.severity} | more than ${v.threshold} per 5 min | ${v.status}" },
  )
}

output "detection_summary" {
  description = "How many detections are active, by layer."
  value = {
    for layer in distinct([for v in merge(local.log_match_detections, local.threshold_detections) : v.layer]) :
    layer => length([for v in merge(local.log_match_detections, local.threshold_detections) : v if v.layer == layer])
  }
}

output "notifies" {
  description = "Where alerts go. Empty means the detections exist but nobody is told."
  value       = length(local.notification_channels) > 0 ? "${length(local.notification_channels)} channel(s)" : "NOBODY: set alert_emails or extra_notification_channel_ids"
}
