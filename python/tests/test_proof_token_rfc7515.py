"""RFC 7515 HS256 signature segment (consumer smoke 2026-11-24).

imrobot 0.8.0 put base64url(hex string) in the signature segment (86 chars),
so PyJWT / jose rejected the tokens although the docs promise RFC 7519.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from imrobot import ProofTokenIssuer

KEY_A = "a" * 32
KEY_B = "b" * 32


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _mac(key: str, signing_input: str) -> bytes:
    return hmac.new(key.encode(), signing_input.encode(), hashlib.sha256).digest()


async def _issue_one() -> str:
    return await ProofTokenIssuer(secret=KEY_A).issue(
        agent_id="agent_1",
        challenge_id="ch_1",
        difficulty="easy",
        solve_time_ms=5,
        suspicious=False,
    )


class TestRfc7515Signature:
    async def test_issues_base64url_of_raw_hmac(self):
        h, p, s = (await _issue_one()).split(".")
        assert len(s) == 43
        assert s == _b64(_mac(KEY_A, f"{h}.{p}"))

    async def test_verifies_standard_hs256_token(self):
        now = int(time.time())
        h = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
        claims = {
            "iss": "imrobot",
            "sub": "agent_x",
            "iat": now,
            "nbf": now,
            "exp": now + 60,
            "jti": "j",
        }
        p = _b64(json.dumps(claims).encode())
        token = f"{h}.{p}.{_b64(_mac(KEY_A, f'{h}.{p}'))}"
        result = await ProofTokenIssuer(secret=KEY_A).verify(token)
        assert result["valid"] is True, result
        assert result["payload"]["sub"] == "agent_x"

    async def test_accepts_legacy_hex_segment(self):
        h, p, _ = (await _issue_one()).split(".")
        legacy = f"{h}.{p}.{_b64(_mac(KEY_A, f'{h}.{p}').hex().encode())}"
        assert (await ProofTokenIssuer(secret=KEY_A).verify(legacy))["valid"] is True

    async def test_rejects_flipped_byte_wrong_key_and_garbage(self):
        issuer = ProofTokenIssuer(secret=KEY_A)
        h, p, s = (await _issue_one()).split(".")
        raw = bytearray(base64.urlsafe_b64decode(s + "="))
        raw[0] ^= 0x01
        flipped = f"{h}.{p}.{_b64(bytes(raw))}"
        assert (await issuer.verify(flipped))["reason"] == "invalid_signature"
        wrong_rfc = f"{h}.{p}.{_b64(_mac(KEY_B, f'{h}.{p}'))}"
        assert (await issuer.verify(wrong_rfc))["reason"] == "invalid_signature"
        wrong_legacy = f"{h}.{p}.{_b64(_mac(KEY_B, f'{h}.{p}').hex().encode())}"
        assert (await issuer.verify(wrong_legacy))["reason"] == "invalid_signature"
        assert (await issuer.verify(f"{h}.{p}.not*base64"))["reason"] == "malformed"
        not_utf8 = _b64(bytes([0xFF]) * 64)
        assert (await issuer.verify(f"{h}.{p}.{not_utf8}"))["reason"] == "malformed"
