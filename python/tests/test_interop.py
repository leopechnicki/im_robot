"""Interoperability tests — Python <-> JS byte-identical output.

These fixture challenges were produced by the JS SDK reference implementation
(``src/core/hash.ts``, ``src/core/operations.ts``, ``src/server/verifier.ts``).
They ensure the Python port produces the same outputs — otherwise agents
cannot solve JS-issued challenges and vice-versa.
"""

from __future__ import annotations

from imrobot import execute_operation, execute_pipeline, fnv1a, hmac_sign, solve_challenge

# ---------------------------------------------------------------------------
# FNV-1a fixtures — verified against JS `fnv1a()` output
# ---------------------------------------------------------------------------


def test_fnv1a_hello():
    # JS: fnv1a("hello") = "4f9f2cab"
    assert fnv1a("hello") == "4f9f2cab"


def test_fnv1a_a():
    # JS: fnv1a("a") = "e40c292c"
    assert fnv1a("a") == "e40c292c"


def test_fnv1a_test_string():
    # JS: fnv1a("test") = "afd071e5"
    assert fnv1a("test") == "afd071e5"


def test_fnv1a_number_string():
    # JS: fnv1a("12345") = "43c2c0d8"
    assert fnv1a("12345") == "43c2c0d8"


def test_fnv1a_empty_string():
    # JS: fnv1a("") = "811c9dc5" (initial FNV basis, unchanged)
    assert fnv1a("") == "811c9dc5"


# ---------------------------------------------------------------------------
# HMAC fixtures — verified against JS `hmacSign()` (Web Crypto HMAC-SHA256)
# ---------------------------------------------------------------------------


def test_hmac_sign_hello():
    # JS: hmacSign("test-secret-at-least-sixteen-chars-ok", "hello")
    secret = "test-secret-at-least-sixteen-chars-ok"
    sig = hmac_sign(secret, "hello")
    # 64-char hex, deterministic
    assert len(sig) == 64
    # HMAC-SHA256 output is standard — this is the known value for these inputs
    assert sig == "9773aa90ab9319f4301bb2575bfc95ca770bbaa16af9a3ecf473d6c68fd7099e"


# ---------------------------------------------------------------------------
# Pipeline fixture — JS-computed answer for a specific pipeline
# ---------------------------------------------------------------------------


def test_pipeline_matches_js():
    # Fixture: seed "hello world"
    # pipeline: [reverse, to_upper, hex_encode]
    seed = "hello world"
    pipeline = [
        {"op": "reverse"},
        {"op": "to_upper"},
        {"op": "hex_encode"},
    ]
    # JS: reverse -> "dlrow olleh" -> upper -> "DLROW OLLEH"
    # -> hex_encode -> "444c524f57204f4c4c4548"
    assert execute_pipeline(seed, pipeline) == "444c524f57204f4c4c4548"


def test_solve_challenge_end_to_end():
    """Simulate solving a JS-issued challenge dict."""
    challenge = {
        "version": 1,
        "id": "test_challenge_id",
        "timestamp": 1_700_000_000_000,
        "ttl": 30_000,
        "difficulty": "easy",
        "seed": "abcdef",
        "visibleSeed": "abcdef",
        "nonce": "",
        "pipeline": [{"op": "reverse"}, {"op": "to_upper"}],
        "verification": "unused-in-solver",
    }
    assert solve_challenge(challenge) == "FEDCBA"


# ---------------------------------------------------------------------------
# Deprecated sha256_hash alias must produce fnv1a_cascade output
# ---------------------------------------------------------------------------


def test_sha256_hash_alias_matches_fnv1a_cascade():
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # skip the DeprecationWarning noise
        # Reset the module-level flag
        from imrobot import core

        core._sha256_hash_deprecation_warned = False
        result_a = execute_operation("hello", {"op": "sha256_hash"})
    result_b = execute_operation("hello", {"op": "fnv1a_cascade"})
    assert result_a == result_b
    assert len(result_a) == 64
