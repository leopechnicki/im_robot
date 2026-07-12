"""
imrobot — Reverse-CAPTCHA that verifies AI agents (Python SDK).

Public API — mirrors the JavaScript SDK's ``imrobot`` and ``imrobot/server`` surfaces.

Solver (client side, for LangChain / CrewAI / AutoGPT / any AI agent):

    >>> from imrobot import solve_challenge
    >>> import httpx
    >>> challenge = httpx.get("https://example.com/imrobot/challenge").json()
    >>> answer = solve_challenge(challenge)
    >>> httpx.post("https://example.com/imrobot/verify",
    ...            json={"challenge": challenge, "answer": answer})

Verifier (server side):

    >>> from imrobot import ImRobotVerifier
    >>> verifier = ImRobotVerifier(secret="a-32-char-server-secret-string")
    >>> signed = await verifier.generate()
    >>> result = await verifier.verify(signed, answer)

Proof tokens (RFC 7519 JWT, HS256):

    >>> from imrobot import ProofTokenIssuer
    >>> issuer = ProofTokenIssuer(secret="...")
    >>> token = await issuer.issue(agent_id="agent_1", challenge_id=signed["id"],
    ...                            difficulty="medium", solve_time_ms=42, suspicious=False)

FastAPI middleware — see ``imrobot.fastapi``.
"""

from ._version import __version__
from .core import (
    Challenge,
    Difficulty,
    Operation,
    SignedChallenge,
    execute_operation,
    execute_pipeline,
    fnv1a,
    format_operation,
    format_pipeline,
    solve_challenge,
)
from .server import (
    AgentProofToken,
    ChallengeReplayGuard,
    ImRobotVerifier,
    InMemoryReplayGuard,
    ProofTokenIssuer,
    ProofTokenVerifyResult,
    VerifyResult,
    hmac_sign,
    hmac_verify,
    sha256_hex,
)

__all__ = [
    "__version__",
    # core types
    "Challenge",
    "Difficulty",
    "Operation",
    "SignedChallenge",
    # core functions
    "execute_operation",
    "execute_pipeline",
    "fnv1a",
    "format_operation",
    "format_pipeline",
    "solve_challenge",
    # server
    "AgentProofToken",
    "ChallengeReplayGuard",
    "ImRobotVerifier",
    "InMemoryReplayGuard",
    "ProofTokenIssuer",
    "ProofTokenVerifyResult",
    "VerifyResult",
    "hmac_sign",
    "hmac_verify",
    "sha256_hex",
]
