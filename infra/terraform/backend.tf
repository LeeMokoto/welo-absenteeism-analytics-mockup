# State backend.
#
# By default Terraform keeps state in a local terraform.tfstate file, which is
# fine for a single-operator demo. When you migrate to the client's environment
# (or want a shared, durable state), store state in a GCS bucket instead:
# create the bucket once, uncomment this block, set the bucket name, then run
# `terraform init -migrate-state`.
#
# terraform {
#   backend "gcs" {
#     bucket = "welo-tfstate-CHANGE-ME"   # must already exist, versioning on
#     prefix = "welo-inference"
#   }
# }
#
# Tip for the demo-to-client migration: use one bucket prefix per environment
# (or `terraform workspace new client`) so the two deployments never share
# state.
