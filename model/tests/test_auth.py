"""Tests for the pure authorisation decision."""

from __future__ import annotations

from welo_inference.auth import authorized


def test_open_when_nothing_configured():
    assert authorized(None, require_auth=False, trust_iap=False,
                      x_api_key=None, iap_present=False) is True


def test_api_key_required_and_matched():
    assert authorized("secret", False, False, "secret", False) is True
    assert authorized("secret", False, False, "wrong", False) is False
    assert authorized("secret", False, False, None, False) is False


def test_iap_accepted_only_when_trusted():
    assert authorized(None, True, True, None, iap_present=True) is True
    # require_auth on but IAP not trusted and no key -> denied
    assert authorized(None, True, False, None, iap_present=True) is False


def test_require_auth_without_credential_denies():
    assert authorized(None, require_auth=True, trust_iap=False,
                      x_api_key=None, iap_present=False) is False


def test_key_or_iap_either_satisfies():
    assert authorized("secret", True, True, "secret", False) is True   # key
    assert authorized("secret", True, True, None, True) is True         # iap
    assert authorized("secret", True, True, "nope", False) is False     # neither
