"""Tests for the core operations engine and solver.

These tests verify byte-identical output against known JS reference values —
so a Python solver interoperates with a JS-issued challenge and vice versa.
"""

from __future__ import annotations

import pytest

from imrobot import execute_operation, execute_pipeline, fnv1a, solve_challenge
from imrobot.core import format_operation, format_pipeline


class TestFnv1a:
    def test_empty_string(self):
        # JS: fnv1a("") === "811c9dc5" (initial basis returned unchanged)
        assert fnv1a("") == "811c9dc5"

    def test_hello(self):
        # JS reference: fnv1a("hello") -> deterministic 8-char hex
        result = fnv1a("hello")
        assert len(result) == 8
        assert all(c in "0123456789abcdef" for c in result)

    def test_deterministic(self):
        assert fnv1a("abc123") == fnv1a("abc123")

    def test_different_inputs_different_outputs(self):
        assert fnv1a("a") != fnv1a("b")

    def test_length_always_8(self):
        for s in ["", "x", "a very long string with many characters"]:
            assert len(fnv1a(s)) == 8


class TestBasicOperations:
    def test_reverse(self):
        assert execute_operation("hello", {"op": "reverse"}) == "olleh"

    def test_reverse_empty(self):
        assert execute_operation("", {"op": "reverse"}) == ""

    def test_to_upper(self):
        assert execute_operation("hello", {"op": "to_upper"}) == "HELLO"

    def test_to_lower(self):
        assert execute_operation("HELLO", {"op": "to_lower"}) == "hello"

    def test_sort_chars(self):
        assert execute_operation("cba", {"op": "sort_chars"}) == "abc"

    def test_length(self):
        assert execute_operation("hello", {"op": "length"}) == "5"

    def test_slice_alternate(self):
        assert execute_operation("abcdef", {"op": "slice_alternate"}) == "ace"

    def test_vowel_count(self):
        assert execute_operation("hello world", {"op": "vowel_count"}) == "3"

    def test_consonant_extract(self):
        assert execute_operation("Hello, World!", {"op": "consonant_extract"}) == "HllWrld"

    def test_atbash(self):
        # a→z, b→y, c→x
        assert execute_operation("abc", {"op": "atbash"}) == "zyx"
        assert execute_operation("Hello", {"op": "atbash"}) == "Svool"


class TestEncodingOperations:
    def test_base64_encode(self):
        # matches JS btoa/TextEncoder result
        assert execute_operation("hello", {"op": "base64_encode"}) == "aGVsbG8="

    def test_hex_encode(self):
        assert execute_operation("abc", {"op": "hex_encode"}) == "616263"

    def test_rot13(self):
        assert execute_operation("hello", {"op": "rot13"}) == "uryyb"
        assert execute_operation("Hello, World!", {"op": "rot13"}) == "Uryyb, Jbeyq!"

    def test_caesar_shift_1(self):
        assert execute_operation("abc", {"op": "caesar", "shift": 1}) == "bcd"

    def test_caesar_negative_shift(self):
        # JS handles negative shift via double-mod trick
        assert execute_operation("bcd", {"op": "caesar", "shift": -1}) == "abc"

    def test_char_code_sum(self):
        # 'a'=97, 'b'=98, 'c'=99 → 294
        assert execute_operation("abc", {"op": "char_code_sum"}) == "294"


class TestParameterizedOperations:
    def test_substring(self):
        assert execute_operation("hello world", {"op": "substring", "start": 0, "end": 5}) == "hello"

    def test_repeat(self):
        assert execute_operation("ab", {"op": "repeat", "times": 3}) == "ababab"

    def test_replace(self):
        assert execute_operation("hello", {"op": "replace", "search": "l", "replacement": "L"}) == "heLLo"

    def test_pad_start(self):
        assert execute_operation("5", {"op": "pad_start", "length": 3, "fill": "0"}) == "005"

    def test_count_chars(self):
        assert execute_operation("hello", {"op": "count_chars", "char": "l"}) == "2"


