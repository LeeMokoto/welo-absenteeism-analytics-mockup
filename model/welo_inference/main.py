"""FastAPI app and Cloud Run entry point.

To run the service locally, use::

    uvicorn welo_inference.main:app --reload --port 8080

The interactive OpenAPI docs are then served at
http://localhost:8080/docs.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import __version__
from .agents import AgentService, AgentUnavailable
from .config import InferenceConfig, get_config
from .schemas import (
    AgentRequest,
    AgentResponse,
    AgentsStatusResponse,
    HealthResponse,
    MetadataResponse,
    ScoreRequest,
    ScoreResponse,
)
from .service import InferenceService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("welo.inference.main")


def require_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    config: InferenceConfig = request.app.state.config
    if not config.api_key:
        return
    if not x_api_key or x_api_key != config.api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-API-Key.",
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = get_config()
    service = InferenceService(config)
    try:
        service.load()
    except Exception as exc:
        log.exception("model load failed: %s", exc)
    agents = AgentService(
        model=config.agent_model,
        api_key=config.anthropic_api_key,
        thinking=config.agent_thinking,
    )
    app.state.config = config
    app.state.service = service
    app.state.agents = agents
    log.info(
        "startup complete: ready=%s version=%s agents=%s (%s)",
        service.ready,
        service.model_version,
        agents.available,
        agents.model if agents.available else agents.reason_unavailable,
    )
    yield


app = FastAPI(
    title="Welo Inference",
    description=(
        "HTTP interface to the trained Welo absenteeism + fatigue model. "
        "Training is offline; this service loads the persisted artifacts at startup."
    ),
    version=__version__,
    lifespan=lifespan,
)

_initial_cors = get_config().cors_origins or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_initial_cors,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=False,
)


@app.get("/", include_in_schema=False)
def root() -> Dict[str, Any]:
    return {"service": "welo-inference", "version": __version__, "docs": "/docs"}


@app.get("/healthz", response_model=HealthResponse, tags=["health"])
def healthz(request: Request) -> HealthResponse:
    svc: InferenceService = request.app.state.service
    return HealthResponse(status="ok", version=__version__, model_loaded=svc.ready)


@app.get("/readyz", tags=["health"])
def readyz(request: Request) -> JSONResponse:
    svc: InferenceService = request.app.state.service
    if svc.ready:
        return JSONResponse({"status": "ready"})
    return JSONResponse({"status": "not_ready"}, status_code=503)


@app.get("/metadata", response_model=MetadataResponse, tags=["meta"])
def metadata(request: Request) -> MetadataResponse:
    svc: InferenceService = request.app.state.service
    if not svc.ready:
        raise HTTPException(status_code=503, detail="Model not loaded.")
    return MetadataResponse(
        run_name=svc.model_version,
        model_version=svc.model_version,
        feature_names=svc.feature_names,
        class_labels=svc.class_labels,
        metrics=svc.metrics(),
        data_provenance=svc.provenance(),
    )


@app.get("/feed", tags=["dashboard"])
def feed(request: Request) -> Dict[str, Any]:
    """Return the cached dashboard payload.

    The response has the same shape as ``dashboard_feed.json`` and is
    intended for the dashboard hero. It is open to public traffic, so
    protect it in production with a CORS allowlist and the optional API
    key.
    """
    svc: InferenceService = request.app.state.service
    if not svc.dashboard_feed:
        raise HTTPException(
            status_code=404,
            detail="No dashboard feed available. Run the pipeline to generate one.",
        )
    return svc.dashboard_feed


@app.post(
    "/score",
    response_model=ScoreResponse,
    tags=["inference"],
    dependencies=[Depends(require_api_key)],
)
def score(request: Request, payload: ScoreRequest) -> ScoreResponse:
    svc: InferenceService = request.app.state.service
    if not svc.ready:
        raise HTTPException(status_code=503, detail="Model not loaded.")

    employees = [emp.model_dump() for emp in payload.employees]
    predictions = svc.score(employees, include_reasons=payload.include_reasons)
    return ScoreResponse(
        model_version=svc.model_version,
        horizon_days=svc.config.horizon_days,
        predictions=predictions,
    )


@app.post(
    "/score/explain",
    response_model=ScoreResponse,
    tags=["inference"],
    dependencies=[Depends(require_api_key)],
)
def score_explain(request: Request, payload: ScoreRequest) -> ScoreResponse:
    """Convenience endpoint that always returns SHAP top reasons per employee."""
    payload.include_reasons = True
    return score(request, payload)


# --- Agents (Anthropic Messages API) ------------------------------------------
# These endpoints call the Anthropic API server-side. The API key lives only in
# this process (ANTHROPIC_API_KEY / WELO_ANTHROPIC_API_KEY), never in the
# browser. When no key is configured the status endpoint reports
# available=false and the dashboard falls back to its built-in summaries.


@app.get("/agents", response_model=AgentsStatusResponse, tags=["agents"])
def agents_status(request: Request) -> AgentsStatusResponse:
    """Whether the AI agents are configured. The dashboard polls this to decide
    between live agents and its offline fallback."""
    svc: AgentService = request.app.state.agents
    return AgentsStatusResponse(
        available=svc.available,
        model=svc.model if svc.available else None,
        agents=svc.agents,
        reason=None if svc.available else svc.reason_unavailable,
    )


@app.post(
    "/agents/{agent}",
    response_model=AgentResponse,
    tags=["agents"],
    dependencies=[Depends(require_api_key)],
)
def agent_run(request: Request, agent: str, payload: AgentRequest) -> AgentResponse:
    """Non-streaming agent call. Returns the full answer plus token usage."""
    svc: AgentService = request.app.state.agents
    if agent not in svc.agents:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{agent}'.")
    try:
        result = svc.run(agent, payload.question, payload.data)
    except AgentUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return AgentResponse(**result)


@app.post(
    "/agents/{agent}/stream",
    tags=["agents"],
    dependencies=[Depends(require_api_key)],
)
def agent_stream(request: Request, agent: str, payload: AgentRequest) -> StreamingResponse:
    """Stream the agent's answer as Server-Sent Events.

    Each token arrives as a ``data:`` line; the stream ends with
    ``event: done``. This keeps the dashboard panel filling in live, which is
    the point of the demo.
    """
    svc: AgentService = request.app.state.agents
    if agent not in svc.agents:
        raise HTTPException(status_code=404, detail=f"Unknown agent '{agent}'.")
    if not svc.available:
        raise HTTPException(status_code=503, detail=svc.reason_unavailable or "Agents not configured.")

    def event_source():
        try:
            for chunk in svc.stream(agent, payload.question, payload.data):
                yield f"data: {json.dumps({'text': chunk})}\n\n"
        except AgentUnavailable as exc:
            yield f"event: error\ndata: {json.dumps({'error': str(exc)})}\n\n"
            return
        except Exception as exc:  # surface API errors to the client cleanly
            log.exception("agent stream failed: %s", exc)
            yield f"event: error\ndata: {json.dumps({'error': 'agent request failed'})}\n\n"
            return
        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
