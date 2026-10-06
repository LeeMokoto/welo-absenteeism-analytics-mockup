#!/usr/bin/env bash
#
# Provision the Welo demo into a GCP project, end to end.
#
#   infra/scripts/provision_demo.sh              # run every stage in order
#   infra/scripts/provision_demo.sh 4            # run one stage
#   infra/scripts/provision_demo.sh 4 5 6        # run a range
#
# Every stage is idempotent: re-running it converges rather than duplicating, so
# a failed run is resumed by running it again. Nothing here deletes anything.
#
# The ordering is not arbitrary. The registry has to exist before an image can
# be pushed to it, the image has to exist before Cloud Run can reference it, and
# the secrets have to hold values before the agents can be switched on. Doing it
# in one apply fails on the first of those, which is why the README has always
# described it as stages and why this script exists.
#
# Secrets are read from the environment or prompted for, piped straight to
# gcloud, and never echoed, logged or passed as an argument (arguments are
# visible in the process list).

set -euo pipefail

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../terraform" && pwd)"
REPO_ROOT="$(cd "${TF_DIR}/../.." && pwd)"

PROJECT_ID="${PROJECT_ID:-absenteeism-demo}"
REGION="${REGION:-africa-south1}"
STATE_BUCKET="${STATE_BUCKET:-welo-ad-tfstate}"
TFVARS="${TFVARS:-demo.tfvars}"
BACKEND="${BACKEND:-backend.demo.hcl}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/welo/welo-inference:${IMAGE_TAG}"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

tf() { terraform -chdir="${TF_DIR}" "$@"; }

# --- Stage 0: preflight ------------------------------------------------------

stage_0() {
  say "Stage 0: preflight"

  command -v gcloud    >/dev/null || die "gcloud not found. Install the Google Cloud SDK."
  command -v terraform >/dev/null || die "terraform not found. Install Terraform 1.5 or newer."

  local tf_version
  tf_version="$(terraform version -json | sed -n 's/.*"terraform_version": *"\([^"]*\)".*/\1/p' | head -1)"
  info "terraform ${tf_version}"

  local account
  account="$(gcloud config get-value account 2>/dev/null || true)"
  if [ -z "${account}" ] || [ "${account}" = "(unset)" ]; then
    die "gcloud is not authenticated. Run: gcloud auth login && gcloud auth application-default login"
  fi
  info "authenticated as ${account}"

  gcloud projects describe "${PROJECT_ID}" >/dev/null 2>&1 \
    || die "project ${PROJECT_ID} not found, or you cannot see it."
  info "project ${PROJECT_ID} exists"

  # Application default credentials are what Terraform uses, and they are a
  # separate login from the gcloud CLI's own. Getting this wrong produces a
  # confusing "could not find default credentials" on the first plan.
  gcloud auth application-default print-access-token >/dev/null 2>&1 \
    || die "no application default credentials. Run: gcloud auth application-default login"
  info "application default credentials present"

  # The ADC file carries its own quota project, set when you last ran
  # `gcloud auth application-default login`. It does not follow
  # `gcloud config set project`, so after switching projects the two disagree
  # and gcloud warns about it. Terraform reads ADC, so the stale project is the
  # one its API calls bill quota against and check serviceusage against. Usually
  # harmless, occasionally a confusing permission error partway through an apply,
  # so it is cheaper to align it here than to diagnose it at stage 5.
  local adc_file adc_quota
  adc_file="$(gcloud info --format='value(config.paths.global_config_dir)' 2>/dev/null)/application_default_credentials.json"
  if [ -f "${adc_file}" ]; then
    adc_quota="$(sed -n 's/.*"quota_project_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${adc_file}" | head -1)"
    if [ -z "${adc_quota}" ]; then
      info "ADC has no quota project set. To silence the warning and be explicit:"
      info "  gcloud auth application-default set-quota-project ${PROJECT_ID}"
    elif [ "${adc_quota}" != "${PROJECT_ID}" ]; then
      info "ADC quota project is '${adc_quota}' but we are provisioning '${PROJECT_ID}'. Align them:"
      info "  gcloud auth application-default set-quota-project ${PROJECT_ID}"
    else
      info "ADC quota project matches ${PROJECT_ID}"
    fi
  fi

  # Three outcomes, not two. "False" is a definite no and has to stop the run:
  # without billing, every later stage fails on a 403 whose message
  # ("the billing account for the owning project is disabled in state absent")
  # does not say the obvious thing, which is that no billing account is linked.
  # An empty result is a different case, where the query itself was refused for
  # want of billing.projects.get, and that is only a warning.
  local billing
  billing="$(gcloud billing projects describe "${PROJECT_ID}" \
             --format='value(billingEnabled)' 2>/dev/null || true)"

  case "${billing}" in
    True)
      local account_id
      account_id="$(gcloud billing projects describe "${PROJECT_ID}" \
                    --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||')"
      info "billing enabled, account ${account_id}"
      info "to switch the budget alert on, put this in ${TFVARS}:"
      info "  billing_account = \"${account_id}\""
      ;;
    False)
      printf '\n'
      info "No billing account is linked to ${PROJECT_ID}."
      info "Nothing can be created without one: buckets, APIs and Cloud Run all refuse."
      info ""
      info "  gcloud billing accounts list"
      info "  gcloud billing projects link ${PROJECT_ID} --billing-account=ACCOUNT_ID"
      info ""
      info "If that list is empty you have no billing account on this login yet;"
      info "create one at https://console.cloud.google.com/billing (needs a payment method)."
      info "Then run this script again."
      die "billing not enabled on ${PROJECT_ID}"
      ;;
    *)
      info "could not confirm billing (needs billing.projects.get on the project)."
      info "If the next stage fails with a 403 about the billing account, that is why:"
      info "  gcloud billing projects link ${PROJECT_ID} --billing-account=ACCOUNT_ID"
      ;;
  esac

  [ -f "${TF_DIR}/${TFVARS}" ] || {
    info "${TFVARS} not found, creating it from the example"
    cp "${TF_DIR}/demo.tfvars.example" "${TF_DIR}/${TFVARS}"
    info "created ${TF_DIR}/${TFVARS}; review it before continuing"
  }

  [ -f "${TF_DIR}/${BACKEND}" ] || {
    info "${BACKEND} not found, creating it from the example"
    cp "${TF_DIR}/backend.demo.hcl.example" "${TF_DIR}/${BACKEND}"
  }

  info "region ${REGION}, state bucket ${STATE_BUCKET}"
  info "image will be ${IMAGE}"
}

