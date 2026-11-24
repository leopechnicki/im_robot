"""imrobot 0.9 hardening: sha256 op, timing gate, HMAC v2, constant-time compares."""

from __future__ import annotations

import hashlib

import pytest

from imrobot import execute_operation, execute_pipeline, fnv1a, hmac_sign, solve_challenge
from imrobot import server as server_mod
from imrobot.core import format_operation, sha256_text_hex
from imrobot.server import ImRobotVerifier, constant_time_equal, create_verifier

SECRET = "s" * 8 + "-hardening-v09-secret"

# Issued by the JS verifier (createVerifier({ secret: 'interop-secret-0123456789abcdef',
# difficulty: 'medium', sha256: true, ttl: 300000 })), answer from solveChallenge().
JS_SECRET = "interop-secret-0123456789abcdef"
JS_CHALLENGE = {
    "version": 1,
    "id": "9aa240df8fd947ca",
    "timestamp": 1795538894862,
    "ttl": 300000,
    "difficulty": "medium",
    "seed": "5364763d702c1a165d8053",
    "visibleSeed": "5364763d702c1a16",
    "nonce": "5d8053",
    "pipeline": [{"op": "reverse"}, {"op": "to_lower"}, {"op": "vowel_count"}, {"op": "sha256"}],
    "verification": "fb1bacde",
    "hmac": "30814845d74bc740de5b20837a82605df2836621821eec1cd20c18f3dcfb7bac",
    "expiresAt": 1795539194862,
}
JS_ANSWER = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b"


