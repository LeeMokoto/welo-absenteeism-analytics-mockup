#!/usr/bin/env bash
# Build the welo_inference image (from model/, which holds the Dockerfile and
# the baked model artifacts) and push it to Artifact Registry with Cloud Build.
#
# Usage:
#   infra/scripts/build_and_push.sh PROJECT_ID [REGION] [TAG]
#
# Prints the full image ref on the last line; paste it into your *.tfvars.
set -euo pipefail

PROJECT_ID="${1:?usage: build_and_push.sh PROJECT_ID [REGION] [TAG]}"
REGION="${2:-europe-west1}"
TAG="${3:-latest}"
REPO="welo"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/welo-inference:${TAG}"

# model/ is the build context (Dockerfile lives there).
MODEL_DIR="$(cd "$(dirname "$0")/../../model" && pwd)"

echo "Building ${IMAGE} from ${MODEL_DIR} ..." >&2
gcloud builds submit "${MODEL_DIR}" --tag "${IMAGE}" --project "${PROJECT_ID}"

echo "${IMAGE}"
