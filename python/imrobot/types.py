"""
Type definitions for the imrobot Python SDK.

Mirrors the TypeScript types from src/core/types.ts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union


# --- Difficulty ---

Difficulty = Literal["easy", "medium", "hard"]


# --- Operations ---

@dataclass
class ReverseOp:
    op: Literal["reverse"] = "reverse"

@dataclass
class Base64EncodeOp:
    op: Literal["base64_encode"] = "base64_encode"

@dataclass
class ToUpperOp:
    op: Literal["to_upper"] = "to_upper"

@dataclass
class ToLowerOp:
    op: Literal["to_lower"] = "to_lower"

@dataclass
class Rot13Op:
    op: Literal["rot13"] = "rot13"

@dataclass
class HexEncodeOp:
    op: Literal["hex_encode"] = "hex_encode"

@dataclass
class SortCharsOp:
    op: Literal["sort_chars"] = "sort_chars"

@dataclass
class CharCodeSumOp:
    op: Literal["char_code_sum"] = "char_code_sum"

@dataclass
class SubstringOp:
    start: int
    end: int
    op: Literal["substring"] = "substring"

@dataclass
class RepeatOp:
    times: int
    op: Literal["repeat"] = "repeat"

@dataclass
class ReplaceOp:
    search: str
    replacement: str
    op: Literal["replace"] = "replace"

@dataclass
class PadStartOp:
    length: int
    fill: str
    op: Literal["pad_start"] = "pad_start"

@dataclass
class XorEncodeOp:
    key: int
    op: Literal["xor_encode"] = "xor_encode"

@dataclass
class CountCharsOp:
    char: str
    op: Literal["count_chars"] = "count_chars"

@dataclass
class CaesarOp:
    shift: int
    op: Literal["caesar"] = "caesar"

@dataclass
class SliceAlternateOp:
    op: Literal["slice_alternate"] = "slice_alternate"

@dataclass
class Fnv1aHashOp:
    op: Literal["fnv1a_hash"] = "fnv1a_hash"

@dataclass
class LengthOp:
    op: Literal["length"] = "length"

@dataclass
class Sha256HashOp:
    op: Literal["sha256_hash"] = "sha256_hash"

@dataclass
class ByteXorOp:
    key: List[int]
    op: Literal["byte_xor"] = "byte_xor"

@dataclass
class HashChainOp:
    rounds: int
    op: Literal["hash_chain"] = "hash_chain"

@dataclass
class NibbleSwapOp:
    op: Literal["nibble_swap"] = "nibble_swap"

@dataclass
class BitRotateOp:
    bits: int
    op: Literal["bit_rotate"] = "bit_rotate"

@dataclass
class VowelCountOp:
    op: Literal["vowel_count"] = "vowel_count"

@dataclass
class ConsonantExtractOp:
    op: Literal["consonant_extract"] = "consonant_extract"

@dataclass
class RunLengthEncodeOp:
    op: Literal["run_length_encode"] = "run_length_encode"

@dataclass
class AtbashOp:
    op: Literal["atbash"] = "atbash"


Operation = Union[
    ReverseOp, Base64EncodeOp, ToUpperOp, ToLowerOp, Rot13Op,
    HexEncodeOp, SortCharsOp, CharCodeSumOp, SubstringOp, RepeatOp,
    ReplaceOp, PadStartOp, XorEncodeOp, CountCharsOp, CaesarOp,
    SliceAlternateOp, Fnv1aHashOp, LengthOp, Sha256HashOp, ByteXorOp,
    HashChainOp, NibbleSwapOp, BitRotateOp, VowelCountOp,
    ConsonantExtractOp, RunLengthEncodeOp, AtbashOp,
]


def operation_from_dict(d: Dict[str, Any]) -> Operation:
    """Convert a dictionary (from JSON) to a typed Operation dataclass."""
    op_type = d["op"]
    mapping = {
        "reverse": ReverseOp,
        "base64_encode": Base64EncodeOp,
        "to_upper": ToUpperOp,
        "to_lower": ToLowerOp,
        "rot13": Rot13Op,
        "hex_encode": HexEncodeOp,
        "sort_chars": SortCharsOp,
        "char_code_sum": CharCodeSumOp,
        "slice_alternate": SliceAlternateOp,
        "fnv1a_hash": Fnv1aHashOp,
        "length": LengthOp,
        "sha256_hash": Sha256HashOp,
        "nibble_swap": NibbleSwapOp,
        "vowel_count": VowelCountOp,
        "consonant_extract": ConsonantExtractOp,
        "run_length_encode": RunLengthEncodeOp,
        "atbash": AtbashOp,
    }

    if op_type in mapping:
        return mapping[op_type]()

    if op_type == "substring":
        return SubstringOp(start=d["start"], end=d["end"])
    if op_type == "repeat":
        return RepeatOp(times=d["times"])
    if op_type == "replace":
        return ReplaceOp(search=d["search"], replacement=d["replacement"])
    if op_type == "pad_start":
        return PadStartOp(length=d["length"], fill=d["fill"])
    if op_type == "xor_encode":
        return XorEncodeOp(key=d["key"])
    if op_type == "count_chars":
        return CountCharsOp(char=d["char"])
    if op_type == "caesar":
        return CaesarOp(shift=d["shift"])
    if op_type == "byte_xor":
        return ByteXorOp(key=d["key"])
    if op_type == "hash_chain":
        return HashChainOp(rounds=d["rounds"])
    if op_type == "bit_rotate":
        return BitRotateOp(bits=d["bits"])

    raise ValueError(f"Unknown operation: {op_type}")


# --- Challenge ---

@dataclass
class Challenge:
    version: int
    id: str
    timestamp: int
    ttl: int
    difficulty: Difficulty
    seed: str
    visible_seed: str
    nonce: str
    pipeline: List[Operation]
    verification: str

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "Challenge":
        """Create a Challenge from a JSON-decoded dictionary."""
        return cls(
            version=d["version"],
            id=d["id"],
            timestamp=d["timestamp"],
            ttl=d["ttl"],
            difficulty=d["difficulty"],
            seed=d["seed"],
            visible_seed=d.get("visibleSeed", d.get("visible_seed", "")),
            nonce=d.get("nonce", ""),
            pipeline=[operation_from_dict(op) for op in d["pipeline"]],
            verification=d["verification"],
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a JSON-compatible dictionary (using JS field names)."""
        pipeline_dicts = []
        for op in self.pipeline:
            d: Dict[str, Any] = {"op": op.op}
            if hasattr(op, "start"):
                d["start"] = op.start  # type: ignore
            if hasattr(op, "end"):
                d["end"] = op.end  # type: ignore
            if hasattr(op, "times"):
                d["times"] = op.times  # type: ignore
            if hasattr(op, "search"):
                d["search"] = op.search  # type: ignore
                d["replacement"] = op.replacement  # type: ignore
            if hasattr(op, "length") and op.op == "pad_start":
                d["length"] = op.length  # type: ignore
                d["fill"] = op.fill  # type: ignore
            if hasattr(op, "key") and op.op == "xor_encode":
                d["key"] = op.key  # type: ignore
            if hasattr(op, "char"):
                d["char"] = op.char  # type: ignore
            if hasattr(op, "shift"):
                d["shift"] = op.shift  # type: ignore
            if hasattr(op, "key") and op.op == "byte_xor":
                d["key"] = op.key  # type: ignore
            if hasattr(op, "rounds"):
                d["rounds"] = op.rounds  # type: ignore
            if hasattr(op, "bits"):
                d["bits"] = op.bits  # type: ignore
            pipeline_dicts.append(d)

        return {
            "version": self.version,
            "id": self.id,
            "timestamp": self.timestamp,
            "ttl": self.ttl,
            "difficulty": self.difficulty,
            "seed": self.seed,
            "visibleSeed": self.visible_seed,
            "nonce": self.nonce,
            "pipeline": pipeline_dicts,
            "verification": self.verification,
        }


# --- Signed Challenge ---

@dataclass
class SignedChallenge(Challenge):
    hmac: str = ""
    expires_at: int = 0

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SignedChallenge":
        base = Challenge.from_dict(d)
        return cls(
            **{k: v for k, v in base.__dict__.items()},
            hmac=d.get("hmac", ""),
            expires_at=d.get("expiresAt", d.get("expires_at", 0)),
        )

    def to_dict(self) -> Dict[str, Any]:
        d = super().to_dict()
        d["hmac"] = self.hmac
        d["expiresAt"] = self.expires_at
        return d


# --- Token and Result ---

SUSPICIOUS_THRESHOLD_MS = 5000


@dataclass
class ImRobotToken:
    challenge_id: str
    answer: str
    timestamp: int
    elapsed: int
    suspicious: bool
    signature: str


@dataclass
class VerifyResult:
    valid: bool
    reason: Optional[str] = None
    elapsed: Optional[int] = None
    suspicious: Optional[bool] = None