class TestSha256Op:
    def test_vectors(self) -> None:
        assert sha256_text_hex("") == hashlib.sha256(b"").hexdigest()
        assert sha256_text_hex("abc") == (
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
        for s in ["zażółć gęślą jaźń", "日本語", "🤖 robot", "x" * 1000]:
            assert sha256_text_hex(s) == hashlib.sha256(s.encode("utf-8")).hexdigest()

    def test_lone_surrogate_matches_text_encoder(self) -> None:
        # JS TextEncoder turns a lone surrogate into U+FFFD (EF BF BD).
        assert sha256_text_hex("a\ud800b") == hashlib.sha256(b"a\xef\xbf\xbdb").hexdigest()

    def test_operation_and_format(self) -> None:
        assert execute_operation("1", {"op": "sha256"}) == hashlib.sha256(b"1").hexdigest()
        assert format_operation({"op": "sha256"}) == "sha256()"

    def test_off_by_default_once_when_on(self) -> None:
        for _ in range(30):
            off = server_mod._generate_challenge("medium", None)
            assert not any(o["op"] == "sha256" for o in off["pipeline"])
            on = server_mod._generate_challenge("medium", None, sha256=True)
            assert sum(1 for o in on["pipeline"] if o["op"] == "sha256") == 1

    async def test_verifier_round_trip(self) -> None:
        v = create_verifier(SECRET, sha256=True)
        for _ in range(10):
            c = await v.generate()
            assert any(o["op"] == "sha256" for o in c["pipeline"])
            assert (await v.verify(c, solve_challenge(c)))["valid"] is True


class TestJsInterop:
    async def test_js_issued_challenge_hmac_v2_and_answer(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        assert execute_pipeline(JS_CHALLENGE["seed"], JS_CHALLENGE["pipeline"]) == JS_ANSWER  # type: ignore[arg-type]
        assert fnv1a(f"{JS_ANSWER}:{JS_CHALLENGE['id']}") == JS_CHALLENGE["verification"]
        v = ImRobotVerifier(JS_SECRET)
        msg = v._build_signature_message(JS_CHALLENGE, JS_CHALLENGE["expiresAt"])  # type: ignore[arg-type]
        assert msg.startswith("v2:9aa240df8fd947ca:")
        assert hmac_sign(JS_SECRET, msg) == JS_CHALLENGE["hmac"]
        monkeypatch.setattr(server_mod, "_now_ms", lambda: JS_CHALLENGE["timestamp"] + 1000)  # type: ignore[operator]
        result = await v.verify(dict(JS_CHALLENGE), JS_ANSWER)  # type: ignore[arg-type]
        assert result["valid"] is True


class TestConstantTimeEqual:
    def test_semantics(self) -> None:
        assert constant_time_equal("abc", "abc")
        assert not constant_time_equal("abc", "abd")
        assert not constant_time_equal("abc", "abcd")
        assert constant_time_equal("ż", "ż")
        assert not constant_time_equal("ż", "z")
        assert not constant_time_equal(None, "a")  # type: ignore[arg-type]

    async def test_non_ascii_signature_does_not_raise(self) -> None:
        v = create_verifier(SECRET)
        c = await v.generate()
        c["hmac"] = "ż" * 64
        assert (await v.verify(c, "x"))["reason"] == "invalid_hmac"


class TestTimingGate:
    async def test_too_fast(self) -> None:
        v = create_verifier(SECRET, min_solve_ms=60_000)
        c = await v.generate()
        r = await v.verify(c, solve_challenge(c))
        assert r["valid"] is False and r["reason"] == "too_fast"

    async def test_too_slow_and_window(self, monkeypatch: pytest.MonkeyPatch) -> None:
        v = create_verifier(SECRET, min_solve_ms=100, max_solve_ms=5_000)
        c = await v.generate()
        answer = solve_challenge(c)
        monkeypatch.setattr(server_mod, "_now_ms", lambda: c["timestamp"] + 6_000)
        assert (await v.verify(c, answer))["reason"] == "too_slow"
        monkeypatch.setattr(server_mod, "_now_ms", lambda: c["timestamp"] + 1_000)
        ok = await v.verify(c, answer)
        assert ok["valid"] is True and ok["elapsed"] == 1_000

    async def test_default_floor_tolerates_clock_skew(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        v = create_verifier(SECRET)
        c = await v.generate()
        monkeypatch.setattr(server_mod, "_now_ms", lambda: c["timestamp"] - 50)
        assert (await v.verify(c, solve_challenge(c)))["valid"] is True

    async def test_ttl_must_be_positive_int(self) -> None:
        with pytest.raises(ValueError, match="ttl"):
            create_verifier(SECRET, ttl=1500.5)  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="ttl"):
            create_verifier(SECRET, ttl=0)
        with pytest.raises(ValueError, match="ttl"):
            await create_verifier(SECRET).generate(ttl=-1)

    def test_window_validation(self) -> None:
        with pytest.raises(ValueError):
            create_verifier(SECRET, min_solve_ms=-1)
        with pytest.raises(ValueError):
            create_verifier(SECRET, min_solve_ms=500, max_solve_ms=500)


class TestHmacV2:
    async def test_backdated_timestamp_breaks_hmac(self) -> None:
        v = create_verifier(SECRET, min_solve_ms=1_000)
        c = await v.generate()
        answer = solve_challenge(c)
        c["timestamp"] -= 10_000
        assert (await v.verify(c, answer))["reason"] == "invalid_hmac"

    async def test_swapped_seed_breaks_hmac(self) -> None:
        v = create_verifier(SECRET)
        c = await v.generate()
        answer = solve_challenge(c)
        c["seed"] = c["seed"] + "0"
        assert (await v.verify(c, answer))["reason"] == "invalid_hmac"

    async def test_signed_fields_keep_their_types(self) -> None:
        v = create_verifier(SECRET)
        c = await v.generate()
        answer = solve_challenge(c)
        for key in ("timestamp", "expiresAt"):
            bad = dict(c)
            bad[key] = str(c[key])  # signs the same text; must not reach the arithmetic
            assert (await v.verify(bad, answer))["reason"] == "invalid_hmac"  # type: ignore[arg-type]
        bad = dict(c)
        bad["timestamp"] = True
        assert (await v.verify(bad, answer))["reason"] == "invalid_hmac"  # type: ignore[arg-type]

    def test_astral_counts_as_surrogate_like_js(self) -> None:
        assert server_mod._has_surrogate("a\U0001f916")
        assert server_mod._has_surrogate("a\ud800")
        assert not server_mod._has_surrogate("plain ż")

    async def test_malformed_challenge_refused(self) -> None:
        v = create_verifier(SECRET)
        assert (await v.verify({}, "x"))["valid"] is False  # type: ignore[arg-type]
