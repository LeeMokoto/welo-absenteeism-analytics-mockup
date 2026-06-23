# Welo Health Intelligence: Absenteeism

This repository contains the absenteeism prediction stack that Welo uses to forecast workforce absence, surface the drivers behind it, and turn the result into the dashboard view that mining-sector clients see. It ships three things that fit together: a modular training pipeline, a FastAPI inference service designed for Cloud Run, and the dashboard assets that consume the model output.

The current build is a demo configuration. It learns from a small UCI absenteeism dataset blended with a plausibility-anchored synthetic mining cohort, so the model returns realistic numbers and the SHAP explanations make clinical sense. When the live Glencore feed (or any other client feed) arrives, only the data adapter and its YAML config need to change. Everything downstream stays the same.

## What lives where

The `welo_pipeline` package is the training side. It is organised by stage, with one module per step, so `ingest.py` pulls data through a configured adapter, `validate.py` produces a structured data-quality report, `features.py` does the feature engineering (including the composite fatigue and burnout score that drives the headline lever), `train.py` fits the regression and classification models inside a sklearn pipeline, `score.py` produces per-employee predictions, `explain.py` derives SHAP-based reasons, and `export.py` packages the result as the JSON shape the dashboard consumes. The `pipeline.py` module wires them together so the notebook and the CLI go through the same path.

The `welo_pipeline/adapters` package is where source-specific data shapes live. There is an adapter for the UCI subset, one for the synthetic mining cohort, and a stub for the Glencore feed that documents the rename map that will be needed on day one of live data. The pipeline never imports an adapter directly; it asks the registry by name.

The `welo_inference` package is the runtime side. It loads the persisted model artifacts and the cached dashboard feed once at startup and answers requests in memory through a small set of FastAPI endpoints. There is no training at request time.

The dashboard mockup is `index.html` and is wired to load `data/outputs/dashboard_feed.json` (delivered through a small `.js` wrapper so it works from a `file://` open). The `welo-nextjs` folder contains the Next.js components for the ROI calculator that will eventually replace the static page.

Trained model artifacts live in `models/`, the cached predictions and the dashboard feed live in `data/outputs/`, the validation and metrics snapshots live in `reports/`, and notebooks live in `notebooks/` (plus the original EDA notebook at the repository root).

## Getting started

Set up a Python 3.12 environment and install the dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The `requirements.txt` covers everything for both training and inference, including FastAPI, scikit-learn, SHAP, pandas, and Jupyter.

## Running the training pipeline

The pipeline is config-driven. The demo configuration lives in `configs/demo.yaml` and points at the UCI export with the synthetic mining cohort layered on top. Run it from the repository root:

```bash
python -m welo_pipeline --config configs/demo.yaml
```

That single command ingests the data, validates it, builds features, trains both the regression and the classification model, scores every row, computes SHAP explanations, and writes the dashboard feed. It also prints the cross-validated metrics alongside in-sample fit so the honest performance number always travels with the artifact.

For an interactive walkthrough, open `notebooks/welo_demo_pipeline.ipynb`. It runs the same stages step by step and shows the intermediate artifacts (validation report, feature bundle, model metrics, SHAP importance, and the cohort fatigue segment).

After a successful run the outputs are:

```text
models/regressor.joblib
models/classifier.joblib
models/manifest.joblib
data/outputs/predictions.csv
data/outputs/dashboard_feed.json
data/outputs/dashboard_feed.js
reports/validation_report.json
reports/model_metrics.json
```

## Running the inference service locally

The inference service is a thin FastAPI wrapper that loads `models/*.joblib` and `data/outputs/dashboard_feed.json` at startup. Run it with:

```bash
uvicorn welo_inference.main:app --reload --port 8080
```

The interactive OpenAPI docs are then served at http://localhost:8080/docs. The service exposes a small set of endpoints: `GET /healthz` and `GET /readyz` for liveness and readiness probes, `GET /metadata` for model and provenance information, `GET /feed` for the cached dashboard payload that the dashboard consumes, `POST /score` for batch scoring of arbitrary employees, and `POST /score/explain` for the same call with SHAP top reasons attached.

