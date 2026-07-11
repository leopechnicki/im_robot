"""
Core operations, hashing, and solver — mirrors ``src/core/`` from the JS SDK.

All operations produce byte-identical output to the reference JS implementation,
so a Python-agent-side solver interoperates 1:1 with a JS-server-side verifier
and vice-versa. This is what makes ``imrobot`` a genuine cross-runtime protocol
instead of a JS-only library.
"""

from __future__ import annotations

import base64
import warnings
from typing import Any, Literal, TypedDict, Union

# ---------------------------------------------------------------------------
# Types — Operation is a discriminated union keyed by "op"
# ---------------------------------------------------------------------------

Difficulty = Literal["easy", "medium", "hard"]
SUPPORTED_DIFFICULTIES: tuple[Difficulty, ...] = ("easy", "medium", "hard")
SUSPICIOUS_THRESHOLD_MS = 5_000

# Operation payloads. We use dict-based typing (matching the JSON wire format)
# rather than dataclasses so that JSON round-trips are lossless and no
# custom (de)serializer is needed.
Operation = dict[str, Any]


class Challenge(TypedDict):
    """A single reverse-CAPTCHA challenge (unsigned)."""

    version: int
    id: str
    timestamp: int
    ttl: int
    difficulty: Difficulty
    seed: str
    visibleSeed: str
    nonce: str
    pipeline: list[Operation]
    verification: str


class SignedChallenge(Challenge):
    """A challenge with server HMAC + absolute expiration timestamp."""

    hmac: str
    expiresAt: int


# ---------------------------------------------------------------------------
# FNV-1a — matches JS implementation bit for bit
# ---------------------------------------------------------------------------


def fnv1a(text: str) -> str:
    """FNV-1a 32-bit hash — deterministic 8-char lowercase hex.

    Matches the JS reference in ``src/core/hash.ts`` byte for byte.
    """
    h = 0x811C9DC5
    for ch in text:
        h ^= ord(ch)
        # Math.imul equivalent: multiply mod 2^32, keep low 32 bits, treat as signed-ish
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def _sync_hash256(input_str: str) -> str:
    """8 rounds of FNV-1a into 64 hex chars — matches JS ``syncHash256``."""
    parts = []
    for i in range(8):
        parts.append(fnv1a(f"{input_str}:{i}"))
    return "".join(parts)


_sha256_hash_deprecation_warned = False


# ---------------------------------------------------------------------------
# Operation execution — 1:1 port of JS ``executeOperation``
# ---------------------------------------------------------------------------


def _to_u8(code: int) -> int:
    return code & 0xFF


def _to_u16_char(code: int) -> str:
    # Mirror JS String.fromCharCode which uses 16-bit code units
    return chr(code & 0xFFFF)


