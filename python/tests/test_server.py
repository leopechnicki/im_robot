"""Tests for the server-side verifier, JWT proof tokens, and replay guard."""

from __future__ import annotations

import time

import pytest

from imrobot import (
    ImRobotVerifier,
    InMemoryReplayGuard,
    ProofTokenIssuer,
    hmac_sign,
    hmac_verify,
    sha256_hex,
    solve_challenge,
)

SECRET = "test-secret-at-least-sixteen-chars-ok"
SHORT_SECRET = "too-short"


# ---------------------------------------------------------------------------
# HMAC
# ---------------------------------------------------------------------------


class TestHmac:
    def test_sign_returns_64_hex(self):
        sig = hmac_sign(SECRET, "hello")
        assert len(sig) == 64
        assert all(c in "0123456789abcdef" for c in sig)

    def test_sign_deterministic(self):
        assert hmac_sign(SECRET, "hello") == hmac_sign(SECRET, "hello")

    def test_verify_matches(self):
        sig = hmac_sign(SECRET, "hello")
        assert hmac_verify(SECRET, "hello", sig) is True

    def test_verify_rejects_wrong_message(self):
        sig = hmac_sign(SECRET, "hello")
        assert hmac_verify(SECRET, "world", sig) is False

    def test_verify_rejects_wrong_secret(self):
        sig = hmac_sign(SECRET, "hello")
        assert hmac_verify("different-secret-16chars-min-ok", "hello", sig) is False

    def test_sha256_hex_returns_64(self):
        assert len(sha256_hex("hello")) == 64


# ---------------------------------------------------------------------------
# Verifier — generate + verify round trip
# ---------------------------------------------------------------------------


class TestVerifierConstruction:
    def test_short_secret_rejected(self):
        with pytest.raises(ValueError, match="16 non-whitespace"):
            ImRobotVerifier(secret=SHORT_SECRET)

    def test_invalid_difficulty_rejected(self):
        with pytest.raises(ValueError, match="difficulty"):
            ImRobotVerifier(secret=SECRET, difficulty="galaxy")  # type: ignore[arg-type]


class TestVerifierRoundTrip:
    async def test_generate_produces_valid_signed_challenge(self):
        verifier = ImRobotVerifier(secret=SECRET, difficulty="easy")
        challenge = await verifier.generate()
        assert challenge["version"] == 1
        assert len(challenge["id"]) == 16
        assert challenge["difficulty"] == "easy"
        assert len(challenge["pipeline"]) >= 2
        assert challenge["expiresAt"] > challenge["timestamp"]
        assert len(challenge["hmac"]) == 64

    async def test_correct_answer_verifies(self):
        verifier = ImRobotVerifier(secret=SECRET, difficulty="easy")
        challenge = await verifier.generate()
        answer = solve_challenge(challenge)
        result = await verifier.verify(challenge, answer)
        assert result["valid"] is True
        assert "elapsed" in result

    async def test_wrong_answer_rejected(self):
        verifier = ImRobotVerifier(secret=SECRET, difficulty="easy")
        challenge = await verifier.generate()
        result = await verifier.verify(challenge, "definitely-wrong")
        assert result["valid"] is False
        assert result["reason"] == "wrong_answer"

    async def test_tampered_hmac_rejected(self):
        verifier = ImRobotVerifier(secret=SECRET)
        challenge = await verifier.generate()
        answer = solve_challenge(challenge)
        # flip a byte in the HMAC
        challenge["hmac"] = "0" * 64
        result = await verifier.verify(challenge, answer)
        assert result["valid"] is False
        assert result["reason"] == "invalid_hmac"

    async def test_expired_challenge_rejected(self):
        verifier = ImRobotVerifier(secret=SECRET, ttl=1)  # 1ms TTL
        challenge = await verifier.generate()
        answer = solve_challenge(challenge)
        time.sleep(0.05)  # wait past TTL
        result = await verifier.verify(challenge, answer)
        assert result["valid"] is False
        assert result["reason"] == "expired"

    async def test_medium_difficulty(self):
        verifier = ImRobotVerifier(secret=SECRET, difficulty="medium")
        challenge = await verifier.generate()
        answer = solve_challenge(challenge)
        result = await verifier.verify(challenge, answer)
        assert result["valid"] is True

    async def test_hard_difficulty(self):
        verifier = ImRobotVerifier(secret=SECRET, difficulty="hard")
        challenge = await verifier.generate()
        answer = solve_challenge(challenge)
        result = await verifier.verify(challenge, answer)
        assert result["valid"] is True


# ---------------------------------------------------------------------------
# Replay guard
# ---------------------------------------------------------------------------


class TestReplayGuard:
    def test_first_use_accepted(self):
        guard = InMemoryReplayGuard()
        assert guard.mark_used("challenge-1") is True

    def test_second_use_rejected(self):
        guard = InMemoryReplayGuard()
        guard.mark_used("challenge-1")
        assert guard.mark_used("challenge-1") is False

    def test_capacity_bounded(self):
        guard = InMemoryReplayGuard(capacity=2)
        guard.mark_used("a")
        guard.mark_used("b")
        guard.mark_used("c")  # evicts "a"
        assert guard.mark_used("a") is True  # "a" was evicted, allowed again

    async def test_replay_rejected_by_verifier(self):
        guard = InMemoryReplayGuard()
        verifier = ImRobotVerifier(secret=SECRET, difficulty="easy", replay_guard=guard)
        challenge = await verifier.generate()
        answer = solve_challenge(challenge)
        result1 = await verifier.verify(challenge, answer)
        assert result1["valid"] is True
        result2 = await verifier.verify(challenge, answer)
        assert result2["valid"] is False
        assert result2["reason"] == "replay"


