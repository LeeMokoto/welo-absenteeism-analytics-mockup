# State backend.
#
# State is held in GCS, not on an operator's laptop. For a platform that
# provisions client tenants this is not a preference: state records bucket
# names, service account identities and secret ids, and a tenant must not be
# recoverable only from whoever last ran apply.
#
# The block is deliberately empty. Backend configuration cannot use variables,
# so the bucket and prefix are supplied at init time instead, one file per
# environment:
#
#   terraform init -backend-config=backend.demo.hcl
#
# Copy backend.demo.hcl.example to backend.demo.hcl and fill it in. One prefix
# per environment keeps the demo and a client deployment from ever sharing
# state.
#
# The bucket must exist before the first init. Create it with the bootstrap
# config, which keeps its own small state locally:
#
#   cd bootstrap
#   terraform init && terraform apply -var project_id=PROJECT -var state_bucket=NAME
#
# To work without a backend at all (validating or formatting, no apply):
#
#   terraform init -backend=false

terraform {
  backend "gcs" {}
}
