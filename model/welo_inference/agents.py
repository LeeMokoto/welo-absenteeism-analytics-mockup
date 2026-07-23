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
from typing import Any, Dict, Iterator, List, Optional

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


# Shared guardrails prepended to every agent's system prompt.
_GUARDRAILS = (
    "You are an assistant inside Welo, an absenteeism-intelligence product for "
    "large South African employers. You are shown data produced by Welo's "
    "trained absenteeism and fatigue model for a workforce cohort.\n"
    "\nGround rules, always:\n"
    "- Reason only from the DATA provided in the user turn. If a number is not "
    "in the data, say you do not have it rather than inventing one.\n"
    "- The people in this data are synthetic model records, not real "
    "individuals. Do not present output as a clinical diagnosis or as medical "
    "advice about a real person. Frame clinical points as screening signals and "
    "programme prompts for a qualified occupational-health team to action.\n"
    "- Respect that this is workforce-health data: talk about cohorts and "
    "interventions, not surveillance of individuals. Never suggest disciplinary "
    "use of the risk scores.\n"
    "- Amounts are in South African Rand unless told otherwise. Be concrete and "
    "quantified; cite the actual figures from the data.\n"
    "- Be brief and structured. An HR operations lead is reading this between "
    "meetings, not a data scientist.\n"
    "- Do not use em dashes or en dashes; use commas, colons or hyphens."
)

# One system prompt per agent. Kept stable (no timestamps / random content) so
# the prefix caches cleanly across calls.
_AGENT_SYSTEM: Dict[str, str] = {
    "analyst": (
        _GUARDRAILS
        + "\n\nYour role: Portfolio Analyst. You help leadership read the "
        "whole covered workforce: where absence and cost concentrate, which "
        "cohorts carry the risk, and what the highest-leverage move is. When "
        "asked an open question, lead with the answer, then the two or three "
        "figures that justify it, then a recommended next step."
    ),
    "case": (
        _GUARDRAILS
        + "\n\nYour role: Case Assistant. You are shown one employee record with "
        "the model's prediction, fatigue score, the drivers behind it and the "
        "cohorts they belong to. Draft a short, practical support and "
        "return-to-work style plan: the two or three drivers most worth acting "
        "on, a suggested outreach or occupational-health step for each, and any "
        "medical-programme referral the existing employee medical aid could "
        "cover. Keep it supportive and non-punitive."
    ),
    "coordinator": (
        _GUARDRAILS
        + "\n\nYour role: Cover and Roster Coordinator. You are shown HR "
        "operational aggregates: predicted absence rate, shift cover-gap days, "
        "overtime backfill cost, absence frequency and return-to-work caseload, "
        "broken down by operational cohort. Translate this into concrete "
        "staffing and rostering actions: where the cover gap and overtime cost "
        "land hardest, what rostering or relief-pool change reduces it, and what "
        "to watch next. Quantify the days and Rand at stake."
    ),
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
    ) -> None:
        self.model = model
        self.thinking = thinking
        self._client = None
        self._reason_unavailable: Optional[str] = None

        if anthropic is None:
            self._reason_unavailable = (
                f"anthropic SDK not installed ({_ANTHROPIC_IMPORT_ERROR})"
            )
            return
        try:
            # Passing api_key=None lets the SDK resolve ANTHROPIC_API_KEY itself.
            self._client = (
                anthropic.Anthropic(api_key=api_key) if api_key
                else anthropic.Anthropic()
            )
        except Exception as exc:  # no key in the environment, typically
            self._reason_unavailable = str(exc)
            self._client = None

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
            raise AgentUnavailable(f"Unknown agent '{agent}'.")

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

    def run(self, agent: str, question: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Non-streaming call. Returns the full text plus token usage."""
        self._guard()
        with self._client.messages.stream(**self._kwargs(agent, question, data)) as stream:
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
        }

    def stream(self, agent: str, question: str, data: Dict[str, Any]) -> Iterator[str]:
        """Yield text chunks as they arrive (for Server-Sent Events)."""
        self._guard()
        with self._client.messages.stream(**self._kwargs(agent, question, data)) as stream:
            for text in stream.text_stream:
                yield text
