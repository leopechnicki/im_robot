"""
Server-side verifier, HMAC utilities, replay guard, and proof-token issuer.

Mirrors ``src/server/`` from the JS SDK and produces byte-identical wire output
(HMAC hex, JWTs, base64url encoding) so a Python server can verify challenges
issued by the JS SDK, and vice-versa.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any, Literal, Optional, TypedDict, Union

from .core import (
    SUPPORTED_DIFFICULTIES,
    SUSPICIOUS_THRESHOLD_MS,
    Challenge,
    Difficulty,
    Operation,
    SignedChallenge,
    execute_pipeline,
    fnv1a,
)

# ---------------------------------------------------------------------------
# HMAC / SHA-256 primitives
# ---------------------------------------------------------------------------


def hmac_sign(secret: str, message: str) -> str:
    """HMAC-SHA256, 64-char lowercase hex — matches JS ``hmacSign``."""
    mac = hmac.new(secret.encode("utf-8"), message.encode("utf-8"), hashlib.sha256)
    return mac.hexdigest()


def hmac_verify(secret: str, message: str, signature: str) -> bool:
    """Constant-time HMAC verification — matches JS ``hmacVerify``."""
    expected = hmac_sign(secret, message)
    return hmac.compare_digest(expected, signature)


def sha256_hex(message: str) -> str:
    """SHA-256 hex digest of a UTF-8 string."""
    return hashlib.sha256(message.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Challenge generator (server side)
# ---------------------------------------------------------------------------

_HEX_CHARS = "0123456789abcdef"


def _random_hex(length: int) -> str:
    return "".join(_HEX_CHARS[b % 16] for b in os.urandom(length))


def _random_int(low: int, high: int) -> int:
    """Inclusive [low, high]."""
    return secrets.randbelow(high - low + 1) + low


def _pick(arr: list[Any]) -> Any:
    return arr[_random_int(0, len(arr) - 1)]


def _default_ttl_ms(difficulty: Difficulty) -> int:
    return {"easy": 30_000, "medium": 20_000, "hard": 15_000}[difficulty]


def _nonce_length(difficulty: Difficulty) -> int:
    return {"easy": 4, "medium": 6, "hard": 8}[difficulty]


# Op factories mirror the JS ``challenge.ts`` list one-to-one.
def _easy_factories() -> list[Any]:
    return [
        lambda _val: {"op": "reverse"},
        lambda _val: {"op": "to_upper"},
        lambda _val: {"op": "to_lower"},
        lambda _val: {"op": "sort_chars"},
        lambda _val: {"op": "length"},
        lambda _val: {"op": "slice_alternate"},
        lambda _val: {"op": "vowel_count"},
        lambda _val: {"op": "atbash"},
    ]


def _medium_factories() -> list[Any]:
    def _substring(val: str) -> Operation:
        max_end = min(len(val), 16)
        if max_end < 5:
            return {"op": "reverse"}
        start = _random_int(0, max_end // 3)
        end = _random_int(start + 4, max_end)
        return {"op": "substring", "start": start, "end": end}

    def _count_chars(val: str) -> Operation:
        chars = list(dict.fromkeys(val))  # unique, preserve order
        if not chars:
            return {"op": "length"}
        return {"op": "count_chars", "char": _pick(chars)}

    return [
        *_easy_factories(),
        lambda _val: {"op": "base64_encode"},
        lambda _val: {"op": "rot13"},
        lambda _val: {"op": "hex_encode"},
        lambda _val: {"op": "char_code_sum"},
        _substring,
        lambda _val: {"op": "consonant_extract"},
        lambda _val: {"op": "run_length_encode"},
        lambda _val: {"op": "caesar", "shift": _random_int(1, 25)},
        _count_chars,
    ]


def _hard_factories() -> list[Any]:
    def _replace(val: str) -> Operation:
        if not val:
            return {"op": "reverse"}
        idx = _random_int(0, len(val) - 1)
        return {"op": "replace", "search": val[idx], "replacement": _random_hex(1)}

    def _pad_start(val: str) -> Operation:
        return {"op": "pad_start", "length": max(len(val), 1) + _random_int(2, 6), "fill": _random_hex(1)}

    def _byte_xor(_val: str) -> Operation:
        key_len = _random_int(2, 8)
        return {"op": "byte_xor", "key": [_random_int(1, 255) for _ in range(key_len)]}

    return [
        *_medium_factories(),
        lambda _val: {"op": "repeat", "times": _random_int(2, 3)},
        _replace,
        _pad_start,
        lambda _val: {"op": "xor_encode", "key": _random_int(1, 127)},
        lambda _val: {"op": "fnv1a_hash"},
        lambda _val: {"op": "hash_chain", "rounds": _random_int(2, 5)},
        _byte_xor,
        lambda _val: {"op": "nibble_swap"},
        lambda _val: {"op": "bit_rotate", "bits": _random_int(1, 7)},
    ]


def _factories_for(difficulty: Difficulty) -> tuple[list[Any], tuple[int, int]]:
    if difficulty == "easy":
        return _easy_factories(), (2, 3)
    if difficulty == "medium":
        return _medium_factories(), (3, 5)
    return _hard_factories(), (5, 7)


def _build_pipeline(seed: str, difficulty: Difficulty) -> list[Operation]:
    factories, (lo, hi) = _factories_for(difficulty)
    num_ops = _random_int(lo, hi)
    pipeline: list[Operation] = []
    current = seed
    for _ in range(num_ops):
        factory = _pick(factories)
        op = factory(current)
        pipeline.append(op)
        current = execute_pipeline(current, [op])
    return pipeline


def _now_ms() -> int:
    return int(time.time() * 1000)


def _generate_challenge(difficulty: Difficulty, ttl: Optional[int], _depth: int = 0) -> Challenge:
    if _depth > 10:
        raise RuntimeError("Failed to generate valid challenge")
    ttl_ms = ttl if ttl is not None else _default_ttl_ms(difficulty)
    visible_seed = _random_hex(16)
    nonce = _random_hex(_nonce_length(difficulty))
    seed = visible_seed + nonce
    pipeline = _build_pipeline(seed, difficulty)
    try:
        answer = execute_pipeline(seed, pipeline)
    except Exception:
        return _generate_challenge(difficulty, ttl, _depth + 1)
    if not answer or len(answer) == 0 or len(answer) > 10_000:
        return _generate_challenge(difficulty, ttl, _depth + 1)
    challenge_id = _random_hex(16)
    verification = fnv1a(f"{answer}:{challenge_id}")
    return {
        "version": 1,
        "id": challenge_id,
        "timestamp": _now_ms(),
        "ttl": ttl_ms,
        "difficulty": difficulty,
        "seed": seed,
        "visibleSeed": visible_seed,
        "nonce": nonce,
        "pipeline": pipeline,
        "verification": verification,
    }


# ---------------------------------------------------------------------------
# Replay guard
# ---------------------------------------------------------------------------


class ChallengeReplayGuard:
    """Interface for tracking used challenge IDs.

    Subclass or provide a duck-typed object with ``mark_used(challenge_id) -> bool``.
    Return ``True`` if the challenge was previously unused (accept), ``False`` if
    it's been seen before (reject as replay).
    """

    def mark_used(self, challenge_id: str) -> bool:  # pragma: no cover - interface
        raise NotImplementedError


class InMemoryReplayGuard(ChallengeReplayGuard):
    """Bounded in-memory replay guard (LRU-ish via insertion order).

    NOT safe for multi-process deployments — use Redis-backed guard for prod.
    """

    def __init__(self, capacity: int = 10_000) -> None:
        self._capacity = capacity
        self._seen: dict[str, int] = {}

    def mark_used(self, challenge_id: str) -> bool:
        if challenge_id in self._seen:
            return False
        self._seen[challenge_id] = _now_ms()
        if len(self._seen) > self._capacity:
            # drop oldest
            oldest_key = next(iter(self._seen))
            del self._seen[oldest_key]
        return True


# ---------------------------------------------------------------------------
# VerifyResult
# ---------------------------------------------------------------------------


class VerifyResult(TypedDict, total=False):
    valid: bool
    reason: Literal["expired", "invalid_hmac", "wrong_answer", "tampered", "replay"]
    elapsed: int
    suspicious: bool


# ---------------------------------------------------------------------------
# Verifier
# ---------------------------------------------------------------------------

# Match JS JSON.stringify: no spaces, no non-ASCII escaping quirks. Use compact
# separators so the same message string is produced across runtimes.
_JSON_COMPACT_SEPARATORS = (",", ":")


def _canonical_pipeline_json(pipeline: list[Operation]) -> str:
    return json.dumps(pipeline, separators=_JSON_COMPACT_SEPARATORS, ensure_ascii=False)


class ImRobotVerifier:
    """Server-side verifier — mirrors the JS ``ImRobotVerifier`` class.

    Stateless: HMAC signature ensures integrity, no DB required.
    """

    def __init__(
        self,
        secret: str,
        *,
        difficulty: Difficulty = "medium",
        ttl: Optional[int] = None,
        replay_guard: Optional[ChallengeReplayGuard] = None,
    ) -> None:
        if not secret or len(secret.strip()) < 16:
            raise ValueError("ImRobotVerifier: secret must be at least 16 non-whitespace characters")
        if difficulty not in SUPPORTED_DIFFICULTIES:
            raise ValueError(f"ImRobotVerifier: difficulty must be one of {SUPPORTED_DIFFICULTIES}")
        self._secret = secret
        self._difficulty: Difficulty = difficulty
        self._ttl = ttl
        self._replay_guard = replay_guard

    def _build_signature_message(
        self,
        challenge_id: str,
        verification: str,
        expires_at: int,
        difficulty: Difficulty,
        pipeline: Optional[list[Operation]] = None,
    ) -> str:
        base = f"{challenge_id}:{verification}:{expires_at}:{difficulty}"
        if pipeline is None:
            return base
        return f"{base}:{_canonical_pipeline_json(pipeline)}"

    async def generate(
        self,
        *,
        difficulty: Optional[Difficulty] = None,
        ttl: Optional[int] = None,
    ) -> SignedChallenge:
        chosen_difficulty = difficulty or self._difficulty
        chosen_ttl = ttl if ttl is not None else self._ttl
        challenge = _generate_challenge(chosen_difficulty, chosen_ttl)
        expires_at = challenge["timestamp"] + challenge["ttl"]
        message = self._build_signature_message(
            challenge["id"],
            challenge["verification"],
            expires_at,
            challenge["difficulty"],
            challenge["pipeline"],
        )
        hmac_hex = hmac_sign(self._secret, message)
        signed: SignedChallenge = {
            **challenge,  # type: ignore[misc]
            "hmac": hmac_hex,
            "expiresAt": expires_at,
        }
        return signed

    async def verify(self, challenge: SignedChallenge, answer: str) -> VerifyResult:
        # 1. HMAC — challenge not tampered
        message = self._build_signature_message(
            challenge["id"],
            challenge["verification"],
            challenge["expiresAt"],
            challenge["difficulty"],
            challenge["pipeline"],
        )
        if not hmac_verify(self._secret, message, challenge["hmac"]):
            return {"valid": False, "reason": "invalid_hmac"}

        # 2. Expiration
        now = _now_ms()
        if now > challenge["expiresAt"]:
            return {"valid": False, "reason": "expired"}

        # 3. Fast verification hash (HMAC-protected)
        expected_verification = fnv1a(f"{answer}:{challenge['id']}")
        if expected_verification != challenge["verification"]:
            return {"valid": False, "reason": "wrong_answer"}

        # 4. Re-execute pipeline
        try:
            expected_answer = execute_pipeline(challenge["seed"], challenge["pipeline"])
        except Exception:
            return {"valid": False, "reason": "tampered"}
        if answer != expected_answer:
            return {"valid": False, "reason": "tampered"}

        # 5. Replay
        if self._replay_guard is not None:
            allowed = self._replay_guard.mark_used(challenge["id"])
            if not allowed:
                return {"valid": False, "reason": "replay"}

        elapsed = now - challenge["timestamp"]
        return {
            "valid": True,
            "elapsed": elapsed,
            "suspicious": elapsed > SUSPICIOUS_THRESHOLD_MS,
        }


# ---------------------------------------------------------------------------
# Proof token (RFC 7519 JWT, HS256) — matches JS ``ProofTokenIssuer``
# ---------------------------------------------------------------------------


def _b64url_encode(data: Union[str, bytes]) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode_str(data: str) -> str:
    pad = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode((data + pad).encode("ascii")).decode("utf-8")


def _b64url_decode_bytes(data: str) -> bytes:
    pad = "=" * ((4 - len(data) % 4) % 4)
    return base64.urlsafe_b64decode((data + pad).encode("ascii"))


class AgentProofToken(TypedDict, total=False):
    iss: str
    sub: str
    aud: Optional[str]
    iat: int
    nbf: int
    exp: int
    jti: str
    imr: dict[str, Any]


class ProofTokenVerifyResult(TypedDict, total=False):
    valid: bool
    payload: AgentProofToken
    keyId: str
    reason: Literal[
        "malformed",
        "invalid_signature",
        "expired",
        "not_yet_valid",
        "invalid_issuer",
        "unsupported_alg",
        "unknown_key",
    ]


MAX_CLOCK_SKEW_SEC = 300


@dataclass
class _PreviousSecret:
    key_id: str
    secret: str


class ProofTokenIssuer:
    """Issue and verify RFC 7519 JWTs (HS256) — cross-compatible with the JS SDK."""

    def __init__(
        self,
        secret: str,
        *,
        key_id: Optional[str] = None,
        previous_secrets: Optional[list[dict[str, str]]] = None,
        issuer: str = "imrobot",
        token_ttl_ms: int = 3_600_000,
        clock_skew_sec: int = 5,
    ) -> None:
        if not secret or len(secret.strip()) < 16:
            raise ValueError("ProofTokenIssuer: secret must be at least 16 non-whitespace characters")
        self._secret = secret
        self._key_id = key_id
        self._issuer = issuer
        self._token_ttl_ms = token_ttl_ms
        self._clock_skew_sec = max(0, min(MAX_CLOCK_SKEW_SEC, clock_skew_sec))
        self._secrets: dict[str, str] = {}
        if key_id:
            self._secrets[key_id] = secret
        for prev in previous_secrets or []:
            prev_secret = prev.get("secret") or ""
            prev_kid = prev.get("keyId") or prev.get("key_id") or ""
            if not prev_secret or len(prev_secret.strip()) < 16:
                raise ValueError(
                    f"ProofTokenIssuer: previous_secrets[{prev_kid}] must be at least 16 chars"
                )
            self._secrets[prev_kid] = prev_secret

    async def issue(
        self,
        *,
        agent_id: str,
        challenge_id: str,
        difficulty: Difficulty,
        solve_time_ms: int,
        suspicious: bool,
        audience: Optional[str] = None,
        turnstile_verified: Optional[bool] = None,
        web_bot_auth_verified: Optional[bool] = None,
    ) -> str:
        now_ms = _now_ms()
        now_sec = now_ms // 1000
        exp_sec = (now_ms + self._token_ttl_ms) // 1000
        jti = f"imr_{fnv1a(f'{challenge_id}:{now_ms}:{agent_id}')}"

        header: dict[str, str] = {"alg": "HS256", "typ": "JWT"}
        if self._key_id:
            header["kid"] = self._key_id

        imr: dict[str, Any] = {
            "challenge_id": challenge_id,
            "difficulty": difficulty,
            "solve_time_ms": solve_time_ms,
            "suspicious": suspicious,
            "version": 2,
        }
        if turnstile_verified is not None:
            imr["turnstile_verified"] = turnstile_verified
        if web_bot_auth_verified is not None:
            imr["web_bot_auth_verified"] = web_bot_auth_verified

        payload: dict[str, Any] = {
            "iss": self._issuer,
            "sub": agent_id,
            "iat": now_sec,
            "nbf": now_sec,
            "exp": exp_sec,
            "jti": jti,
            "imr": imr,
        }
        if audience is not None:
            payload["aud"] = audience

        header_b64 = _b64url_encode(json.dumps(header, separators=_JSON_COMPACT_SEPARATORS))
        payload_b64 = _b64url_encode(json.dumps(payload, separators=_JSON_COMPACT_SEPARATORS))
        signing_input = f"{header_b64}.{payload_b64}"

        # JS signs the hex string of the HMAC (not the raw bytes). We match that
        # exactly so tokens issued by either SDK verify on both sides.
        signature_hex = hmac_sign(self._secret, signing_input)
        signature_b64 = _b64url_encode(signature_hex)

        return f"{signing_input}.{signature_b64}"

    async def verify(self, token: str) -> ProofTokenVerifyResult:
        parts = token.split(".")
        if len(parts) != 3:
            return {"valid": False, "reason": "malformed"}
        header_b64, payload_b64, signature_b64 = parts

        try:
            header = json.loads(_b64url_decode_str(header_b64))
        except Exception:
            return {"valid": False, "reason": "malformed"}

        if header.get("alg") != "HS256":
            return {"valid": False, "reason": "unsupported_alg"}

        candidate_secret = self._secret
        kid = header.get("kid")
        if kid:
            mapped = self._secrets.get(kid)
            if not mapped:
                return {"valid": False, "reason": "unknown_key", "keyId": kid}
            candidate_secret = mapped

        signing_input = f"{header_b64}.{payload_b64}"
        try:
            signature_hex = _b64url_decode_str(signature_b64)
        except Exception:
            return {"valid": False, "reason": "malformed"}

        if not hmac_verify(candidate_secret, signing_input, signature_hex):
            return {"valid": False, "reason": "invalid_signature", "keyId": kid}

        try:
            payload: AgentProofToken = json.loads(_b64url_decode_str(payload_b64))
        except Exception:
            return {"valid": False, "reason": "malformed"}

        now_sec = int(time.time())
        exp = payload.get("exp")
        if not isinstance(exp, int) or now_sec > exp + self._clock_skew_sec:
            return {"valid": False, "reason": "expired", "keyId": kid}
        nbf = payload.get("nbf")
        if isinstance(nbf, int) and now_sec + self._clock_skew_sec < nbf:
            return {"valid": False, "reason": "not_yet_valid", "keyId": kid}
        if payload.get("iss") != self._issuer:
            return {"valid": False, "reason": "invalid_issuer", "keyId": kid}

        return {"valid": True, "payload": payload, "keyId": kid}

    @staticmethod
    def decode_unsafe(token: str) -> Optional[AgentProofToken]:
        """Decode without verifying. For debugging only."""
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None
            return json.loads(_b64url_decode_str(parts[1]))
        except Exception:
            return None


def create_verifier(
    secret: str,
    *,
    difficulty: Difficulty = "medium",
    ttl: Optional[int] = None,
    replay_guard: Optional[ChallengeReplayGuard] = None,
) -> ImRobotVerifier:
    """Convenience wrapper matching the JS ``createVerifier`` factory."""
    return ImRobotVerifier(secret, difficulty=difficulty, ttl=ttl, replay_guard=replay_guard)


def create_token_issuer(
    secret: str,
    *,
    key_id: Optional[str] = None,
    previous_secrets: Optional[list[dict[str, str]]] = None,
    issuer: str = "imrobot",
    token_ttl_ms: int = 3_600_000,
    clock_skew_sec: int = 5,
) -> ProofTokenIssuer:
    return ProofTokenIssuer(
        secret,
        key_id=key_id,
        previous_secrets=previous_secrets,
        issuer=issuer,
        token_ttl_ms=token_ttl_ms,
        clock_skew_sec=clock_skew_sec,
    )