# --- Stage 1: state bucket ---------------------------------------------------

stage_1() {
  say "Stage 1: Terraform state bucket"

  if gcloud storage buckets describe "gs://${STATE_BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    info "gs://${STATE_BUCKET} already exists, nothing to do"
    return
  fi

  info "creating gs://${STATE_BUCKET} with versioning, through ./bootstrap"
  terraform -chdir="${TF_DIR}/bootstrap" init -input=false
  terraform -chdir="${TF_DIR}/bootstrap" apply -input=false -auto-approve \
    -var "project_id=${PROJECT_ID}" \
    -var "region=${REGION}" \
    -var "state_bucket=${STATE_BUCKET}"
}

# --- Stage 2: initialise the backend ----------------------------------------

stage_2() {
  say "Stage 2: initialise Terraform against the state bucket"
  tf init -input=false -reconfigure -backend-config="${BACKEND}"
  tf validate
}

# --- Stage 3: APIs and the registry -----------------------------------------
# Targeted, because the image does not exist yet and a full apply would fail on
# the Cloud Run service that references it.

stage_3() {
  say "Stage 3: enable APIs and create the Artifact Registry repository"
  tf apply -input=false -auto-approve -var-file="${TFVARS}" \
    -target=google_project_service.services \
    -target=google_artifact_registry_repository.welo
  info "APIs can take a minute to propagate; the next stage will retry if needed"
}

# --- Stage 4: build and push the inference image ----------------------------

stage_4() {
  say "Stage 4: build and push the inference image"
  info "building ${IMAGE} from ${REPO_ROOT}/model"
  info "this takes several minutes: the image carries scikit-learn, SHAP and the model artifacts"

  gcloud builds submit "${REPO_ROOT}/model" \
    --tag "${IMAGE}" \
    --project "${PROJECT_ID}"

  info "pushed ${IMAGE}"
}

# --- Stage 5: apply everything ----------------------------------------------

stage_5() {
  say "Stage 5: apply the full configuration"
  info "Cloud Run, the demo tenant's buckets and identities, the key secrets"
  tf apply -input=false -auto-approve -var-file="${TFVARS}" -var "image=${IMAGE}"
}

