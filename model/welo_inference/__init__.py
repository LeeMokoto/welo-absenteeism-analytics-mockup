"""Welo inference service.

A thin FastAPI wrapper around :mod:`welo_pipeline`. It loads the trained
model and the cached dashboard feed at startup and exposes them over
HTTP for the Next.js dashboard and any other downstream client.

The training pipeline is never invoked at request time. To refresh the
model, run ``python -m welo_pipeline --config configs/demo.yaml``
offline and then redeploy the container.
"""

__version__ = "0.1.0"
