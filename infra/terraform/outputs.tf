output "service_url" {
  description = "Cloud Run URL of the inference service (the agent proxy)."
  value       = google_cloud_run_v2_service.welo.uri
}

output "sick_leave_url" {
  description = "Cloud Run URL of the Next.js sick-leave dashboard."
  value       = var.deploy_sick_leave ? "${google_cloud_run_v2_service.sick_leave[0].uri}/sick-leave" : "not deployed (deploy_sick_leave = false)"
}

output "dashboard_link" {
  description = "Open the dashboard wired to the live service."
  value       = "${google_cloud_run_v2_service.welo.uri} -> add ?api=<this-url> to the dashboard URL"
}

output "artifact_registry_repo" {
  description = "Docker repo the image lives in."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.welo.repository_id}"
}

output "runtime_service_account" {
  description = "Service account the Cloud Run service runs as."
  value       = google_service_account.run.email
}

output "secret_id" {
  description = "Secret Manager secret that holds the Anthropic API key (anthropic provider only)."
  value       = local.create_key_secret ? google_secret_manager_secret.anthropic[0].secret_id : "n/a (llm_provider = vertex, no key secret)"
}

output "llm_provider" {
  description = "Where the agents call Claude."
  value       = var.llm_provider == "vertex" ? "vertex (project ${var.project_id}, region ${var.vertex_region}, service account auth)" : "anthropic (API key from Secret Manager)"
}

output "dashboard_bucket_url" {
  description = "Public URL of the static dashboard, when hosted here."
  value       = var.host_dashboard ? "https://storage.googleapis.com/${var.dashboard_bucket}/index.html" : "dashboard hosting disabled (host_dashboard = false)"
}

output "add_key_command" {
  description = "How to load the Anthropic key into the secret (anthropic provider, out of band)."
  value       = local.create_key_secret ? "printf 'sk-ant-...' | gcloud secrets versions add ${google_secret_manager_secret.anthropic[0].secret_id} --data-file=- --project=${var.project_id}" : "n/a (llm_provider = vertex; no key, the runtime service account authenticates to Vertex)"
}

# --- Tenants ----------------------------------------------------------------

output "tenants" {
  description = "Per-tenant resources: buckets, identities and the application URL."
  value = {
    for k, t in module.tenant : k => {
      raw_bucket               = t.raw_bucket
      derived_bucket           = t.derived_bucket
      ingest_service_account   = t.ingest_service_account
      platform_service_account = t.platform_service_account
      pseudonymisation_secret  = t.pseudonymisation_secret_id
      ingest_job               = t.ingest_job
      platform_url             = t.platform_url
    }
  }
}

# The environment that defines each tenant. On the Cloud Run path Terraform has
# already set these; on the Vercel path this is what you set there, so the two
# hosting routes are configured from one definition rather than two.
output "tenant_platform_env" {
  description = "Environment variables per tenant, for the Vercel path."
  value       = { for k, t in module.tenant : k => t.platform_env }
}

output "tenant_setup_commands" {
  description = "Per tenant: load its pseudonymisation key, then run an ingest pass."
  value = {
    for k, t in module.tenant : k => {
      add_pseudonymisation_key = t.add_pseudonymisation_key_command
      run_ingest               = t.run_ingest_command
    }
  }
}

# --- Security monitoring -----------------------------------------------------

output "security_detections" {
  description = "Active detections by key, with layer, severity, trigger and status. Useful as assessment evidence."
  value       = var.enable_security_monitoring ? module.security_monitoring[0].detections : {}
}

output "security_detection_summary" {
  description = "How many detections are active, by layer."
  value       = var.enable_security_monitoring ? module.security_monitoring[0].detection_summary : {}
}

output "security_log_bucket" {
  description = "Where security logs are routed and retained."
  value       = var.enable_security_monitoring ? module.security_monitoring[0].log_bucket : "security monitoring disabled"
}

output "security_audited_services" {
  description = "Services with Data Access audit logging. The security-monitoring module is their single owner."
  value       = var.enable_security_monitoring ? module.security_monitoring[0].audited_services : []
}

# Says so plainly when the detections exist and nobody is told, which is the
# failure mode that looks like coverage from a distance.
output "security_notifies" {
  description = "Where security alerts go."
  value       = var.enable_security_monitoring ? module.security_monitoring[0].notifies : "security monitoring disabled"
}
