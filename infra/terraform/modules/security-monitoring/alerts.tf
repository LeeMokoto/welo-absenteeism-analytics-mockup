# Alert policies, one per detection.
#
# Two shapes. A log-match policy fires on any entry matching its filter, which
# suits events that should be rare and individually interesting. A threshold
# policy counts entries through a log-based metric and fires on a spike, which
# suits events that happen normally and only matter in volume.

resource "google_monitoring_alert_policy" "log_match" {
  for_each     = local.log_match_detections
  project      = var.project_id
  display_name = "[${var.project_label}] ${each.value.title}"
  combiner     = "OR"
  severity     = each.value.severity

  conditions {
    display_name = each.value.title
    condition_matched_log {
      filter = trimspace(each.value.filter)
    }
  }

  alert_strategy {
    # Without a rate limit, one noisy event floods the inbox and the next alert
    # is the one nobody opens.
    notification_rate_limit {
      period = var.notification_rate_limit
    }
    auto_close = "1800s"
  }

  # The runbook travels with the alert. An alert that arrives at 02:00 without
  # one is an alert that gets acknowledged and forgotten.
  documentation {
    mime_type = "text/markdown"
    subject   = "[${var.project_label}] ${each.value.title}"
    content   = "**Layer:** ${each.value.layer}\n\n**What to do:** ${each.value.runbook}\n\nDetection key: `${each.key}`\nStatus: ${each.value.status}"
  }

  user_labels = {
    layer     = replace(each.value.layer, " ", "_")
    detection = each.key
    status    = replace(each.value.status, " ", "_")
  }

  notification_channels = local.notification_channels
  depends_on            = [google_project_service.services]
}

resource "google_logging_metric" "threshold" {
  for_each    = local.threshold_detections
  project     = var.project_id
  name        = "security/${each.key}"
  description = each.value.title
  filter      = trimspace(each.value.filter)

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
    unit        = "1"
  }

  depends_on = [google_project_service.services]
}

resource "google_monitoring_alert_policy" "threshold" {
  for_each     = local.threshold_detections
  project      = var.project_id
  display_name = "[${var.project_label}] ${each.value.title}"
  combiner     = "OR"
  severity     = each.value.severity

  conditions {
    display_name = "${each.value.title} above ${each.value.threshold} in 5 minutes"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.threshold[each.key].name}\" AND resource.type=\"${each.value.resource_type}\""
      comparison      = "COMPARISON_GT"
      threshold_value = each.value.threshold
      duration        = "0s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }

      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    # Spike alerts get the same rate limit as log-match ones. The upstream
    # module leaves this off for thresholds, which means a sustained spike
    # re-notifies on every evaluation.
    notification_rate_limit {
      period = var.notification_rate_limit
    }
    auto_close = "3600s"
  }

  documentation {
    mime_type = "text/markdown"
    subject   = "[${var.project_label}] ${each.value.title}"
    content   = "**Layer:** ${each.value.layer}\n\n**Threshold:** more than ${each.value.threshold} events in 5 minutes.\n\n**What to do:** ${each.value.runbook}\n\nDetection key: `${each.key}`\nStatus: ${each.value.status}"
  }

  user_labels = {
    layer     = replace(each.value.layer, " ", "_")
    detection = each.key
    status    = replace(each.value.status, " ", "_")
  }

  notification_channels = local.notification_channels
}
