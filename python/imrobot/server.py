"""
Server-side verifier with HMAC-SHA256 signing.

Port of src/server/verifier.ts -- provides tamper-proof,
stateless, replay-resistant verification with zero database overhead.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Optional, Set

from .core import generate_challenge, solve_challenge
from .hash import fnv1a
from .operations import execute_pipeline
from .types import (
    Challenge,
    Difficulty,
    SignedChallenge,
    VerifyResult,
    SUSPICIOUS_THRESHOLD_MS,
)


def _hmac_sign(secret: str, message: str) -> str:
    """Compute HMAC-SHA256, returning a 64-char lowercase hex string."""
    return hmac.new(
        secret.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _hmac_verify(secret: str, message: str, signature: str) -> bool:
    """Constant-time HMAC-SHA256 verification."""
    expected = _hmac_sign(secret, message)
    return hmac.compare_digest(expected, signature)


class ChallengeReplayGuard:
    """
    In-memory replay guard that tracks used challenge IDs.

    Prevents the same challenge from being verified more than once.
    """

    def __init__(self, max_age_ms: int = 300_000):
        self._max_age_ms = max_age_ms
        self._used: dict[str, int] = {}

    def mark_used(self, challenge_id: str) -> bool:
        """
        Mark a challenge ID as used.

        Returns True if the ID was not previously used (allowed),
        False if it was already used (replay detected).
        """
        self._cleanup()
        if challenge_id in self._used:
            return False
        self._used[challenge_id] = int(time.time() * 1000)
        return True

    def _cleanup(self) -> None:
        """Remove expired entries."""
        now = int(time.time() * 1000)
        cutoff = now - self._max_age_ms
        self._used = {
            k: v for k, v in self._used.items() if v > cutoff
        }


class ImRobotVerifier:
    """
    Server-side challenge verifier with HMAC-SHA256 signing.

    Provides stateless, tamper-proof challenge generation and verification.
    No database required -- the HMAC signature ensures integrity.

    Example::

        from imrobot.server import ImRobotVerifier

        verifier = ImRobotVerifier(secret="your-secret-min-16-chars")
        challenge = verifier.generate()
        result = verifier.verify(challenge, agent_answer)
    """

    def __init__(
        self,
        secret: str,
        difficulty: Difficulty = "medium",
        ttl: Optional[int] = None,
        replay_guard: Optional[ChallengeReplayGuard] = None,
    ):
        if not secret or len(secret.strip()) < 16:
            raise ValueError(
                "ImRobotVerifier: secret must be at least 16 non-whitespace characters"
            )
        self._secret = secret
        self._difficulty = difficulty
        self._ttl = ttl
        self._replay_guard = replay_guard

    def _build_signature_message(
        self,
        challenge_id: str,
        verification: str,
        expires_at: int,
        difficulty: Difficulty,
        pipeline: Optional[list] = None,
    ) -> str:
        import json
        base = f"{challenge_id}:{verification}:{expires_at}:{difficulty}"
        if pipeline is not None:
            # Serialize pipeline dicts the same way JS does
            pipeline_dicts = []
            for op in pipeline:
                if hasattr(op, "to_dict"):
                    pipeline_dicts.append(op.to_dict() if callable(getattr(op, "to_dict", None)) else {"op": op.op})
                elif isinstance(op, dict):
                    pipeline_dicts.append(op)
                else:
                    # Convert dataclass to dict
                    d = {"op": op.op}
                    for attr in ["start", "end", "times", "search", "replacement",
                                 "length", "fill", "key", "char", "shift",
                                 "rounds", "bits"]:
                        if hasattr(op, attr) and attr != "op":
                            val = getattr(op, attr)
                            # Only include if it's a real attribute of this op type
                            if op.op == "pad_start" and attr == "length":
                                d[attr] = val
                            elif op.op != "pad_start" and attr in ("length", "fill"):
                                continue
                            elif attr == "key" and op.op not in ("xor_encode", "byte_xor"):
                                continue
                            else:
                                d[attr] = val
                    pipeline_dicts.append(d)
            return f"{base}:{json.dumps(pipeline_dicts, separators=(',', ':'))}"
        return base

    def generate(
        self,
        difficulty: Optional[Difficulty] = None,
        ttl: Optional[int] = None,
    ) -> SignedChallenge:
        """
        Generate a signed challenge.

        The challenge includes an HMAC signature that prevents tampering.
        Send the entire SignedChallenge to the client agent.
        """
        diff = difficulty or self._difficulty
        challenge = generate_challenge(difficulty=diff, ttl=ttl or self._ttl)
        expires_at = challenge.timestamp + challenge.ttl

        # Build pipeline as list of dicts for signature
        pipeline_dicts = []
        for op in challenge.pipeline:
            d = {"op": op.op}
            for attr in ["start", "end", "times", "search", "replacement",
                         "key", "char", "shift", "rounds", "bits"]:
                if hasattr(op, attr):
                    d[attr] = getattr(op, attr)
            if op.op == "pad_start":
                d["length"] = op.length  # type: ignore
                d["fill"] = op.fill  # type: ignore
            pipeline_dicts.append(d)

        message = self._build_signature_message(
            challenge.id,
            challenge.verification,
            expires_at,
            challenge.difficulty,
            challenge.pipeline,
        )
        signature = _hmac_sign(self._secret, message)

        return SignedChallenge(
            version=challenge.version,
            id=challenge.id,
            timestamp=challenge.timestamp,
            ttl=challenge.ttl,
            difficulty=challenge.difficulty,
            seed=challenge.seed,
            visible_seed=challenge.visible_seed,
            nonce=challenge.nonce,
            pipeline=challenge.pipeline,
            verification=challenge.verification,
            hmac=signature,
            expires_at=expires_at,
        )

    def verify(self, challenge: SignedChallenge, answer: str) -> VerifyResult:
        """
        Verify an agent's answer against a signed challenge.

        Checks in order:
        1. HMAC signature validity
        2. Expiration
        3. Answer correctness (verification hash)
        4. Pipeline re-execution
        5. Replay detection
        """
        # 1. Verify HMAC
        message = self._build_signature_message(
            challenge.id,
            challenge.verification,
            challenge.expires_at,
            challenge.difficulty,
            challenge.pipeline,
        )
        if not _hmac_verify(self._secret, message, challenge.hmac):
            return VerifyResult(valid=False, reason="invalid_hmac")

        # 2. Check expiration
        now = int(time.time() * 1000)
        if now > challenge.expires_at:
            return VerifyResult(valid=False, reason="expired")

        # 3. Verify answer hash
        expected_verification = fnv1a(answer + ":" + challenge.id)
        if expected_verification != challenge.verification:
            return VerifyResult(valid=False, reason="wrong_answer")

        # 4. Re-execute pipeline
        try:
            expected_answer = execute_pipeline(challenge.seed, challenge.pipeline)
        except Exception:
            return VerifyResult(valid=False, reason="tampered")

        if answer != expected_answer:
            return VerifyResult(valid=False, reason="tampered")

        # 5. Replay detection
        if self._replay_guard:
            if not self._replay_guard.mark_used(challenge.id):
                return VerifyResult(valid=False, reason="replay")

        elapsed = now - challenge.timestamp
        return VerifyResult(
            valid=True,
            elapsed=elapsed,
            suspicious=elapsed > SUSPICIOUS_THRESHOLD_MS,
        )


def create_verifier(
    secret: str,
    difficulty: Difficulty = "medium",
    ttl: Optional[int] = None,
    replay_guard: Optional[ChallengeReplayGuard] = None,
) -> ImRobotVerifier:
    """
    Create a server-side verifier instance.

    Args:
        secret: HMAC secret (minimum 16 characters).
        difficulty: Default difficulty level.
        ttl: Optional TTL override in milliseconds.
        replay_guard: Optional replay guard instance.

    Returns:
        An ImRobotVerifier instance.
    """
    return ImRobotVerifier(
        secret=secret,
        difficulty=difficulty,
        ttl=ttl,
        replay_guard=replay_guard,
    )
