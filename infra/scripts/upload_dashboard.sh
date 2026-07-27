#!/usr/bin/env bash
# Upload the static dashboard to the GCS bucket Terraform created. Only the
# files the browser needs are uploaded, preserving the paths index.html expects
# (config/*.js and model/data/outputs/dashboard_feed*.js).
#
# Usage:
#   infra/scripts/upload_dashboard.sh BUCKET_NAME
set -euo pipefail

BUCKET="${1:?usage: upload_dashboard.sh BUCKET_NAME}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "${ROOT}"
gsutil -h "Content-Type:text/html"        cp index.html                        "gs://${BUCKET}/index.html"
gsutil -h "Content-Type:application/javascript" -m cp config/*.js              "gs://${BUCKET}/config/"
gsutil -h "Content-Type:application/javascript" -m cp model/data/outputs/dashboard_feed*.js "gs://${BUCKET}/model/data/outputs/"

echo "Uploaded. Open: https://storage.googleapis.com/${BUCKET}/index.html"
echo "Wire the agents by appending ?api=<cloud-run-url> to that URL."
