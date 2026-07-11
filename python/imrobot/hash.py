"""
FNV-1a hash -- fast, non-cryptographic, synchronous.

Exact port of src/core/hash.ts to produce identical output.
Used for challenge verification (not security-critical).
"""


def fnv1a(s: str) -> str:
    """
    Compute FNV-1a hash of a string.

    Returns an 8-character lowercase hex string, identical to the
    JavaScript implementation in src/core/hash.ts.

    Args:
        s: Input string to hash.

    Returns:
        8-char hex digest (e.g., "bc2c0be9").
    """
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        # Emulate Math.imul(h, 0x01000193) -- 32-bit multiply
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")
