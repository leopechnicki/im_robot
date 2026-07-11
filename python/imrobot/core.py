"""
Core challenge generation, solving, and verification.

Exact port of src/core/challenge.ts and src/core/solver.ts.
"""

from __future__ import annotations

import secrets
import time
from typing import List, Optional

from .hash import fnv1a
from .operations import execute_operation, execute_pipeline, format_operation, format_pipeline
from .types import (
    AtbashOp,
    Base64EncodeOp,
    BitRotateOp,
    ByteXorOp,
    CaesarOp,
    Challenge,
    CharCodeSumOp,
    ConsonantExtractOp,
    CountCharsOp,
    Difficulty,
    Fnv1aHashOp,
    HashChainOp,
    HexEncodeOp,
    ImRobotToken,
    LengthOp,
    NibbleSwapOp,
    Operation,
    PadStartOp,
    RepeatOp,
    ReplaceOp,
    ReverseOp,
    Rot13Op,
    RunLengthEncodeOp,
    Sha256HashOp,
    SliceAlternateOp,
    SortCharsOp,
    SubstringOp,
    ToLowerOp,
    ToUpperOp,
    VowelCountOp,
    XorEncodeOp,
    SUSPICIOUS_THRESHOLD_MS,
)


def _random_hex(length: int) -> str:
    """Generate a random hex string of the given length."""
    return secrets.token_hex(length // 2 + 1)[:length]


def _random_int(min_val: int, max_val: int) -> int:
    """Generate a cryptographically random integer in [min_val, max_val]."""
    return secrets.randbelow(max_val - min_val + 1) + min_val


def _pick_random(arr: list):
    """Pick a random element from a list."""
    return arr[_random_int(0, len(arr) - 1)]


def _get_default_ttl(difficulty: Difficulty) -> int:
    """Default TTL per difficulty in ms."""
    return {"easy": 30_000, "medium": 20_000, "hard": 15_000}[difficulty]


def _get_nonce_length(difficulty: Difficulty) -> int:
    """Nonce length per difficulty."""
    return {"easy": 4, "medium": 6, "hard": 8}[difficulty]


def _make_easy_ops(current_value: str) -> List:
    """Operation factories for easy difficulty."""
    return [
        lambda _: ReverseOp(),
        lambda _: ToUpperOp(),
        lambda _: ToLowerOp(),
        lambda _: SortCharsOp(),
        lambda _: LengthOp(),
        lambda _: SliceAlternateOp(),
        lambda _: VowelCountOp(),
        lambda _: AtbashOp(),
    ]


def _make_medium_ops(current_value: str) -> List:
    """Operation factories for medium difficulty."""
    easy = _make_easy_ops(current_value)
    return easy + [
        lambda _: Base64EncodeOp(),
        lambda _: Rot13Op(),
        lambda _: HexEncodeOp(),
        lambda _: CharCodeSumOp(),
        lambda val: (
            SubstringOp(
                start=_random_int(0, max(1, min(len(val), 16) // 3)),
                end=_random_int(
                    _random_int(0, max(1, min(len(val), 16) // 3)) + 4,
                    min(len(val), 16),
                ),
            )
            if min(len(val), 16) >= 5
            else ReverseOp()
        ),
        lambda _: ConsonantExtractOp(),
        lambda _: RunLengthEncodeOp(),
        lambda _: CaesarOp(shift=_random_int(1, 25)),
        lambda val: (
            CountCharsOp(char=_pick_random(list(set(val))))
            if len(set(val)) > 0
            else LengthOp()
        ),
    ]


def _make_hard_ops(current_value: str) -> List:
    """Operation factories for hard difficulty."""
    medium = _make_medium_ops(current_value)
    return medium + [
        lambda _: RepeatOp(times=_random_int(2, 3)),
        lambda val: (
            ReplaceOp(
                search=val[_random_int(0, len(val) - 1)],
                replacement=_random_hex(1),
            )
            if len(val) > 0
            else ReverseOp()
        ),
        lambda val: PadStartOp(
            length=max(len(val), 1) + _random_int(2, 6),
            fill=_random_hex(1),
        ),
        lambda _: XorEncodeOp(key=_random_int(1, 127)),
        lambda _: Fnv1aHashOp(),
        lambda _: Sha256HashOp(),
        lambda _: ByteXorOp(
            key=[_random_int(1, 255) for _ in range(_random_int(2, 8))]
        ),
        lambda _: HashChainOp(rounds=_random_int(2, 5)),
        lambda _: NibbleSwapOp(),
        lambda _: BitRotateOp(bits=_random_int(1, 7)),
    ]


def _build_pipeline(seed: str, difficulty: Difficulty) -> List[Operation]:
    """Build a random pipeline of operations."""
    count_map = {"easy": (2, 3), "medium": (3, 5), "hard": (5, 7)}
    min_count, max_count = count_map[difficulty]
    num_ops = _random_int(min_count, max_count)

    pipeline: List[Operation] = []
    current_value = seed

    for _ in range(num_ops):
        if difficulty == "easy":
            factories = _make_easy_ops(current_value)
        elif difficulty == "medium":
            factories = _make_medium_ops(current_value)
        else:
            factories = _make_hard_ops(current_value)

        factory = _pick_random(factories)
        op = factory(current_value)
        pipeline.append(op)
        current_value = execute_operation(current_value, op)

    return pipeline


def generate_challenge(
    difficulty: Difficulty = "medium",
    ttl: Optional[int] = None,
    _depth: int = 0,
) -> Challenge:
    """
    Generate a new challenge with a random seed and pipeline.

    Args:
        difficulty: Challenge difficulty level.
        ttl: Optional TTL override in milliseconds.
        _depth: Internal recursion depth (do not set manually).

    Returns:
        A Challenge object ready for solving.

    Raises:
        RuntimeError: If unable to generate a valid challenge after 10 retries.
    """
    if _depth > 10:
        raise RuntimeError("Failed to generate valid challenge after 10 retries")

    if ttl is None:
        ttl = _get_default_ttl(difficulty)

    visible_seed = _random_hex(16)
    nonce = _random_hex(_get_nonce_length(difficulty))
    seed = visible_seed + nonce

    pipeline = _build_pipeline(seed, difficulty)

    try:
        answer = execute_pipeline(seed, pipeline)
    except Exception:
        return generate_challenge(difficulty, ttl, _depth + 1)

    if not answer or len(answer) == 0 or len(answer) > 10_000:
        return generate_challenge(difficulty, ttl, _depth + 1)

    challenge_id = _random_hex(16)
    verification = fnv1a(answer + ":" + challenge_id)

    return Challenge(
        version=1,
        id=challenge_id,
        timestamp=int(time.time() * 1000),
        ttl=ttl,
        difficulty=difficulty,
        seed=seed,
        visible_seed=visible_seed,
        nonce=nonce,
        pipeline=pipeline,
        verification=verification,
    )


def solve_challenge(challenge: Challenge) -> str:
    """
    Solve a challenge by executing its pipeline.

    This is the reference solver -- AI agents use this to compute
    the correct answer.

    Args:
        challenge: The challenge to solve.

    Returns:
        The correct answer string.
    """
    return execute_pipeline(challenge.seed, challenge.pipeline)


def verify_answer(challenge: Challenge, answer: str) -> bool:
    """
    Client-side answer verification using FNV-1a hash.

    Security note: FNV-1a is a fast, non-cryptographic 32-bit hash.
    This function is intended only for client-side UX feedback.
    All security-critical verification should go through server-side
    HMAC-SHA256 verification.

    Args:
        challenge: The challenge that was solved.
        answer: The answer to verify.

    Returns:
        True if the answer is correct and the challenge has not expired.
    """
    now_ms = int(time.time() * 1000)
    if now_ms - challenge.timestamp > challenge.ttl:
        return False
    return fnv1a(answer + ":" + challenge.id) == challenge.verification