A minimal scoring request looks like this:

```bash
curl -X POST http://localhost:8080/score \
  -H 'Content-Type: application/json' \
  -d '{"employees": [{"age": 41, "bmi": 28.4, "workload_index_current": 260, "sleep_hours_avg_7d": 5.8, "overtime_hours_14d": 32, "consecutive_shifts_worked": 11}]}'
```

The response contains the predicted absent hours, the projected days over the configured horizon, the risk band, the fatigue and burnout score and band, and the per-band probabilities. Pass `"include_reasons": true` (or call `/score/explain`) to get the top SHAP-derived drivers alongside each prediction.

## Configuration

Every runtime knob the inference service exposes is overridable through an environment variable, which keeps Cloud Run deployments clean. The full list lives in `welo_inference/config.py`, but the ones that matter day to day are `WELO_MODELS_DIR` (defaults to `models`), `WELO_FEED_PATH` (defaults to `data/outputs/dashboard_feed.json`), `WELO_API_KEY` (unset means no authentication, useful for local development), `WELO_CORS_ORIGINS` (a comma-separated allowlist, defaults to `*` for the demo and should be locked down in production), and `WELO_HORIZON_DAYS` (defaults to 90).

## Deploying to Cloud Run

The repository ships a `Dockerfile` that bakes the trained artifacts and the cached dashboard feed into the image. From the repository root, build and deploy with:

```bash
gcloud builds submit --tag gcr.io/$PROJECT_ID/welo-inference
gcloud run deploy welo-inference \
  --image gcr.io/$PROJECT_ID/welo-inference \
  --region europe-west1 \
  --platform managed \
  --memory 1Gi \
  --allow-unauthenticated \
  --set-env-vars=WELO_CORS_ORIGINS=https://welo-dashboard.example.com
```

Training is intentionally offline. To ship a new model, run the pipeline locally (or in CI), commit the refreshed `models/` and `data/outputs/dashboard_feed.json`, and rebuild the image.

## The dashboard

Open `index.html` in a browser and the page will hydrate itself from `data/outputs/dashboard_feed.js`. Every panel that pulls live data has a hardcoded fallback baked in, so the page also renders cleanly without the feed (handy for screenshots and presentations).

To wire the same payload into the Next.js dashboard under `welo-nextjs/`, fetch `/feed` from the deployed inference service and pass it to the components in `components/`.

## Data and adapters

The repository contains three CSV exports used for the demo (`welo_export.csv`, `welo_full_export.csv`, and `welo_full_export_2.csv`) plus the synthetic mining cohort, which is generated in code. The synthetic adapter is calibrated to South African mining-cohort epidemiology and to the workload and shift assumptions the dashboard makes, and every synthetic row is tagged with `source_dataset = "synthetic_mining_v1"` so it can be filtered out the moment real client data lands.

The UCI subset is small (about 200 rows). It is enough to demonstrate the pipeline end to end, but the headline numbers in the demo are driven by the synthetic cohort. None of the synthetic data is presented as a real client outcome on the dashboard.

## What changes when Glencore data arrives

Only two things. The `welo_pipeline/adapters/glencore.py` stub gets a real `load` implementation that reads whatever shape Glencore ships and renames the columns to the canonical Welo schema (the documented rename map in that file is the starting point). A new config file at `configs/glencore.yaml` points the pipeline at the Glencore adapter instead of the UCI plus synthetic mining combination. Everything else, from feature engineering through model training to the dashboard JSON shape, is untouched.

## Repository layout at a glance

```text
.
├── configs/                     pipeline configs (demo.yaml, future glencore.yaml)
├── data/
│   └── outputs/                 generated predictions and dashboard feed
├── models/                      trained joblib artifacts
├── notebooks/                   demo and EDA notebooks
├── reports/                     validation and metrics snapshots
├── welo_pipeline/               training pipeline package
│   └── adapters/                source-specific data adapters
├── welo_inference/              FastAPI inference service
├── welo-nextjs/                 Next.js dashboard components
├── index.html                   static dashboard mockup
├── Dockerfile                   image for Cloud Run
└── requirements.txt             Python dependencies
```
