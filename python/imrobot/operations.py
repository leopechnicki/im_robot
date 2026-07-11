"""
Challenge operations -- exact port of src/core/operations.ts.

Every operation produces identical output to the JavaScript implementation,
ensuring cross-language interoperability.
"""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING, List

from .hash import fnv1a

if TYPE_CHECKING:
    from .types import Operation


def _sync_hash_256(input_str: str) -> str:
    """
    Synchronous hash producing 64 hex chars (256-bit equivalent).
    Cascades FNV-1a 8 times -- mirrors syncHash256() in operations.ts.
    """
    result = ""
    for i in range(8):
        result += fnv1a(input_str + ":" + str(i))
    return result


def execute_operation(input_str: str, op: "Operation") -> str:
    """
    Execute a single pipeline operation on the input string.

    Args:
        input_str: Current pipeline value.
        op: Operation to apply.

    Returns:
        Transformed string.

    Raises:
        ValueError: If the operation type is unknown.
    """
    op_type = op.op

    if op_type == "reverse":
        return input_str[::-1]

    if op_type == "base64_encode":
        return base64.b64encode(input_str.encode("utf-8")).decode("ascii")

    if op_type == "to_upper":
        return input_str.upper()

    if op_type == "to_lower":
        return input_str.lower()

    if op_type == "rot13":
        result = []
        for c in input_str:
            if "a" <= c <= "z":
                result.append(chr((ord(c) - 97 + 13) % 26 + 97))
            elif "A" <= c <= "Z":
                result.append(chr((ord(c) - 65 + 13) % 26 + 65))
            else:
                result.append(c)
        return "".join(result)

    if op_type == "hex_encode":
        return "".join(format(ord(c), "02x") for c in input_str)

    if op_type == "sort_chars":
        return "".join(sorted(input_str))

    if op_type == "char_code_sum":
        return str(sum(ord(c) for c in input_str))

    if op_type == "substring":
        return input_str[op.start : op.end]  # type: ignore

    if op_type == "repeat":
        return input_str * op.times  # type: ignore

    if op_type == "replace":
        return input_str.replace(op.search, op.replacement)  # type: ignore

    if op_type == "pad_start":
        target_len = op.length  # type: ignore
        fill_char = op.fill  # type: ignore
        if len(input_str) >= target_len:
            return input_str
        pad_needed = target_len - len(input_str)
        padding = (fill_char * ((pad_needed // len(fill_char)) + 1))[:pad_needed]
        return padding + input_str

    if op_type == "xor_encode":
        key = op.key  # type: ignore
        return "".join(chr(ord(c) ^ key) for c in input_str)

    if op_type == "count_chars":
        return str(input_str.count(op.char))  # type: ignore

    if op_type == "caesar":
        shift = op.shift  # type: ignore
        result = []
        for c in input_str:
            if "a" <= c <= "z":
                result.append(chr(((ord(c) - 97 + shift) % 26 + 26) % 26 + 97))
            elif "A" <= c <= "Z":
                result.append(chr(((ord(c) - 65 + shift) % 26 + 26) % 26 + 65))
            else:
                result.append(c)
        return "".join(result)

    if op_type == "slice_alternate":
        return input_str[::2]

    if op_type == "fnv1a_hash":
        return fnv1a(input_str)

    if op_type == "length":
        return str(len(input_str))

    if op_type == "sha256_hash":
        return _sync_hash_256(input_str)

    if op_type == "byte_xor":
        key_arr: List[int] = op.key  # type: ignore
        return "".join(
            chr(ord(c) ^ key_arr[i % len(key_arr)])
            for i, c in enumerate(input_str)
        )

    if op_type == "hash_chain":
        rounds: int = op.rounds  # type: ignore
        val = input_str
        for r in range(rounds):
            val = fnv1a(val + ":" + str(r))
        return val

    if op_type == "nibble_swap":
        result = []
        for c in input_str:
            code = ord(c)
            swapped = ((code & 0x0F) << 4) | ((code & 0xF0) >> 4)
            result.append(chr(swapped))
        return "".join(result)

    if op_type == "bit_rotate":
        shift = ((op.bits % 8) + 8) % 8  # type: ignore
        result = []
        for c in input_str:
            code = ord(c) & 0xFF
            rotated = ((code << shift) | (code >> (8 - shift))) & 0xFF
            result.append(chr(rotated))
        return "".join(result)

    if op_type == "vowel_count":
        vowels = set("aeiouAEIOU")
        return str(sum(1 for c in input_str if c in vowels))

    if op_type == "consonant_extract":
        import re
        vowels = set("aeiouAEIOU")
        return "".join(
            c for c in input_str
            if re.match(r"[a-zA-Z]", c) and c not in vowels
        )

    if op_type == "run_length_encode":
        if not input_str:
            return ""
        result = []
        count = 1
        for i in range(1, len(input_str) + 1):
            if i < len(input_str) and input_str[i] == input_str[i - 1]:
                count += 1
            else:
                if count > 1:
                    result.append(f"{count}{input_str[i - 1]}")
                else:
                    result.append(input_str[i - 1])
                count = 1
        return "".join(result)

    if op_type == "atbash":
        result = []
        for c in input_str:
            if "a" <= c <= "z":
                result.append(chr(97 + (25 - (ord(c) - 97))))
            elif "A" <= c <= "Z":
                result.append(chr(65 + (25 - (ord(c) - 65))))
            else:
                result.append(c)
        return "".join(result)

    raise ValueError(f"Unknown operation: {op_type}")


def execute_pipeline(seed: str, pipeline: list) -> str:
    """
    Execute a full pipeline of operations on a seed value.

    Args:
        seed: Initial string value.
        pipeline: List of Operation objects.

    Returns:
        Final transformed string.
    """
    value = seed
    for op in pipeline:
        value = execute_operation(value, op)
    return value


def format_operation(op: "Operation") -> str:
    """
    Format a single operation as a human-readable string.

    Mirrors formatOperation() from operations.ts.
    """
    op_type = op.op

    simple_ops = {
        "reverse": "reverse()",
        "base64_encode": "base64_encode()",
        "to_upper": "to_upper()",
        "to_lower": "to_lower()",
        "rot13": "rot13()",
        "hex_encode": "hex_encode()",
        "sort_chars": "sort_chars()",
        "char_code_sum": "char_code_sum()",
        "slice_alternate": "slice_alternate()",
        "fnv1a_hash": "fnv1a_hash()",
        "length": "length()",
        "sha256_hash": "sha256_hash()",
        "nibble_swap": "nibble_swap()",
        "vowel_count": "vowel_count()",
        "consonant_extract": "consonant_extract()",
        "run_length_encode": "run_length_encode()",
        "atbash": "atbash()",
    }

    if op_type in simple_ops:
        return simple_ops[op_type]

    if op_type == "substring":
        return f"substring({op.start}, {op.end})"  # type: ignore
    if op_type == "repeat":
        return f"repeat({op.times})"  # type: ignore
    if op_type == "replace":
        return f'replace("{op.search}", "{op.replacement}")'  # type: ignore
    if op_type == "pad_start":
        return f'pad_start({op.length}, "{op.fill}")'  # type: ignore
    if op_type == "xor_encode":
        return f"xor_encode({op.key})"  # type: ignore
    if op_type == "count_chars":
        return f'count_chars("{op.char}")'  # type: ignore
    if op_type == "caesar":
        return f"caesar({op.shift})"  # type: ignore
    if op_type == "byte_xor":
        key_str = ",".join(str(k) for k in op.key)  # type: ignore
        return f"byte_xor([{key_str}])"
    if op_type == "hash_chain":
        return f"hash_chain({op.rounds})"  # type: ignore
    if op_type == "bit_rotate":
        return f"bit_rotate({op.bits})"  # type: ignore

    return f"{op_type}()"


def format_pipeline(seed: str, pipeline: list) -> str:
    """
    Format a full pipeline as a human-readable string.

    Mirrors formatPipeline() from operations.ts.
    """
    lines = [f'seed: "{seed}"']
    for i, op in enumerate(pipeline):
        lines.append(f"  {i + 1}. {format_operation(op)}")
    return "\n".join(lines)