# --- Stage 6: load the secrets ----------------------------------------------
# Values are piped to gcloud on stdin. Never an argument: arguments are visible
# in the process list to anything running on the machine.

stage_6() {
  say "Stage 6: load secret values"

  local tenant_secret
  tenant_secret="$(tf output -json tenants | sed -n 's/.*"pseudonymisation_secret": *"\([^"]*\)".*/\1/p' | head -1)"
  [ -n "${tenant_secret}" ] || die "could not read the tenant's secret id from Terraform outputs."

  if gcloud secrets versions list "${tenant_secret}" --project "${PROJECT_ID}" \
       --filter='state:ENABLED' --format='value(name)' 2>/dev/null | grep -q .; then
    info "${tenant_secret} already holds a version, leaving it alone"
    info "rotating it would make every existing pseudonym unresolvable: see docs/data-governance.md"
  else
    info "generating the demo tenant's pseudonymisation key"
    openssl rand -base64 48 | tr -d '\n' \
      | gcloud secrets versions add "${tenant_secret}" --data-file=- --project "${PROJECT_ID}"
    info "loaded into ${tenant_secret}"
  fi

  local anthropic_secret="anthropic-api-key"
  if ! gcloud secrets describe "${anthropic_secret}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    info "${anthropic_secret} does not exist yet; it is created when the agents are configured"
    return
  fi

  if gcloud secrets versions list "${anthropic_secret}" --project "${PROJECT_ID}" \
       --filter='state:ENABLED' --format='value(name)' 2>/dev/null | grep -q .; then
    info "${anthropic_secret} already holds a version, leaving it alone"
    return
  fi

  local key="${ANTHROPIC_API_KEY:-}"
  if [ -z "${key}" ]; then
    info "no ANTHROPIC_API_KEY in the environment"
    printf '    Paste the Anthropic API key (input hidden), or press enter to skip: '
    read -rs key || true
    printf '\n'
  fi

  if [ -z "${key}" ]; then
    info "skipped. The dashboard renders with the agent panels showing a disabled state."
    info "Load it later with:"
    info "  printf '%%s' \"\$ANTHROPIC_API_KEY\" | gcloud secrets versions add ${anthropic_secret} --data-file=- --project ${PROJECT_ID}"
  else
    printf '%s' "${key}" | gcloud secrets versions add "${anthropic_secret}" \
      --data-file=- --project "${PROJECT_ID}"
    unset key
    info "loaded into ${anthropic_secret}"
  fi
}

# --- Stage 7: switch the agents on ------------------------------------------

stage_7() {
  say "Stage 7: switch the agents on"

  if ! gcloud secrets versions list "anthropic-api-key" --project "${PROJECT_ID}" \
         --filter='state:ENABLED' --format='value(name)' 2>/dev/null | grep -q .; then
    info "the Anthropic secret holds no value, so the agents stay off"
    info "run stage 6 with a key, then this stage again"
    return
  fi

  tf apply -input=false -auto-approve -var-file="${TFVARS}" -var "image=${IMAGE}" \
    -var "enable_agents=true"
}

# --- Stage 8: verify ---------------------------------------------------------

stage_8() {
  say "Stage 8: verify"

  local url
  url="$(tf output -raw service_url)"
  info "inference service: ${url}"

  info "health:"
  curl -sS -o /dev/null -w '      /healthz -> %{http_code}\n' "${url}/healthz" || true
  curl -sS -o /dev/null -w '      /readyz  -> %{http_code}\n' "${url}/readyz"  || true

  say "Outputs"
  tf output

  say "Next"
  info "1. Set the tenant environment on Vercel from: terraform output tenant_platform_env"
  info "2. Point the standalone dashboard at the service with ?api=${url}"
  info "3. Put the billing account id in ${TFVARS} and re-apply to switch the budget alert on"
  info "4. Costs: docs/run-cost-model.md. Expected is single digits a month with nothing kept warm."
}

# --- Driver ------------------------------------------------------------------

STAGES=("$@")
if [ ${#STAGES[@]} -eq 0 ]; then
  STAGES=(0 1 2 3 4 5 6 7 8)
fi

for s in "${STAGES[@]}"; do
  case "${s}" in
    0|1|2|3|4|5|6|7|8) "stage_${s}" ;;
    *) die "unknown stage '${s}'. Stages are 0 to 8." ;;
  esac
done

say "Done"
