"""Data governance: minimise and sanitise what leaves the process to Anthropic.

Real client data is employee health data ("special personal information" under
POPIA). Before any grounding or question is sent to the model, this module:

- drops direct identifiers by field name (names, email, phone, ID number, ...),
- pseudonymises id fields (employee_id and friends) with a keyed hash,
- redacts identifiers that appear inside free-text values (email, SA ID number,
  phone), and
- neutralises prompt-injection attempts in free text.

It returns a report (counts and field names, never the values) so the call can
be audit-logged and metered without logging any personal data. See
docs/data-governance.md for the data-flow and POPIA posture.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from typing import Any, Dict, Tuple

# Field names (case-insensitive) that are direct identifiers and must never be
# sent. Dropped entirely rather than redacted.
DENY_FIELDS = {
    "name", "full_name", "first_name", "last_name", "surname", "employee_name",
    "email", "email_address", "phone", "phone_number", "mobile", "msisdn", "cell",
    "id_number", "national_id", "sa_id", "id_no", "passport", "address",
    "residential_address", "next_of_kin", "contact", "contact_number",
    "dob", "date_of_birth",
}

# Id fields that are pseudonymised (kept as a stable opaque token so the agent
# can still refer to "this employee" without seeing the real id).
ID_FIELDS = {"employee_id", "employee", "emp_id", "row_id", "member_id", "staff_id"}

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_SA_ID = re.compile(r"\b\d{13}\b")
_PHONE = re.compile(r"\+?\d[\d ()\-]{7,}\d")
_INJECT = re.compile(
    r"(?is)("
    r"ignore\s+(?:all|any|previous|prior|the\s+above).{0,40}?instructions?"
    r"|disregard\s+(?:all|any|the\s+above|previous).{0,40}?(?:instructions?|prompt)"
    r"|system\s+prompt"
    r"|you\s+are\s+now\b"
    r"|new\s+instructions?\s*:"
    r"|override\s+.{0,20}?instructions?"
    r")"
)


def _salt() -> bytes:
    # Set WELO_PSEUDONYM_SALT to a secret in production so pseudonyms are not
    # guessable and cannot be linked across deployments.
    return os.environ.get("WELO_PSEUDONYM_SALT", "welo-dev-salt-change-me").encode()


def pseudonymize(value: Any) -> str:
    digest = hmac.new(_salt(), str(value).encode(), hashlib.sha256).hexdigest()
    return "emp_" + digest[:12]


def _scrub_text(s: str, report: Dict[str, Any]) -> str:
    out = s
    for pat, repl in ((_EMAIL, "[REDACTED_EMAIL]"), (_SA_ID, "[REDACTED_ID]"),
                      (_PHONE, "[REDACTED_PHONE]")):
        out, n = pat.subn(repl, out)
        report["redactions"] += n
    out, n = _INJECT.subn("[removed instruction-like text]", out)
    report["injection_flags"] += n
    return out


def _scrub_value(v: Any, report: Dict[str, Any]) -> Any:
    if isinstance(v, dict):
        clean: Dict[str, Any] = {}
        for k, val in v.items():
            kl = str(k).lower()
            if kl in DENY_FIELDS:
                report["dropped_fields"].append(k)
                continue
            if kl in ID_FIELDS and isinstance(val, (str, int, float)) and not isinstance(val, bool):
                clean[k] = pseudonymize(val)
                report["pseudonymized"].append(k)
                continue
            clean[k] = _scrub_value(val, report)
        return clean
    if isinstance(v, list):
        return [_scrub_value(x, report) for x in v]
    if isinstance(v, str):
        return _scrub_text(v, report)
    return v


def new_report() -> Dict[str, Any]:
    return {"redactions": 0, "injection_flags": 0, "dropped_fields": [], "pseudonymized": []}


def sanitize(question: str, data: Dict[str, Any]) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
    """Return (clean_question, clean_data, report). The report contains counts
    and field names only, never any personal data value."""
    report = new_report()
    clean_q = _scrub_text(question or "", report)
    clean_data = _scrub_value(data or {}, report)
    return clean_q, clean_data, report
