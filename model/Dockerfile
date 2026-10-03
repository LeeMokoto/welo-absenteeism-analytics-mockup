# Image for the Welo inference service. We start from a Python 3.12 slim
# base, install dependencies in their own layer, copy the application
# code on top, and bake the trained model artifacts and cached dashboard
# feed in last. The container listens on $PORT, which Cloud Run injects
# at runtime and which defaults to 8080 when running locally.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

# Dependencies come from a hash-pinned lock, not a floating range. Two reasons.
# A range means the image you ship to a client is not the image you tested, and
# it changes under you on a rebuild. And --require-hashes means a compromised or
# substituted package on the index fails the build instead of entering the
# image. Regenerate the lock with:
#
#   pip-compile --generate-hashes requirements-runtime.in
#
# requirements.txt is the training and analysis environment (jupyter,
# matplotlib, seaborn) and deliberately does not belong in a serving image.
COPY requirements-runtime.txt ./
RUN pip install --no-cache-dir --require-hashes -r requirements-runtime.txt

COPY welo_pipeline ./welo_pipeline
COPY welo_inference ./welo_inference

# Trained artifacts and the cached dashboard feed are baked into the image.
COPY models ./models
COPY data/outputs/dashboard_feed.json ./data/outputs/dashboard_feed.json

ENV WELO_MODELS_DIR=/app/models \
    WELO_FEED_PATH=/app/data/outputs/dashboard_feed.json \
    PORT=8080

# Run as a non-root user, matching the dashboard image. The service writes
# nothing to disk: the model artifacts and the feed are read-only, and cache and
# rate-limit state live in memory, so it needs no write access to anything it
# owns. A container that cannot write cannot be made to persist anything.
RUN groupadd --system --gid 1001 welo \
 && useradd --system --uid 1001 --gid welo welo \
 && chown -R welo:welo /app
USER welo

EXPOSE 8080

# Cloud Run drives its own startup and liveness probes (configured in
# infra/terraform), so this is for everywhere else the image runs: a local
# container, a compose stack, or any scheduler that reads Docker health. Uses
# the interpreter already present rather than adding curl to the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["python", "-c", "import os,urllib.request;urllib.request.urlopen(f\"http://127.0.0.1:{os.environ.get('PORT','8080')}/healthz\",timeout=4)"]

CMD ["sh", "-c", "exec uvicorn welo_inference.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
