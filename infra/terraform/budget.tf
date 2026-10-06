# Billing budget and alerts.
#
# Everything else in this configuration bounds cost by design: scale to zero,
# cpu_idle, max_instances, bucket lifecycle. None of that stops a well-meant
# change from being expensive. Flipping cpu_idle to false on the two warm
# services, which is the obvious way to kill a cold start, takes the serving
# bill from about USD 390 a year to about USD 2,300. See docs/run-cost-model.md.
#
# A budget does not cap spend. GCP budgets notify; they do not enforce, and the
# only true cap would be detaching billing, which takes the service down. What
# this buys is finding out in a week rather than on an invoice.
#
# Optional, because it needs a billing account id and the permission to read it,
# which the person running a first apply may not have. Leave billing_account
# empty and nothing here is created.

locals {
  create_budget = var.billing_account != "" && var.budget_amount > 0
}

resource "google_project_service" "billing_budgets" {
  count              = local.create_budget ? 1 : 0
  service            = "billingbudgets.googleapis.com"
  disable_on_destroy = false
}

resource "google_billing_budget" "project" {
  count           = local.create_budget ? 1 : 0
  billing_account = var.billing_account
  display_name    = "${var.project_id} monthly budget"

  # Scoped to this project, so one noisy project in a billing account does not
  # silence the alert for another.
  budget_filter {
    projects        = ["projects/${var.project_id}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.budget_amount)
    }
  }

  # Three thresholds rather than one. 50 percent is the early signal that
  # something changed, 90 percent is the one to act on, and 100 percent is the
  # record that it was not acted on.
  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  # Forecast alerting catches a step change in run rate partway through a month,
  # which is exactly the cpu_idle case: by the time actual spend crosses 90
  # percent the month is nearly over.
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  # With no all_updates_rule, alerts go to the billing account's admins and
  # users. That is deliberate for a first deployment: it needs no notification
  # channel, no Pub/Sub topic and no further permissions. Route them somewhere
  # better by adding monitoring_notification_channels here once there is a
  # channel to point at.

  depends_on = [google_project_service.billing_budgets]
}

output "budget" {
  description = "The monthly budget alerting on this project, if one is configured."
  value       = local.create_budget ? "${var.budget_currency} ${var.budget_amount} a month, alerting at 50, 90 and 100 percent, plus a forecast alert" : "no budget configured (set billing_account and budget_amount)"
}
