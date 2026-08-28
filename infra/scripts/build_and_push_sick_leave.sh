#!/usr/bin/env bash
# Build the Next.js sick-leave dashboard image (from the repo root, which holds
# the Dockerfile and the checked-in sample data) and push it to Artifact
# Registry with Cloud Build.
#
# Usage:
#   infra/scripts/build_and_push_sick_leave.sh PROJECT_ID [REGION] [TAG]
#
# Prints the full image ref on the last line; paste it into your *.tfvars as
# sick_leave_image.
set -euo pipefail

PROJECT_ID="${1:?usage: build_and_push_sick_leave.sh PROJECT_ID [REGION] [TAG]}"
REGION="${2:-europe-west1}"
TAG="${3:-latest}"
REPO="welo"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/welo-sick-leave:${TAG}"

# Repo root is the build context (Dockerfile and package.json live there).
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo "Building ${IMAGE} from ${ROOT_DIR} ..." >&2
gcloud builds submit "${ROOT_DIR}" --tag "${IMAGE}" --project "${PROJECT_ID}"

echo "${IMAGE}"