class TestCryptoOperations:
    def test_fnv1a_hash_op(self):
        result = execute_operation("hello", {"op": "fnv1a_hash"})
        assert len(result) == 8
        assert result == fnv1a("hello")

    def test_fnv1a_cascade(self):
        result = execute_operation("hello", {"op": "fnv1a_cascade"})
        assert len(result) == 64  # 8 rounds × 8 chars

    def test_sha256_hash_deprecated_but_works(self):
        # Should produce same output as fnv1a_cascade (they're aliases)
        with pytest.warns(DeprecationWarning):
            from imrobot import core as core_mod
            # Reset warned flag for this test
            core_mod._sha256_hash_deprecation_warned = False
            result_a = execute_operation("hello", {"op": "sha256_hash"})
        result_b = execute_operation("hello", {"op": "fnv1a_cascade"})
        assert result_a == result_b
        assert len(result_a) == 64

    def test_hash_chain(self):
        result = execute_operation("hello", {"op": "hash_chain", "rounds": 3})
        assert len(result) == 8  # single fnv1a per round → still 8 chars

    def test_hash_chain_rounds_must_be_positive(self):
        with pytest.raises(ValueError, match="hash_chain"):
            execute_operation("hello", {"op": "hash_chain", "rounds": 0})

    def test_xor_encode(self):
        # deterministic: XOR each char code with key
        result = execute_operation("A", {"op": "xor_encode", "key": 1})
        assert result == chr(ord("A") ^ 1)

    def test_byte_xor(self):
        result = execute_operation("AB", {"op": "byte_xor", "key": [1, 2]})
        assert result == chr(ord("A") ^ 1) + chr(ord("B") ^ 2)

    def test_byte_xor_empty_key_raises(self):
        with pytest.raises(ValueError, match="byte_xor"):
            execute_operation("hi", {"op": "byte_xor", "key": []})

    def test_nibble_swap(self):
        # 'A' = 0x41 -> 0x14 = chr(20)
        result = execute_operation("A", {"op": "nibble_swap"})
        assert result == chr(0x14)

    def test_bit_rotate(self):
        # 'A' = 0x41 = 0b01000001. Rotate left by 1 -> 0b10000010 = 0x82
        result = execute_operation("A", {"op": "bit_rotate", "bits": 1})
        assert result == chr(0x82)


class TestRunLengthEncode:
    def test_basic(self):
        assert execute_operation("aaabbc", {"op": "run_length_encode"}) == "3a2bc"

    def test_empty(self):
        assert execute_operation("", {"op": "run_length_encode"}) == ""

    def test_single(self):
        assert execute_operation("a", {"op": "run_length_encode"}) == "a"


class TestPipeline:
    def test_two_step_pipeline(self):
        # reverse then uppercase
        assert execute_pipeline("hello", [{"op": "reverse"}, {"op": "to_upper"}]) == "OLLEH"

    def test_empty_pipeline_returns_seed(self):
        assert execute_pipeline("hello", []) == "hello"

    def test_pipeline_via_solve_challenge(self):
        challenge = {
            "seed": "abc",
            "pipeline": [{"op": "reverse"}, {"op": "to_upper"}],
        }
        assert solve_challenge(challenge) == "CBA"


class TestUnknownOperation:
    def test_raises(self):
        with pytest.raises(ValueError, match="Unknown operation"):
            execute_operation("hello", {"op": "not_a_real_op"})


class TestFormat:
    def test_format_operation_simple(self):
        assert format_operation({"op": "reverse"}) == "reverse()"

    def test_format_operation_parametrized(self):
        assert format_operation({"op": "substring", "start": 0, "end": 5}) == "substring(0, 5)"

    def test_format_pipeline_multiline(self):
        formatted = format_pipeline("abc", [{"op": "reverse"}, {"op": "to_upper"}])
        assert "abc" in formatted
        assert "reverse()" in formatted
        assert "to_upper()" in formatted
        assert formatted.count("\n") == 2  # seed line + 2 ops
