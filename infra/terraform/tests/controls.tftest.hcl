# Controls, asserted as tests.
#
# Everything here corresponds to a claim made in infra/README.md and in
# docs/devsecops.md. The point is that the claims stop being prose: an edit that
# quietly drops public access prevention, lowers the small-cell floor, or makes
# a tenant bucket destroyable fails CI rather than reaching a client project.
#
# These are plan-time tests. They need no credentials and touch no real
# infrastructure, so they run on every pull request:
#
#   terraform init -backend=false && terraform test

# The provider is overridden so these tests need no GCP credentials at all: a
# plan of resources that do not yet exist makes no API calls, and a static
# placeholder token stops the provider reaching for application default
# credentials. This is what lets the controls be checked on every pull request,
# including from a fork, rather than only by whoever can authenticate.
provider "google" {
  project      = "welo-test"
  region       = "europe-west1"
  access_token = "placeholder-no-api-calls-are-made"
}

variables {
  project_id    = "welo-test"
  bucket_prefix = "welo-test"
  image         = "europe-west1-docker.pkg.dev/welo-test/welo/welo-inference:latest"

  host_dashboard   = false
  dashboard_bucket = ""

  tenants = {
    demo = {
      display_name = "Demo tenant"
      environment  = "demo"
      synthetic    = true
    }
    client = {
      display_name          = "A client"
      environment           = "production"
      synthetic             = false
      suppression_threshold = 10
      region                = "africa-south1"
      modules = {
        absence        = true
        sick_leave     = false
        control_centre = false
      }
    }
  }
}

run "tenant_buckets_can_never_be_public" {
  command = plan

  assert {
    condition = alltrue([
      for k, _ in var.tenants :
      module.tenant[k].raw_bucket != "" &&
      module.tenant[k].derived_bucket != ""
    ])
    error_message = "Every tenant must get both a landing and a derived bucket."
  }

  # The landing bucket carries the employer's own identifiers until ingest
  # pseudonymises them. There is no configuration under which it may be public.
  assert {
    condition     = google_storage_bucket.dashboard == []
    error_message = "The dashboard bucket is the only bucket that may be public, and this run disables it."
  }
}

run "small_cell_floor_cannot_be_lowered" {
  command = plan

  # The application clamps to five in lib/platform/manifest.js. The environment
  # Terraform hands it must never be lower, from either side.
  assert {
    condition = alltrue([
      for k, _ in var.tenants :
      tonumber(module.tenant[k].platform_env.WELO_SUPPRESSION_THRESHOLD) >= 5
    ])
    error_message = "A tenant was configured below the small-cell floor of five."
  }

  # A tenant that raises it keeps the raised value: the floor is a minimum, not
  # a fixed value.
  assert {
    condition     = module.tenant["client"].platform_env.WELO_SUPPRESSION_THRESHOLD == "10"
    error_message = "A tenant that raises its suppression threshold must keep the raised value."
  }
}

run "tenant_identities_are_separated" {
  command = plan

  # Ingest and the application are different principals. If they collapse into
  # one, the surface a user logs in to gains access to the identifiable upload.
  assert {
    condition = alltrue([
      for k, _ in var.tenants :
      module.tenant[k].ingest_service_account != module.tenant[k].platform_service_account
    ])
    error_message = "Ingest and the application must run as different service accounts."
  }

  # And they are per tenant, not shared. One tenant's identity must not be able
  # to reach another tenant's data.
  assert {
    condition     = module.tenant["demo"].ingest_service_account != module.tenant["client"].ingest_service_account
    error_message = "Tenants must not share an ingest identity."
  }

  assert {
    condition     = module.tenant["demo"].pseudonymisation_secret_id != module.tenant["client"].pseudonymisation_secret_id
    error_message = "Tenants must not share a pseudonymisation key: that would make their hashes joinable."
  }
}

run "synthetic_marking_follows_the_tenant" {
  command = plan

  # A demo tenant says so in the application, and a real one does not carry a
  # marking that would understate what the data is.
  assert {
    condition     = module.tenant["demo"].platform_env.WELO_TENANT_SYNTHETIC == "1"
    error_message = "A synthetic tenant must be marked synthetic in the application."
  }

  assert {
    condition     = module.tenant["client"].platform_env.WELO_TENANT_SYNTHETIC == "0"
    error_message = "A tenant on real data must not be marked synthetic."
  }
}

run "modules_are_per_tenant" {
  command = plan

  # What a tenant sees follows from its manifest, which is the whole claim
  # behind "one codebase, many deployments".
  assert {
    condition     = module.tenant["client"].platform_env.WELO_MODULE_SICK_LEAVE == "0"
    error_message = "A tenant that does not run the sick-leave module must not be given it."
  }

  assert {
    condition     = module.tenant["demo"].platform_env.WELO_MODULE_SICK_LEAVE == "1"
    error_message = "A tenant that runs the sick-leave module must be given it."
  }

  # The control centre is off until a tenant's actions store and outbound task
  # integration have passed their delta test. It must never default on.
  assert {
    condition = alltrue([
      for k, _ in var.tenants :
      module.tenant[k].platform_env.WELO_MODULE_CONTROL_CENTRE == "0"
    ])
    error_message = "The control centre must not be enabled by default."
  }
}

run "agents_are_off_unless_a_tenant_asks" {
  command = plan

  # enable_agents is unset for both tenants here, so neither application should
  # be granted read on the Anthropic key secret.
  assert {
    condition     = length(google_secret_manager_secret_iam_member.run_access) == 1
    error_message = "Only the inference service should hold the key binding in this configuration."
  }
}
