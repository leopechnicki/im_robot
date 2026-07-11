"""
imrobot - Reverse-CAPTCHA for AI agents. Verify bots, not humans.

Python SDK mirroring the JavaScript imrobot package API.
"""

from .core import (
    generate_challenge,
    solve_challenge,
    verify_answer,
    execute_operation,
    execute_pipeline,
    format_operation,
    format_pipeline,
)
from .types import Challenge, Difficulty, ImRobotToken, Operation, VerifyResult
from .hash import fnv1a
from .invisible import invisible_verify

__version__ = "0.1.0"

__all__ = [
    # Core API
    "generate_challenge",
    "solve_challenge",
    "verify_answer",
    "execute_operation",
    "execute_pipeline",
    "format_operation",
    "format_pipeline",
    # Types
    "Challenge",
    "Difficulty",
    "ImRobotToken",
    "Operation",
    "VerifyResult",
    # Utilities
    "fnv1a",
    "invisible_verify",
]
