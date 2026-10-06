# The detections.
#
# Each carries a layer, a severity, a runbook line and a status. The status is
# the honest part: "live" means there is a log source producing these entries
# today, "awaiting instrumentation" means the detection is correct but nothing
# emits the event yet. Only live detections are created unless
# enable_application_event_detections is set, because an alert policy that
# cannot fire reads as coverage on a dashboard and in an assessment response
# while protecting nothing.
#
# The control plane carries most of the weight here. On a small serverless
# deployment with no VPC and no load balancer, an attack shows up as someone
# changing IAM, creating a service account key, reading a secret, opening a
# service to the internet, or turning the logging off. All five are below.

locals {
  # Services whose public exposure is intentional, as a filter clause.
  public_run_exclusion = length(var.public_run_services) == 0 ? "" : format(
    "\n        AND NOT protoPayload.resourceName:(%s)",
    join(" OR ", [for s in var.public_run_services : "\"${s}\""]),
  )

  # ------------------------------------------------------------------------
  # Control plane. Live today: Admin Activity audit logs are always on.
  # ------------------------------------------------------------------------
  control_plane_detections = {
    project_iam_change = {
      title    = "Project IAM policy changed"
      layer    = "control plane"
      severity = "ERROR"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="cloudresourcemanager.googleapis.com"
        AND protoPayload.methodName:"SetIamPolicy"
      EOT
      runbook  = "Confirm the change was intended and that the principal added was meant to get that role. Project-level grants are the ones that reach every tenant."
    }

    service_account_key_created = {
      title    = "Service account key created"
      layer    = "control plane"
      severity = "CRITICAL"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="iam.googleapis.com"
        AND protoPayload.methodName:"CreateServiceAccountKey"
      EOT
      runbook  = "Nothing in this platform needs a downloaded key: CI federates, and ingest signs its own URLs through signBlob. A key here is either a mistake or an attacker establishing persistence. Find out which, then delete it."
    }

    run_public_invoker = {
      title    = "Cloud Run service opened to the internet"
      layer    = "control plane"
      severity = "CRITICAL"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="run.googleapis.com"
        AND protoPayload.methodName:"SetIamPolicy"
        AND protoPayload.request.policy.bindings.members="allUsers"${local.public_run_exclusion}
      EOT
      runbook  = "A service became invocable by anyone. If it was intended, add it to public_run_services with a reason. If not, remove the binding now."
    }

    bucket_made_public = {
      title    = "Storage bucket granted public access"
      layer    = "control plane"
      severity = "CRITICAL"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="storage.googleapis.com"
        AND protoPayload.methodName:"setIamPermissions"
        AND protoPayload.serviceData.policyDelta.bindingDeltas.action="ADD"
        AND protoPayload.serviceData.policyDelta.bindingDeltas.member=("allUsers" OR "allAuthenticatedUsers")
      EOT
      runbook  = "Tenant buckets enforce public access prevention, so this should be refused before it happens. If it succeeded, the enforcement was removed first: check for that change too, and treat any bucket holding employee records as exposed until proven otherwise."
    }

    secret_read_by_person = {
      title    = "Secret payload read by a person"
      layer    = "control plane"
      severity = "ERROR"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="secretmanager.googleapis.com"
        AND protoPayload.methodName:"AccessSecretVersion"
        AND NOT protoPayload.authenticationInfo.principalEmail:"gserviceaccount.com"
      EOT
      runbook  = "Services read secrets constantly and are filtered out here; a person reading one is rare and should match a known task. A tenant's pseudonymisation key is the one that matters most: it is what makes employee records re-identifiable."
    }

    audit_config_change = {
      title    = "Audit logging configuration changed"
      layer    = "control plane"
      severity = "CRITICAL"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="cloudresourcemanager.googleapis.com"
        AND protoPayload.serviceData.policyDelta.auditConfigDeltas:*
      EOT
      runbook  = "Someone changed what is audited. Turning off Data Access logging is a standard first step before doing something that would otherwise be logged. Confirm it was a deliberate Terraform change and not a console edit."
    }

    logging_tampering = {
      title    = "Log sink, bucket or metric deleted or changed"
      layer    = "control plane"
      severity = "CRITICAL"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="logging.googleapis.com"
        AND protoPayload.methodName:("DeleteSink" OR "UpdateSink" OR "DeleteBucket" OR "UpdateBucket" OR "DeleteLogMetric")
      EOT
      runbook  = "The evidence trail itself was modified. Verify against the Terraform state: anything not explained by an apply should be treated as hostile."
    }

    kms_key_destroyed = {
      title    = "KMS key version scheduled for destruction"
      layer    = "control plane"
      severity = "CRITICAL"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="cloudkms.googleapis.com"
        AND protoPayload.methodName:"DestroyCryptoKeyVersion"
      EOT
      runbook  = "Where a tenant uses customer-managed encryption, destroying the key makes its data unreadable permanently. There is a 24 hour window to restore it. Act inside that window."
    }
  }

  # ------------------------------------------------------------------------
  # Network. There is no VPC here, which is exactly why these are worth
  # keeping: a firewall rule or a subnet appearing in a serverless project is
  # not a tuning problem, it is somebody building something nobody asked for.
  # ------------------------------------------------------------------------
  network_detections = {
    firewall_change = {
      title    = "Firewall rule created or changed"
      layer    = "network"
      severity = "ERROR"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="compute.googleapis.com"
        AND protoPayload.methodName:("firewalls.insert" OR "firewalls.patch" OR "firewalls.delete")
      EOT
      runbook  = "This deployment has no VPC, so a firewall rule should not exist. Find out what created it before deciding whether it stays."
    }

    network_change = {
      title    = "Network or subnet created or changed"
      layer    = "network"
      severity = "WARNING"
      status   = "live"
      filter   = <<-EOT
        protoPayload.serviceName="compute.googleapis.com"
        AND protoPayload.methodName:("networks.insert" OR "networks.patch" OR "networks.delete" OR "subnetworks.insert" OR "subnetworks.patch" OR "routes.insert")
      EOT
      runbook  = "Same reasoning as the firewall detection: unexpected here by construction. If the deployment genuinely grows a VPC, move to the estate-wide module, which adds flow logs and the egress detections this one omits."
    }
  }

  break_glass_detection = length(var.break_glass_principals) == 0 ? {} : {
    break_glass_activity = {
      title    = "Break-glass account used"
      layer    = "control plane"
      severity = "CRITICAL"
      status   = "live"
      filter = format(
        "protoPayload.authenticationInfo.principalEmail=(%s)",
        join(" OR ", [for p in var.break_glass_principals : "\"${p}\""]),
      )
      runbook = "Break-glass use should always be rare, deliberate and already expected. Match it to a declared incident, record the reason, and rotate the credentials afterwards."
    }
  }

  # ------------------------------------------------------------------------
  # Application events. Correct, and inert until services emit them. See the
  # contract in this module's README.
  # ------------------------------------------------------------------------
  application_detections = !var.enable_application_event_detections ? {} : {
    tenant_mismatch = {
      title    = "Cross-tenant access attempt"
      layer    = "application"
      severity = "CRITICAL"
      status   = "awaiting instrumentation"
      filter   = <<-EOT
        jsonPayload.log_type="security"
        AND jsonPayload.event_type="authz.tenant_mismatch"
      EOT
      runbook  = "A request carried one tenant and the token another. Tenant isolation is the platform's central promise, so treat a single event as an incident until shown otherwise."
    }

    mfa_removed = {
      title    = "Multi-factor authentication removed from an account"
      layer    = "application"
      severity = "ERROR"
      status   = "awaiting instrumentation"
      filter   = <<-EOT
        jsonPayload.log_type="security"
        AND jsonPayload.event_type="auth.mfa_removed"
      EOT
      runbook  = "Confirm the account holder did this. Removing a factor is a common step after a session is stolen."
    }

    privileged_role_assigned = {
      title    = "Privileged application role assigned"
      layer    = "application"
      severity = "ERROR"
      status   = "awaiting instrumentation"
      filter   = <<-EOT
        jsonPayload.log_type="security"
        AND jsonPayload.event_type="identity.role_assigned"
        AND jsonPayload.privileged=true
      EOT
      runbook  = "Clinical and admin roles reach individual-level health data. Confirm the grant was requested and approved."
    }

    l5_data_export = {
      title    = "Export of the most sensitive data class"
      layer    = "application"
      severity = "ERROR"
      status   = "awaiting instrumentation"
      filter   = <<-EOT
        jsonPayload.log_type="security"
        AND jsonPayload.event_type="data.export"
        AND jsonPayload.classification="L5"
      EOT
      runbook  = "Match the export to a request. Under POPIA this is the event most likely to need reporting if it was not authorised."
    }
  }

  log_match_detections = {
    for k, v in merge(
      local.control_plane_detections,
      local.network_detections,
      local.break_glass_detection,
      local.application_detections,
    ) : k => v if !contains(var.disabled_detections, k)
  }

  # ------------------------------------------------------------------------
  # Spikes. Counted through a log-based metric, then alerted on.
  # ------------------------------------------------------------------------
  application_threshold_detections = !var.enable_application_event_detections ? {} : {
    login_failure_spike = {
      title         = "Spike in failed logins"
      layer         = "application"
      severity      = "ERROR"
      status        = "awaiting instrumentation"
      threshold     = var.thresholds.login_failures
      resource_type = "cloud_run_revision"
      filter        = <<-EOT
        jsonPayload.log_type="security"
        AND jsonPayload.event_type="auth.login_failed"
      EOT
      runbook       = "Credential stuffing or a password spray. Check whether the attempts concentrate on a few accounts or spread across many, and whether any succeeded."
    }

    authz_denial_spike = {
      title         = "Spike in authorisation denials"
      layer         = "application"
      severity      = "WARNING"
      status        = "awaiting instrumentation"
      threshold     = var.thresholds.authz_denials
      resource_type = "cloud_run_revision"
      filter        = <<-EOT
        jsonPayload.log_type="security"
        AND jsonPayload.event_type="authz.denied"
      EOT
      runbook       = "Often a broken deployment rather than an attack. Rule that out first, then look for one actor probing what they can reach."
    }
  }

  threshold_detections = {
    for k, v in merge({
      http_401_403_spike = {
        title         = "Spike in refused requests"
        layer         = "application"
        severity      = "WARNING"
        status        = "live"
        threshold     = var.thresholds.http_401_403
        resource_type = "cloud_run_revision"
        filter        = <<-EOT
          resource.type="cloud_run_revision"
          AND httpRequest.status=(401 OR 403)
        EOT
        runbook       = "Cloud Run refused a burst of requests. Identify the caller: a misconfigured client looks different from someone enumerating endpoints."
      }
      }, local.application_threshold_detections,
    ) : k => v if !contains(var.disabled_detections, k)
  }
}
