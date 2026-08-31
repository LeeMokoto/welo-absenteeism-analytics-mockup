"""Agentic layer over the trained model, powered by the Anthropic Messages API.

The dashboard shows what the model predicts. These agents turn those numbers
into language an HR team can act on: they reason over the *same feed the model
produces* (never free-floating text) and answer questions, draft intervention
plans, and translate cover-gap/overtime exposure into rostering actions.

Architecture note (important): the Anthropic API key must never reach the
browser. This module runs server-side inside the inference service, reads the
key from the environment, and the dashboard talks to it over HTTP. If no key is
configured the service reports the agents as unavailable and the dashboard
falls back to its built-in, non-AI summaries, so the shareable static build
never breaks.

Every agent is grounded on synthetic cohort data. Nothing here is medical
advice about a real person; the prompts say so.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from . import governance

log = logging.getLogger("welo.inference.agents")

# Imported lazily so the service still starts (and /score, /feed keep working)
# when the anthropic package is not installed.
try:
    import anthropic
    _ANTHROPIC_IMPORT_ERROR: Optional[Exception] = None
except Exception as exc:  # pragma: no cover - only when dependency missing
    anthropic = None  # type: ignore
    _ANTHROPIC_IMPORT_ERROR = exc


class AgentUnavailable(RuntimeError):
    """Raised when the agents cannot run (no key, or SDK not installed).

    The API layer turns this into a 503 so the dashboard can fall back
    gracefully rather than showing a hard error to a client in a meeting.
    """


# System prompts live in agent_prompts.json, next to this module, because the
# same agents are also served by the Next.js route on Vercel
# (app/api/absenteeism/...). Both read this one file, so the guardrails cannot
# drift between the two deployments: that matters because the guardrails are the
# compliance position, not just wording. Edit the JSON, never a copy.
_PROMPTS_PATH = Path(__file__).with_name("agent_prompts.json")
with _PROMPTS_PATH.open(encoding="utf-8") as _fh:
    _PROMPTS = json.load(_fh)

# Shared guardrails prepended to every agent's system prompt.
_GUARDRAILS: str = _PROMPTS["guardrails"]

# One system prompt per agent. Kept stable (no timestamps / random content) so
# the prefix caches cleanly across calls.
_AGENT_SYSTEM: Dict[str, str] = {
    name: _GUARDRAILS + "\n\n" + role for name, role in _PROMPTS["roles"].items()
}

_MAX_TOKENS = 1500


class AgentService:
    """Server-side wrapper around the Anthropic Messages API for the 3 agents.

    Construct once and share across requests. Reads ``ANTHROPIC_API_KEY`` from
    the environment (via the SDK's default resolution) unless a key is passed
    explicitly through config.
    """

    def __init__(
        self,
        model: str = "claude-opus-4-8",
        api_key: Optional[str] = None,
        thinking: bool = True,
        timeout_s: float = 60.0,
        max_retries: int = 2,
        provider: str = "anthropic",
        vertex_project: Optional[str] = None,
        vertex_region: str = "us-east5",
    ) -> None:
        self.model = model
        self.thinking = thinking
        self.provider = (provider or "anthropic").strip().lower()
        self._client = None
        self._reason_unavailable: Optional[str] = None

        if anthropic is None:
            self._reason_unavailable = (
                f"anthropic SDK not installed ({_ANTHROPIC_IMPORT_ERROR})"
            )
            return

        opts = {"timeout": timeout_s, "max_retries": max_retries}
        try:
            if self.provider == "vertex":
                self._init_vertex(vertex_project, vertex_region, opts)
            elif self.provider == "anthropic":
                self._init_anthropic(api_key, opts)
            else:
                self._reason_unavailable = (
                    f"Unknown LLM provider '{self.provider}' "
                    "(set WELO_LLM_PROVIDER to 'anthropic' or 'vertex')."
                )
        except Exception as exc:  # pragma: no cover - unexpected SDK error
            self._reason_unavailable = str(exc)
            self._client = None

    def _init_anthropic(self, api_key: Optional[str], opts: Dict[str, Any]) -> None:
        # timeout + max_retries keep a demo from hanging or dying on a transient
        # error. Passing api_key=None lets the SDK resolve ANTHROPIC_API_KEY from
        # the environment itself.
        self._client = (
            anthropic.Anthropic(api_key=api_key, **opts) if api_key
            else anthropic.Anthropic(**opts)
        )
        # The SDK no longer raises at construction when no key is present; it
        # defers to call time. If we did not check here, the service would
        # report available=true with no key, the dashboard would show "Live",
        # and the first real call would fail in front of a client. So require a
        # resolvable key up front and stay on the offline fallback otherwise.
        if not getattr(self._client, "api_key", None):
            self._reason_unavailable = (
                "No Anthropic API key configured "
                "(set ANTHROPIC_API_KEY or WELO_ANTHROPIC_API_KEY)."
            )
            self._client = None

    def _init_vertex(self, vertex_project: Optional[str], vertex_region: str,
                     opts: Dict[str, Any]) -> None:
        # Claude on Vertex AI: no API key. Auth is GCP Application Default
        # Credentials (the Cloud Run runtime service account), resolved lazily at
        # call time, so the credential never lives in an env var or the image.
        # Availability keys on config, not a key: a project id is required, the
        # region has a default. The bare model ids (claude-opus-4-8, ...) are the
        # same on Vertex.
        VertexClient = getattr(anthropic, "AnthropicVertex", None)
        if VertexClient is None:
            self._reason_unavailable = (
                "anthropic SDK lacks Vertex support; install anthropic[vertex]."
            )
            return
        if not vertex_project:
            self._reason_unavailable = (
                "No Vertex project configured (set WELO_VERTEX_PROJECT)."
            )
            return
        self._client = VertexClient(
            project_id=vertex_project, region=vertex_region, **opts
        )

    @property
    def available(self) -> bool:
        return self._client is not None

    @property
    def reason_unavailable(self) -> Optional[str]:
        return self._reason_unavailable

    @property
    def agents(self) -> List[str]:
        return list(_AGENT_SYSTEM.keys())

    # -- prompt construction -------------------------------------------------

    def _system_for(self, agent: str) -> str:
        try:
            return _AGENT_SYSTEM[agent]
        except KeyError:
            raise AgentUnavailable(f"Unknown agent '{agent}'.") from None

    def _user_content(self, question: str, data: Dict[str, Any]) -> str:
        """Grounded user turn: the model data first, then the question."""
        data_json = json.dumps(data, indent=2, sort_keys=True, default=float)
        return (
            "DATA (Welo model output for this cohort):\n"
            f"```json\n{data_json}\n```\n\n"
            f"REQUEST:\n{question.strip()}"
        )

    def _kwargs(self, agent: str, question: str, data: Dict[str, Any]) -> Dict[str, Any]:
        # cache_control on the system block: the per-agent system prompt is
        # stable, so it caches across calls and only the data + question vary.
        kwargs: Dict[str, Any] = {
            "model": self.model,
            "max_tokens": _MAX_TOKENS,
            "system": [
                {
                    "type": "text",
                    "text": self._system_for(agent),
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            "messages": [
                {"role": "user", "content": self._user_content(question, data)}
            ],
        }
        if self.thinking:
            # Adaptive thinking is the recommended default on this model family.
            kwargs["thinking"] = {"type": "adaptive"}
        return kwargs

    # -- execution -----------------------------------------------------------

    def _guard(self) -> None:
        if not self.available:
            raise AgentUnavailable(
                self._reason_unavailable or "Agent service not configured."
            )

    def prepare(self, agent: str, question: str,
                data: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Governance boundary: sanitise the question and grounding, then build
        the request. Returns (request_kwargs, governance_report). Nothing leaves
        this method towards Anthropic without passing through governance.sanitize.
        """
        clean_q, clean_data, report = governance.sanitize(question, data)
        return self._kwargs(agent, clean_q, clean_data), report

    def run(self, agent: str, question: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Non-streaming call. Returns the full text, token usage and a
        governance report (counts only, no personal data)."""
        self._guard()
        kwargs, report = self.prepare(agent, question, data)
        with self._client.messages.stream(**kwargs) as stream:
            for _ in stream.text_stream:  # drain; streaming avoids timeouts
                pass
            final = stream.get_final_message()
        text = "".join(b.text for b in final.content if b.type == "text")
        return {
            "agent": agent,
            "model": self.model,
            "text": text,
            "usage": {
                "input_tokens": final.usage.input_tokens,
                "output_tokens": final.usage.output_tokens,
            },
            "governance": report,
        }

    def stream(self, agent: str, question: str, data: Dict[str, Any],
               on_usage: Optional[Callable[[Dict[str, int]], None]] = None,
               on_report: Optional[Callable[[Dict[str, Any]], None]] = None) -> Iterator[str]:
        """Yield text chunks as they arrive (for Server-Sent Events).

        ``on_usage`` is called once with the final token usage; ``on_report`` is
        called once, before streaming, with the governance report. Both are
        optional and let the caller record cost, metrics and the audit trail.
        """
        self._guard()
        kwargs, report = self.prepare(agent, question, data)
        if on_report is not None:
            on_report(report)
        with self._client.messages.stream(**kwargs) as stream:
            for text in stream.text_stream:
                yield text
            if on_usage is not None:
                final = stream.get_final_message()
                on_usage({
                    "input_tokens": final.usage.input_tokens,
                    "output_tokens": final.usage.output_tokens,
                })
