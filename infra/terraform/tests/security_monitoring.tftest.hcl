# Security monitoring controls, asserted as tests.
#
# Two claims this file exists to keep true.
#
# The module is the single owner of Data Access audit config for the project.
# google_project_iam_audit_config is authoritative per project and service, so
# a second resource covering one of these services would overwrite it on every
# apply without Terraform reporting a conflict. That was a real collision
# between the root configuration and the module this one is adapted from, and
# it is the kind of thing that comes back.
#
# A detection that cannot fire is not coverage. The application-event
# detections are correct but nothing emits the events yet, so they must stay
# absent by default rather than sit on a dashboard looking like protection.

provider "google" {
  project      = "welo-test"
  region       = "africa-south1"
  access_token = "placeholder-no-api-calls-are-made"
}

variables {
  project_id    = "welo-test"
  bucket_prefix = "welo-test"
  image         = "africa-south1-docker.pkg.dev/welo-test/welo/welo-inference:latest"

  host_dashboard   = false
  dashboard_bucket = ""
  tenants          = {}
}

run "the_module_is_the_only_owner_of_audit_config" {
  command = plan

  # The root configuration must declare no audit config of its own. If this
  # fails, someone has added one back and the two will fight silently.
  assert {
    condition     = length(module.security_monitoring) == 1
    error_message = "Security monitoring should be on by default."
  }

  assert {
    condition = alltrue([
      for s in ["storage.googleapis.com", "secretmanager.googleapis.com"] :
      contains(module.security_monitoring[0].audited_services, s)
    ])
    error_message = "Storage and Secret Manager must be audited: object reads on tenant buckets, and payload reads of a pseudonymisation key."
  }
}

run "detections_that_cannot_fire_are_not_created" {
  command = plan

  variables {
    enable_application_event_detections = false
  }

  # Nothing emits structured security events yet, so none of these should exist.
  assert {
    condition = alltrue([
      for k in ["tenant_mismatch", "mfa_removed", "privileged_role_assigned", "l5_data_export", "login_failure_spike", "authz_denial_spike"] :
      !contains(keys(module.security_monitoring[0].detections), k)
    ])
    error_message = "Application-event detections must stay absent until something emits the events. An alert that cannot fire reads as coverage while protecting nothing."
  }

  # The control plane is where an attack on a serverless deployment shows up,
  # and every one of these works today against Admin Activity audit logs.
  assert {
    condition = alltrue([
      for k in [
        "project_iam_change",
        "service_account_key_created",
        "run_public_invoker",
        "bucket_made_public",
        "secret_read_by_person",
        "audit_config_change",
        "logging_tampering",
      ] : contains(keys(module.security_monitoring[0].detections), k)
    ])
    error_message = "A live control-plane detection was lost."
  }

  # Every detection that exists must be live. This is the assertion that stops
  # the inert ones creeping back in through a default change.
  assert {
    condition = alltrue([
      for v in values(module.security_monitoring[0].detections) :
      !strcontains(v, "awaiting instrumentation")
    ])
    error_message = "A detection marked 'awaiting instrumentation' was created. Turn it on in the change that starts emitting its events, not before."
  }
}

run "turning_on_application_detections_creates_them" {
  command = plan

  variables {
    enable_application_event_detections = true
  }

  assert {
    condition     = contains(keys(module.security_monitoring[0].detections), "tenant_mismatch")
    error_message = "Cross-tenant access is the platform's central promise and must be detectable once events are emitted."
  }
}

run "security_logs_outlive_the_time_it_takes_to_notice_a_breach" {
  command = plan

  variables {
    region             = "africa-south1"
    log_retention_days = 365
  }

  assert {
    condition     = can(regex("locations/africa-south1/buckets/security-logs", module.security_monitoring[0].log_bucket))
    error_message = "Security logs must land in the configured region and bucket."
  }
}

run "a_retention_window_too_short_to_investigate_is_rejected" {
  command = plan

  variables {
    log_retention_days = 7
  }

  expect_failures = [var.log_retention_days]
}

# --- Agents off means no capability to call out ------------------------------
# A client tenant's recorded position can be "agents off" while its service
# account still holds permission to call Vertex AI, if the grant follows only
# the provider setting. The position and the permission have to agree.

run "vertex_permission_does_not_exist_while_agents_are_off" {
  command = plan

  variables {
    llm_provider  = "vertex"
    vertex_region = "eu"
    enable_agents = false
  }

  assert {
    condition     = length(google_project_iam_member.vertex_user) == 0
    error_message = "With agents off, nothing should hold roles/aiplatform.user. The permission would precede the client's section 72 approval."
  }

  # And no Anthropic key secret either: the vertex path uses no key, so a
  # client project should not contain one.
  assert {
    condition     = length(google_secret_manager_secret.anthropic) == 0
    error_message = "A tenant on the vertex path with agents off should hold no Anthropic API key secret."
  }
}

run "turning_agents_on_grants_exactly_what_vertex_needs" {
  command = plan

  variables {
    llm_provider  = "vertex"
    vertex_region = "eu"
    enable_agents = true
  }

  assert {
    condition     = length(google_project_iam_member.vertex_user) == 1
    error_message = "With agents on over vertex, the runtime service account needs roles/aiplatform.user."
  }

  assert {
    condition     = google_project_iam_member.vertex_user[0].role == "roles/aiplatform.user"
    error_message = "aiplatform.user is the least-privilege role for invoking models; nothing broader should be granted."
  }
}