def execute_operation(input_str: str, op: Operation) -> str:  # noqa: C901, PLR0911, PLR0912, PLR0915
    """Execute a single operation on the input string.

    Every branch matches the JS reference in ``src/core/operations.ts`` exactly,
    including edge cases like ``btoa`` Latin-1 semantics for ``base64_encode``.
    """
    kind = op["op"]

    if kind == "reverse":
        return input_str[::-1]

    if kind == "base64_encode":
        # JS uses TextEncoder → utf-8 bytes → btoa(binary).
        # base64 of utf-8 bytes gives the same result.
        return base64.b64encode(input_str.encode("utf-8")).decode("ascii")

    if kind == "to_upper":
        return input_str.upper()

    if kind == "to_lower":
        return input_str.lower()

    if kind == "rot13":
        out = []
        for c in input_str:
            code = ord(c)
            if 0x41 <= code <= 0x5A:
                out.append(chr((code - 0x41 + 13) % 26 + 0x41))
            elif 0x61 <= code <= 0x7A:
                out.append(chr((code - 0x61 + 13) % 26 + 0x61))
            else:
                out.append(c)
        return "".join(out)

    if kind == "hex_encode":
        return "".join(f"{ord(c):02x}" for c in input_str)

    if kind == "sort_chars":
        return "".join(sorted(input_str))

    if kind == "char_code_sum":
        return str(sum(ord(c) for c in input_str))

    if kind == "substring":
        # JS substring clamps to [0, len] and swaps args if start > end
        start = op["start"]
        end = op["end"]
        length = len(input_str)
        s = max(0, min(int(start), length))
        e = max(0, min(int(end), length))
        if s > e:
            s, e = e, s
        return input_str[s:e]

    if kind == "repeat":
        times = int(op["times"])
        if times < 0:
            raise ValueError("repeat: times must be non-negative")
        return input_str * times

    if kind == "replace":
        return input_str.replace(op["search"], op["replacement"])

    if kind == "pad_start":
        length = int(op["length"])
        fill = op["fill"]
        if length <= len(input_str) or not fill:
            return input_str
        needed = length - len(input_str)
        # Match JS String.prototype.padStart: repeat fill and truncate to needed
        rep = (fill * ((needed // len(fill)) + 1))[:needed]
        return rep + input_str

    if kind == "xor_encode":
        key = int(op["key"])
        return "".join(_to_u16_char(ord(c) ^ key) for c in input_str)

    if kind == "count_chars":
        return str(input_str.count(op["char"]))

    if kind == "caesar":
        shift = int(op["shift"])
        out = []
        for c in input_str:
            code = ord(c)
            if 0x41 <= code <= 0x5A:
                out.append(chr(((code - 0x41 + shift) % 26 + 26) % 26 + 0x41))
            elif 0x61 <= code <= 0x7A:
                out.append(chr(((code - 0x61 + shift) % 26 + 26) % 26 + 0x61))
            else:
                out.append(c)
        return "".join(out)

    if kind == "slice_alternate":
        return input_str[::2]

    if kind == "fnv1a_hash":
        return fnv1a(input_str)

    if kind == "length":
        return str(len(input_str))

    if kind == "sha256_hash":
        global _sha256_hash_deprecation_warned
        if not _sha256_hash_deprecation_warned:
            _sha256_hash_deprecation_warned = True
            warnings.warn(
                "[im_robot] The { 'op': 'sha256_hash' } operation is deprecated and will be "
                "removed in a future major version. Use { 'op': 'hash_chain', 'rounds': 1 } "
                "for single-pass FNV-1a hashing, or { 'op': 'fnv1a_hash' } for a fast "
                "non-cryptographic hash. See https://github.com/leopechnicki/im_robot for "
                "migration details.",
                DeprecationWarning,
                stacklevel=2,
            )
        return _sync_hash256(input_str)

    if kind == "fnv1a_cascade":
        return _sync_hash256(input_str)

    if kind == "byte_xor":
        key_arr = op["key"]
        if not key_arr:
            raise ValueError("byte_xor: key must not be empty")
        return "".join(
            _to_u16_char(ord(c) ^ int(key_arr[i % len(key_arr)]))
            for i, c in enumerate(input_str)
        )

    if kind == "hash_chain":
        rounds = int(op["rounds"])
        if rounds < 1:
            raise ValueError("hash_chain: rounds must be at least 1")
        val = input_str
        for r in range(rounds):
            val = fnv1a(f"{val}:{r}")
        return val

    if kind == "nibble_swap":
        out = []
        for c in input_str:
            code = ord(c)
            swapped = ((code & 0x0F) << 4) | ((code & 0xF0) >> 4)
            out.append(_to_u16_char(swapped))
        return "".join(out)

    if kind == "bit_rotate":
        shift = ((int(op["bits"]) % 8) + 8) % 8
        out = []
        for c in input_str:
            code = _to_u8(ord(c))
            rotated = ((code << shift) | (code >> (8 - shift))) & 0xFF
            out.append(_to_u16_char(rotated))
        return "".join(out)

    if kind == "vowel_count":
        vowels = set("aeiouAEIOU")
        return str(sum(1 for c in input_str if c in vowels))

    if kind == "consonant_extract":
        vowels = set("aeiouAEIOU")
        return "".join(
            c for c in input_str if c.isascii() and c.isalpha() and c not in vowels
        )

    if kind == "run_length_encode":
        if not input_str:
            return ""
        result = []
        count = 1
        for i in range(1, len(input_str) + 1):
            if i < len(input_str) and input_str[i] == input_str[i - 1]:
                count += 1
            else:
                result.append(f"{count}{input_str[i - 1]}" if count > 1 else input_str[i - 1])
                count = 1
        return "".join(result)

    if kind == "atbash":
        out = []
        for c in input_str:
            code = ord(c)
            if 0x41 <= code <= 0x5A:
                out.append(chr(0x41 + (25 - (code - 0x41))))
            elif 0x61 <= code <= 0x7A:
                out.append(chr(0x61 + (25 - (code - 0x61))))
            else:
                out.append(c)
        return "".join(out)

    raise ValueError(f"Unknown operation: {kind}")


def execute_pipeline(seed: str, pipeline: list[Operation]) -> str:
    """Execute the full pipeline: seed -> op1 -> op2 -> ... -> answer."""
    value = seed
    for op in pipeline:
        value = execute_operation(value, op)
    return value


# ---------------------------------------------------------------------------
# Solver — the canonical entry point for AI agents
# ---------------------------------------------------------------------------


def solve_challenge(challenge: Union[Challenge, SignedChallenge, dict[str, Any]]) -> str:
    """Solve a signed or unsigned challenge.

    ``challenge`` may be a dict fetched from ``GET /imrobot/challenge`` verbatim.
    Returns the answer string to POST back to ``/imrobot/verify``.
    """
    return execute_pipeline(challenge["seed"], challenge["pipeline"])


# ---------------------------------------------------------------------------
# Format helpers — mirror JS ``formatOperation``/``formatPipeline`` for debug
# ---------------------------------------------------------------------------


def format_operation(op: Operation) -> str:
    """Return a short debug string for a single operation."""
    kind = op["op"]
    if kind in {
        "reverse", "base64_encode", "to_upper", "to_lower", "rot13", "hex_encode",
        "sort_chars", "char_code_sum", "slice_alternate", "fnv1a_hash", "length",
        "nibble_swap", "vowel_count", "consonant_extract", "run_length_encode",
        "atbash", "fnv1a_cascade",
    }:
        return f"{kind}()"
    if kind == "substring":
        return f"substring({op['start']}, {op['end']})"
    if kind == "repeat":
        return f"repeat({op['times']})"
    if kind == "replace":
        return f"replace(\"{op['search']}\", \"{op['replacement']}\")"
    if kind == "pad_start":
        return f"pad_start({op['length']}, \"{op['fill']}\")"
    if kind == "xor_encode":
        return f"xor_encode({op['key']})"
    if kind == "count_chars":
        return f"count_chars(\"{op['char']}\")"
    if kind == "caesar":
        return f"caesar({op['shift']})"
    if kind == "sha256_hash":
        return "fnv1a_cascade() /* was: sha256_hash — deprecated alias */"
    if kind == "byte_xor":
        return f"byte_xor([{','.join(str(x) for x in op['key'])}])"
    if kind == "hash_chain":
        return f"hash_chain({op['rounds']})"
    if kind == "bit_rotate":
        return f"bit_rotate({op['bits']})"
    return f"{kind}(?)"


def format_pipeline(seed: str, pipeline: list[Operation]) -> str:
    """Return a multi-line, human-readable representation of the pipeline."""
    lines = [f'seed: "{seed}"']
    for i, op in enumerate(pipeline, start=1):
        lines.append(f"  {i}. {format_operation(op)}")
    return "\n".join(lines)
