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
