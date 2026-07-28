"""Authorisation decision, kept pure so it is easy to test.

Two low-cost methods, chosen to avoid an expensive gateway:

- **Shared API key** (``X-API-Key``) for the public demo, paired with the
  Anthropic spend cap and rate limiting.
- **Cloud IAP** for Welo's internal deployment: IAP authenticates the user
  upstream and sets a signed assertion header, so the service can trust its
  presence when ``trust_iap`` is on and ingress is restricted to IAP.

When neither an API key nor ``require_auth`` is configured the service is open
(demo default). See docs/data-governance.md for the trust boundary.
"""

from __future__ import annotations

from typing import Optional

# Headers Cloud IAP sets once it has authenticated the caller.
IAP_HEADERS = ("X-Goog-IAP-JWT-Assertion", "X-Goog-Authenticated-User-Email")


def authorized(
    api_key_cfg: Optional[str],
    require_auth: bool,
    trust_iap: bool,
    x_api_key: Optional[str],
    iap_present: bool,
) -> bool:
    if api_key_cfg and x_api_key and x_api_key == api_key_cfg:
        return True
    if trust_iap and iap_present:
        return True
    # No valid credential presented: allow only when no auth is expected.
    if api_key_cfg or require_auth:
        return False
    return True