# ---------------------------------------------------------------------------
# Proof tokens (JWT HS256)
# ---------------------------------------------------------------------------


class TestProofTokenIssue:
    def test_short_secret_rejected(self):
        with pytest.raises(ValueError, match="16 non-whitespace"):
            ProofTokenIssuer(secret=SHORT_SECRET)

    async def test_issue_and_verify(self):
        issuer = ProofTokenIssuer(secret=SECRET, issuer="test-iss")
        token = await issuer.issue(
            agent_id="agent_1",
            challenge_id="ch_1",
            difficulty="medium",
            solve_time_ms=42,
            suspicious=False,
        )
        assert token.count(".") == 2
        result = await issuer.verify(token)
        assert result["valid"] is True
        assert result["payload"]["sub"] == "agent_1"
        assert result["payload"]["iss"] == "test-iss"
        assert result["payload"]["imr"]["challenge_id"] == "ch_1"
        assert result["payload"]["imr"]["difficulty"] == "medium"
        assert result["payload"]["imr"]["solve_time_ms"] == 42

    async def test_malformed_token(self):
        issuer = ProofTokenIssuer(secret=SECRET)
        assert (await issuer.verify("not-a-jwt"))["reason"] == "malformed"
        assert (await issuer.verify("a.b"))["reason"] == "malformed"

    async def test_tampered_signature_rejected(self):
        issuer = ProofTokenIssuer(secret=SECRET)
        token = await issuer.issue(
            agent_id="agent_1",
            challenge_id="ch_1",
            difficulty="easy",
            solve_time_ms=10,
            suspicious=False,
        )
        parts = token.split(".")
        # Corrupt signature
        parts[2] = "A" * len(parts[2])
        tampered = ".".join(parts)
        result = await issuer.verify(tampered)
        assert result["valid"] is False
        assert result["reason"] == "invalid_signature"

    async def test_wrong_issuer_rejected(self):
        issuer_a = ProofTokenIssuer(secret=SECRET, issuer="issuer-a")
        issuer_b = ProofTokenIssuer(secret=SECRET, issuer="issuer-b")
        token = await issuer_a.issue(
            agent_id="agent_1",
            challenge_id="ch_1",
            difficulty="easy",
            solve_time_ms=10,
            suspicious=False,
        )
        result = await issuer_b.verify(token)
        assert result["valid"] is False
        assert result["reason"] == "invalid_issuer"

    async def test_expired_token_rejected(self):
        # 1ms TTL, wait past it
        issuer = ProofTokenIssuer(secret=SECRET, token_ttl_ms=1, clock_skew_sec=0)
        token = await issuer.issue(
            agent_id="agent_1",
            challenge_id="ch_1",
            difficulty="easy",
            solve_time_ms=10,
            suspicious=False,
        )
        time.sleep(1.1)
        result = await issuer.verify(token)
        assert result["valid"] is False
        assert result["reason"] == "expired"

    async def test_key_rotation(self):
        old_secret = "old-secret-at-least-sixteen-chars"
        new_secret = "new-secret-at-least-sixteen-chars"
        old_issuer = ProofTokenIssuer(secret=old_secret, key_id="k-old")
        token = await old_issuer.issue(
            agent_id="agent_1",
            challenge_id="ch_1",
            difficulty="easy",
            solve_time_ms=10,
            suspicious=False,
        )
        # New verifier accepts both current + previous secrets
        new_issuer = ProofTokenIssuer(
            secret=new_secret,
            key_id="k-new",
            previous_secrets=[{"keyId": "k-old", "secret": old_secret}],
        )
        result = await new_issuer.verify(token)
        assert result["valid"] is True
        assert result["keyId"] == "k-old"

    async def test_unknown_kid_rejected(self):
        # Token signed with unrelated kid
        alt_issuer = ProofTokenIssuer(secret=SECRET, key_id="stranger")
        token = await alt_issuer.issue(
            agent_id="agent_1",
            challenge_id="ch_1",
            difficulty="easy",
            solve_time_ms=10,
            suspicious=False,
        )
        # Verifier doesn't know 'stranger' kid
        strict_issuer = ProofTokenIssuer(secret=SECRET, key_id="known-only")
        result = await strict_issuer.verify(token)
        assert result["valid"] is False
        assert result["reason"] == "unknown_key"
        assert result["keyId"] == "stranger"

    def test_decode_unsafe(self):
        # Static decode without verification (for debugging)
        # We just check it doesn't raise on a well-formed token
        parts = [
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",  # {"alg":"HS256","typ":"JWT"}
            "eyJzdWIiOiJhZ2VudF8xIn0",  # {"sub":"agent_1"}
            "signature",
        ]
        token = ".".join(parts)
        decoded = ProofTokenIssuer.decode_unsafe(token)
        assert decoded is not None
        assert decoded["sub"] == "agent_1"

    def test_decode_unsafe_malformed(self):
        assert ProofTokenIssuer.decode_unsafe("not-a-token") is None
