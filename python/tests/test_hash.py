"""Tests for the FNV-1a hash implementation."""

from imrobot.hash import fnv1a


class TestFnv1a:
    """Verify FNV-1a produces identical output to the JavaScript implementation."""

    def test_empty_string(self):
        # FNV-1a of empty string = offset basis as hex
        result = fnv1a("")
        assert len(result) == 8
        assert result == "811c9dc5"

    def test_known_value_test(self):
        # Known FNV-1a("test") value -- cross-checked with JS
        result = fnv1a("test")
        assert result == "afd071e5"

    def test_known_value_hello(self):
        result = fnv1a("hello")
        assert result == "4f9f2cab"

    def test_deterministic(self):
        a = fnv1a("deterministic")
        b = fnv1a("deterministic")
        assert a == b

    def test_different_inputs_different_hashes(self):
        a = fnv1a("abc")
        b = fnv1a("abd")
        assert a != b

    def test_always_8_hex_chars(self):
        for s in ["", "a", "hello world", "x" * 1000]:
            result = fnv1a(s)
            assert len(result) == 8
            assert all(c in "0123456789abcdef" for c in result)

    def test_verification_hash_format(self):
        """Test the verification pattern: fnv1a(answer + ':' + id)."""
        answer = "abc123"
        challenge_id = "deadbeef01234567"
        result = fnv1a(answer + ":" + challenge_id)
        assert len(result) == 8
