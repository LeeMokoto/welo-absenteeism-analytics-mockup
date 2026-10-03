output "tenant_key" {
  description = "The tenant's identifier."
  value       = var.tenant_key
}

output "raw_bucket" {
  description = "Landing bucket the employer uploads its extract to, through a signed URL."
  value       = google_storage_bucket.raw.name
}

output "derived_bucket" {
  description = "Bucket holding the tenant's pseudonymised artifacts."
  value       = google_storage_bucket.derived.name
}

output "ingest_service_account" {
  description = "Service account ingest runs as, and the identity that signs upload URLs."
  value       = google_service_account.ingest.email
}

output "platform_service_account" {
  description = "Service account the application runs as. Reads derived artifacts only."
  value       = google_service_account.platform.email
}

output "pseudonymisation_secret_id" {
  description = "Secret holding this tenant's pseudonymisation key. Terraform never sees its value."
  value       = google_secret_manager_secret.pseudonymisation_key.secret_id
}

output "add_pseudonymisation_key_command" {
  description = "How to generate and load the tenant's pseudonymisation key, out of band."
  value       = "openssl rand -base64 48 | tr -d '\\n' | gcloud secrets versions add ${google_secret_manager_secret.pseudonymisation_key.secret_id} --data-file=- --project=${var.project_id}"
}

output "ingest_job" {
  description = "Cloud Run job that ingests and processes an upload."
  value       = var.deploy_ingest ? google_cloud_run_v2_job.ingest[0].name : "not deployed (deploy_ingest = false)"
}

output "run_ingest_command" {
  description = "How to run an ingest pass for this tenant."
  value       = var.deploy_ingest ? "gcloud run jobs execute ${google_cloud_run_v2_job.ingest[0].name} --region ${var.region} --project ${var.project_id}" : "n/a (deploy_ingest = false)"
}

output "platform_url" {
  description = "URL of the tenant's application when it runs on Cloud Run."
  value       = var.deploy_platform ? google_cloud_run_v2_service.platform[0].uri : "not deployed on Cloud Run (deploy_platform = false)"
}

# The point of this output is parity. Whether the tenant runs on Cloud Run or on
# Vercel, what defines it is the same set of values; this is them, ready to
# paste into the Vercel project's environment. The Anthropic key is not here and
# never will be: it is set directly in Vercel, or injected from Secret Manager
# on the Cloud Run path, so it does not pass through Terraform state.
output "platform_env" {
  description = "Environment variables that define this tenant, for the Vercel path."
  value       = local.manifest_env
}

output "platform_env_cli" {
  description = "The same values as shell assignments, for `vercel env add` or a .env file."
  value       = join("\n", [for k, v in local.manifest_env : "${k}=${v}"])
}
