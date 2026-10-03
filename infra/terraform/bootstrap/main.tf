# Bootstrap: the bucket that holds Terraform state for everything else.
#
# This is the one piece that cannot live in the main configuration, because the
# main configuration needs it before it can store its own state. It is small and
# it is run once per environment. Its own state stays local, which is fine: the
# only thing it manages is a bucket whose name you already know, and losing this
# state costs an import, not a tenant.
#
#   terraform init
#   terraform apply -var project_id=PROJECT -var state_bucket=welo-tfstate-NAME
#
# Then put that bucket name in ../backend.demo.hcl and run the main config.

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  type        = string
  description = "GCP project that owns the state bucket."
}

variable "region" {
  type        = string
  description = "Location for the state bucket."
  default     = "europe-west1"
}

variable "state_bucket" {
  type        = string
  description = "Globally unique name for the Terraform state bucket."
}

resource "google_project_service" "storage" {
  service            = "storage.googleapis.com"
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  # checkov:skip=CKV_GCP_62: Access to Terraform state is recorded by Cloud Audit
  # Logs data access logging, which the main configuration enables for
  # storage.googleapis.com across the project. Writing per-bucket access logs
  # would need a second bucket that this bootstrap exists to avoid needing.
  name     = var.state_bucket
  location = var.region
  project  = var.project_id

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # State can contain sensitive values, and a corrupted or truncated state file
  # is recoverable only from a previous version. Versioning is the whole point
  # of this bucket.
  versioning {
    enabled = true
  }

  # Keep a deep history but not an unbounded one.
  lifecycle_rule {
    condition {
      num_newer_versions = 30
    }
    action {
      type = "Delete"
    }
  }

  # No force_destroy: a `terraform destroy` here must not be able to delete the
  # state of every other deployment along with the bucket.

  depends_on = [google_project_service.storage]
}

output "state_bucket" {
  description = "Put this in ../backend.<env>.hcl as the bucket value."
  value       = google_storage_bucket.state.name
}

output "next_step" {
  description = "How to point the main configuration at this bucket."
  value       = "cd .. && cp backend.demo.hcl.example backend.demo.hcl && set bucket = \"${google_storage_bucket.state.name}\" && terraform init -backend-config=backend.demo.hcl"
}
