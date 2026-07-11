"""
FastAPI middleware for imrobot agent verification.

Provides decorators and middleware for FastAPI applications
to protect endpoints with imrobot reverse-CAPTCHA verification.

Example::

    from fastapi import FastAPI
    from imrobot.fastapi_middleware import ImRobotMiddleware, require_agent

    app = FastAPI()

    # Add the challenge/verify routes
    middleware = ImRobotMiddleware(secret="your-secret-min-16-chars")
    app.include_router(middleware.router, prefix="/imrobot")

    # Protect routes -- only verified agents can access
    @app.get("/api/data")
    async def get_data(proof=Depends(require_agent(secret="your-secret-min-16-chars"))):
        return {"message": "Agent verified!", "agent": proof}
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Dict, Optional

try:
    from fastapi import APIRouter, Depends, HTTPException, Request
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel
except ImportError:
    raise ImportError(
        "FastAPI is required for imrobot.fastapi_middleware. "
        "Install it with: pip install fastapi"
    )

from .core import solve_challenge
from .server import ImRobotVerifier, ChallengeReplayGuard
from .types import Difficulty


# --- Rate Limiter ---

class _RateLimiter:
    """Simple in-memory sliding-window rate limiter."""

    def __init__(self, window_ms: int = 60_000, max_requests: int = 30):
        self._window_ms = window_ms
        self._max_requests = max_requests
        self._requests: Dict[str, list] = defaultdict(list)

    def is_allowed(self, key: str) -> bool:
        now = int(time.time() * 1000)
        cutoff = now - self._window_ms
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]
        if len(self._requests[key]) >= self._max_requests:
            return False
        self._requests[key].append(now)
        return True

    def get_remaining(self, key: str) -> int:
        now = int(time.time() * 1000)
        cutoff = now - self._window_ms
        self._requests[key] = [t for t in self._requests[key] if t > cutoff]
        return max(0, self._max_requests - len(self._requests[key]))

    def get_reset_at(self, key: str) -> int:
        if self._requests[key]:
            return self._requests[key][0] + self._window_ms
        return int(time.time() * 1000) + self._window_ms


# --- Pydantic models ---

class VerifyRequest(BaseModel):
    challenge: dict
    answer: str
    agentId: Optional[str] = None


# --- Middleware ---

class ImRobotMiddleware:
    """
    FastAPI integration for imrobot agent verification.

    Creates a router with challenge and verify endpoints that can
    be mounted on any FastAPI application.

    Example::

        from fastapi import FastAPI
        from imrobot.fastapi_middleware import ImRobotMiddleware

        app = FastAPI()
        middleware = ImRobotMiddleware(secret="your-secret-min-16-chars")
        app.include_router(middleware.router, prefix="/imrobot")

        # Agents can now:
        # GET  /imrobot/challenge  -- get a signed challenge
        # POST /imrobot/verify     -- submit answer, receive proof token
    """

    def __init__(
        self,
        secret: str,
        difficulty: Difficulty = "medium",
        ttl: Optional[int] = None,
        rate_limit_window_ms: int = 60_000,
        rate_limit_max_requests: int = 30,
        trust_proxy: bool = False,
        replay_guard: Optional[ChallengeReplayGuard] = None,
    ):
        self._verifier = ImRobotVerifier(
            secret=secret,
            difficulty=difficulty,
            ttl=ttl,
            replay_guard=replay_guard,
        )
        self._secret = secret
        self._rate_limiter = _RateLimiter(
            window_ms=rate_limit_window_ms,
            max_requests=rate_limit_max_requests,
        )
        self._trust_proxy = trust_proxy
        self._router = APIRouter()
        self._setup_routes()

    def _get_client_ip(self, request: Request) -> str:
        if self._trust_proxy:
            xff = request.headers.get("x-forwarded-for")
            if xff:
                return xff.split(",")[0].strip()
            xri = request.headers.get("x-real-ip")
            if xri:
                return xri.strip()
        if request.client:
            return request.client.host
        return "unknown"

    def _check_rate_limit(self, request: Request) -> Optional[JSONResponse]:
        key = self._get_client_ip(request)
        if not self._rate_limiter.is_allowed(key):
            remaining = self._rate_limiter.get_remaining(key)
            reset_at = self._rate_limiter.get_reset_at(key)
            retry_after = max(1, (reset_at - int(time.time() * 1000)) // 1000)
            return JSONResponse(
                status_code=429,
                content={
                    "error": "Too many requests",
                    "code": "RATE_LIMIT_EXCEEDED",
                    "retryAfter": retry_after,
                },
                headers={
                    "X-RateLimit-Remaining": str(remaining),
                    "X-RateLimit-Reset": str(reset_at),
                    "Retry-After": str(retry_after),
                },
            )
        return None

    def _setup_routes(self) -> None:
        @self._router.get("/challenge")
        async def get_challenge(request: Request):
            rate_limit_resp = self._check_rate_limit(request)
            if rate_limit_resp:
                return rate_limit_resp
            challenge = self._verifier.generate()
            return challenge.to_dict()

        @self._router.post("/verify")
        async def verify_answer(request: Request, body: VerifyRequest):
            rate_limit_resp = self._check_rate_limit(request)
            if rate_limit_resp:
                return rate_limit_resp

            from .types import SignedChallenge
            try:
                challenge = SignedChallenge.from_dict(body.challenge)
            except Exception:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "Invalid challenge format",
                        "code": "BAD_REQUEST",
                    },
                )

            result = self._verifier.verify(challenge, body.answer)

            if not result.valid:
                return JSONResponse(
                    status_code=403,
                    content={"valid": False, "reason": result.reason},
                )

            return {
                "valid": True,
                "elapsed": result.elapsed,
                "suspicious": result.suspicious,
            }

    @property
    def router(self) -> APIRouter:
        """The FastAPI router with challenge/verify endpoints."""
        return self._router


def require_agent(
    secret: str,
    header_name: str = "x-agent-proof",
    issuer: str = "imrobot",
):
    """
    FastAPI dependency that verifies the X-Agent-Proof header.

    Use as a dependency in route handlers to protect endpoints.

    Example::

        from fastapi import Depends
        from imrobot.fastapi_middleware import require_agent

        agent_guard = require_agent(secret="your-secret-min-16-chars")

        @app.get("/api/protected")
        async def protected(proof=Depends(agent_guard)):
            return {"agent": proof["sub"]}
    """
    import hashlib
    import hmac as hmac_mod
    import json
    import base64

    def _base64url_decode(s: str) -> bytes:
        padded = s + "=" * ((4 - len(s) % 4) % 4)
        return base64.urlsafe_b64decode(padded)

    async def _dependency(request: Request):
        token = request.headers.get(header_name)
        if not token:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": f"Missing agent proof. Include {header_name} header.",
                    "code": "AGENT_PROOF_REQUIRED",
                },
            )

        parts = token.split(".")
        if len(parts) != 3:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Invalid agent proof: malformed token",
                    "code": "AGENT_PROOF_INVALID",
                },
            )

        header_b64, payload_b64, sig_b64 = parts

        # Verify signature
        signing_input = f"{header_b64}.{payload_b64}"
        try:
            provided_sig = _base64url_decode(sig_b64).decode("utf-8")
        except Exception:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Invalid agent proof: malformed signature",
                    "code": "AGENT_PROOF_INVALID",
                },
            )

        expected_sig = hmac_mod.new(
            secret.encode("utf-8"),
            signing_input.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac_mod.compare_digest(expected_sig, provided_sig):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Invalid agent proof: invalid_signature",
                    "code": "AGENT_PROOF_INVALID",
                },
            )

        # Decode payload
        try:
            payload = json.loads(_base64url_decode(payload_b64))
        except Exception:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Invalid agent proof: malformed payload",
                    "code": "AGENT_PROOF_INVALID",
                },
            )

        # Check expiration
        now_ms = int(time.time() * 1000)
        if now_ms > payload.get("exp", 0):
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Invalid agent proof: expired",
                    "code": "AGENT_PROOF_INVALID",
                },
            )

        # Check issuer
        if payload.get("iss") != issuer:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "Invalid agent proof: invalid_issuer",
                    "code": "AGENT_PROOF_INVALID",
                },
            )

        return payload

    return _dependency
