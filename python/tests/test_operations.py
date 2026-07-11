"""Tests for all pipeline operations."""

from imrobot.operations import execute_operation, execute_pipeline, format_operation, format_pipeline
from imrobot.types import (
    ReverseOp, Base64EncodeOp, ToUpperOp, ToLowerOp, Rot13Op,
    HexEncodeOp, SortCharsOp, CharCodeSumOp, SubstringOp, RepeatOp,
    ReplaceOp, PadStartOp, XorEncodeOp, CountCharsOp, CaesarOp,
    SliceAlternateOp, Fnv1aHashOp, LengthOp, Sha256HashOp, ByteXorOp,
    HashChainOp, NibbleSwapOp, BitRotateOp, VowelCountOp,
    ConsonantExtractOp, RunLengthEncodeOp, AtbashOp,
)


class TestStringOperations:

    def test_reverse(self):
        assert execute_operation("abc", ReverseOp()) == "cba"

    def test_reverse_empty(self):
        assert execute_operation("", ReverseOp()) == ""

    def test_to_upper(self):
        assert execute_operation("abc", ToUpperOp()) == "ABC"

    def test_to_lower(self):
        assert execute_operation("ABC", ToLowerOp()) == "abc"

    def test_base64_encode(self):
        assert execute_operation("hello", Base64EncodeOp()) == "aGVsbG8="

    def test_rot13(self):
        assert execute_operation("hello", Rot13Op()) == "uryyb"

    def test_rot13_uppercase(self):
        assert execute_operation("HELLO", Rot13Op()) == "URYYB"

    def test_rot13_roundtrip(self):
        original = "Hello World 123"
        assert execute_operation(execute_operation(original, Rot13Op()), Rot13Op()) == original

    def test_hex_encode(self):
        assert execute_operation("AB", HexEncodeOp()) == "4142"

    def test_sort_chars(self):
        assert execute_operation("dcba", SortCharsOp()) == "abcd"

    def test_char_code_sum(self):
        # A=65, B=66 -> 131
        assert execute_operation("AB", CharCodeSumOp()) == "131"

    def test_substring(self):
        assert execute_operation("abcdef", SubstringOp(start=2, end=5)) == "cde"

    def test_repeat(self):
        assert execute_operation("ab", RepeatOp(times=3)) == "ababab"

    def test_replace(self):
        assert execute_operation("aab", ReplaceOp(search="a", replacement="x")) == "xxb"

    def test_pad_start(self):
        assert execute_operation("abc", PadStartOp(length=6, fill="0")) == "000abc"

    def test_pad_start_no_pad_needed(self):
        assert execute_operation("abcdef", PadStartOp(length=3, fill="0")) == "abcdef"

    def test_vowel_count(self):
        assert execute_operation("hello", VowelCountOp()) == "2"

    def test_consonant_extract(self):
        assert execute_operation("hello", ConsonantExtractOp()) == "hll"

    def test_run_length_encode(self):
        assert execute_operation("aaabb", RunLengthEncodeOp()) == "3a2b"

    def test_run_length_encode_no_runs(self):
        assert execute_operation("abc", RunLengthEncodeOp()) == "abc"

    def test_run_length_encode_empty(self):
        assert execute_operation("", RunLengthEncodeOp()) == ""

    def test_atbash(self):
        assert execute_operation("abc", AtbashOp()) == "zyx"

    def test_atbash_uppercase(self):
        assert execute_operation("ABC", AtbashOp()) == "ZYX"

    def test_atbash_roundtrip(self):
        original = "Hello World"
        assert execute_operation(execute_operation(original, AtbashOp()), AtbashOp()) == original

    def test_length(self):
        assert execute_operation("hello", LengthOp()) == "5"

    def test_slice_alternate(self):
        assert execute_operation("abcdef", SliceAlternateOp()) == "ace"


class TestByteAndCipherOperations:

    def test_caesar(self):
        assert execute_operation("abc", CaesarOp(shift=1)) == "bcd"

    def test_caesar_wrap(self):
        assert execute_operation("xyz", CaesarOp(shift=3)) == "abc"

    def test_caesar_negative(self):
        assert execute_operation("bcd", CaesarOp(shift=-1)) == "abc"

    def test_xor_encode(self):
        result = execute_operation("AB", XorEncodeOp(key=1))
        assert result == "@C"

    def test_xor_roundtrip(self):
        original = "Hello World"
        key = 42
        encoded = execute_operation(original, XorEncodeOp(key=key))
        decoded = execute_operation(encoded, XorEncodeOp(key=key))
        assert decoded == original

    def test_count_chars(self):
        assert execute_operation("aababc", CountCharsOp(char="a")) == "3"

    def test_fnv1a_hash(self):
        result = execute_operation("test", Fnv1aHashOp())
        assert result == "afd071e5"
        assert len(result) == 8

    def test_sha256_hash(self):
        result = execute_operation("test", Sha256HashOp())
        assert len(result) == 64  # 8 * 8 hex chars

    def test_byte_xor(self):
        result = execute_operation("AB", ByteXorOp(key=[1, 2]))
        assert result == "@@"

    def test_byte_xor_roundtrip(self):
        original = "Hello"
        key = [1, 2, 3]
        encoded = execute_operation(original, ByteXorOp(key=key))
        decoded = execute_operation(encoded, ByteXorOp(key=key))
        assert decoded == original

    def test_hash_chain(self):
        result = execute_operation("test", HashChainOp(rounds=3))
        assert len(result) == 8  # FNV-1a always 8 hex chars

    def test_nibble_swap(self):
        # 0x41 ('A') -> swap nibbles -> 0x14
        result = execute_operation("A", NibbleSwapOp())
        assert ord(result) == 0x14

    def test_nibble_swap_roundtrip(self):
        original = "AB"
        swapped = execute_operation(original, NibbleSwapOp())
        restored = execute_operation(swapped, NibbleSwapOp())
        assert restored == original

    def test_bit_rotate(self):
        result = execute_operation("A", BitRotateOp(bits=1))
        # A = 0x41 = 0b01000001, rotate left 1 = 0b10000010 = 0x82
        assert ord(result) == 0x82


class TestPipeline:

    def test_simple_pipeline(self):
        result = execute_pipeline("abc", [ReverseOp(), ToUpperOp()])
        assert result == "CBA"

    def test_empty_pipeline(self):
        assert execute_pipeline("hello", []) == "hello"

    def test_complex_pipeline(self):
        result = execute_pipeline(
            "abc",
            [ReverseOp(), ToUpperOp(), Rot13Op()],
        )
        # abc -> cba -> CBA -> PON
        assert result == "PON"


class TestFormatting:

    def test_format_simple_op(self):
        assert format_operation(ReverseOp()) == "reverse()"
        assert format_operation(ToUpperOp()) == "to_upper()"

    def test_format_parameterized_op(self):
        assert format_operation(CaesarOp(shift=7)) == "caesar(7)"
        assert format_operation(SubstringOp(start=2, end=5)) == "substring(2, 5)"

    def test_format_pipeline(self):
        result = format_pipeline("abc", [ReverseOp(), CaesarOp(shift=3)])
        assert 'seed: "abc"' in result
        assert "1. reverse()" in result
        assert "2. caesar(3)" in result
