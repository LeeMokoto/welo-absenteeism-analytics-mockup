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

COPY requirements.txt ./
RUN pip install --no-cache-dir \
      "fastapi>=0.115" \
      "uvicorn[standard]>=0.30" \
      "pydantic>=2.7" \
      "pandas>=2.2" \
      "numpy>=1.26" \
      "scikit-learn>=1.5" \
      "shap>=0.46" \
      "joblib>=1.4" \
      "pyyaml>=6.0" \
      "anthropic>=0.40"

COPY welo_pipeline ./welo_pipeline
COPY welo_inference ./welo_inference

# Trained artifacts and the cached dashboard feed are baked into the image.
COPY models ./models
COPY data/outputs/dashboard_feed.json ./data/outputs/dashboard_feed.json

ENV WELO_MODELS_DIR=/app/models \
    WELO_FEED_PATH=/app/data/outputs/dashboard_feed.json \
    PORT=8080

EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn welo_inference.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
