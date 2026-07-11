"""
FastAPI / Starlette middleware for imrobot — the Python mirror of
``imrobot/hono`` and ``imrobot/next``.

Usage:

.. code-block:: python

    from fastapi import FastAPI, Depends
    from imrobot import ImRobotVerifier, ProofTokenIssuer
    from imrobot.fastapi import create_imrobot_router, require_agent

    app = FastAPI()
    secret = os.environ["IMROBOT_SECRET"]

    # Mount /imrobot/challenge and /imrobot/verify
    router = create_imrobot_router(secret=secret)
    app.include_router(router, prefix="/imrobot")

    # Protect a route with a proof token dependency
    @app.get("/api/agent-data", dependencies=[Depends(require_agent(secret=secret))])
    def agent_only():
        return {"secret": "only bots see this"}

FastAPI/Starlette are imported lazily so ``imrobot`` remains dep-free for
consumers that only use the solver/verifier.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional

from .core import fnv1a
from .server import (
    ChallengeReplayGuard,
    Difficulty,
    ImRobotVerifier,
    ProofTokenIssuer,
    SignedChallenge,
)

DEFAULT_PROOF_HEADER = "X-Agent-Proof"
DEFAULT_ISSUER = "imrobot"
DEFAULT_TOKEN_TTL_MS = 3_600_000


def _default_agent_id(_request: Any, challenge: SignedChallenge) -> str:
    return f"agent_{fnv1a(challenge['id'] + ':' + str(challenge['timestamp']))}"


def _import_fastapi() -> Any:
    try:
        import fastapi as _fastapi  # type: ignore[import-not-found]
        from fastapi import responses as _responses  # type: ignore[import-not-found]
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "FastAPI is required for imrobot.fastapi. Install with: pip install 'imrobot[fastapi]'"
        ) from exc
    return _fastapi, _responses


def create_imrobot_router(
    *,
    secret: str,
    difficulty: Difficulty = "medium",
    ttl: Optional[int] = None,
    replay_guard: Optional[ChallengeReplayGuard] = None,
    proof_header: str = DEFAULT_PROOF_HEADER,
    issuer_name: str = DEFAULT_ISSUER,
    token_ttl_ms: int = DEFAULT_TOKEN_TTL_MS,
    agent_id_from: Optional[Callable[[Any, SignedChallenge], str]] = None,
) -> Any:
    """Build a FastAPI ``APIRouter`` with GET /challenge and POST /verify."""
    _fastapi, _responses = _import_fastapi()
    APIRouter = _fastapi.APIRouter
    Request = _fastapi.Request
    JSONResponse = _responses.JSONResponse

    verifier = ImRobotVerifier(
        secret=secret, difficulty=difficulty, ttl=ttl, replay_guard=replay_guard
    )
    token_issuer = ProofTokenIssuer(
        secret=secret, issuer=issuer_name, token_ttl_ms=token_ttl_ms
    )
    resolve_agent_id = agent_id_from or _default_agent_id

    router = APIRouter()

    @router.get("/challenge")
    async def challenge_route() -> Any:
        signed = await verifier.generate()
        return signed

    async def verify_route(request) -> Any:
        try:
            body = await request.json()
        except Exception:
            return JSONResponse(
                status_code=400, content={"valid": False, "reason": "invalid_json"}
            )
        challenge_obj = body.get("challenge") if isinstance(body, dict) else None
        answer = body.get("answer") if isinstance(body, dict) else None
        if not challenge_obj or not isinstance(answer, str):
            return JSONResponse(
                status_code=400, content={"valid": False, "reason": "missing_fields"}
            )
        result = await verifier.verify(challenge_obj, answer)
        if not result.get("valid"):
            return JSONResponse(status_code=400, content=result)
        token = await token_issuer.issue(
            agent_id=resolve_agent_id(request, challenge_obj),
            challenge_id=challenge_obj["id"],
            difficulty=challenge_obj["difficulty"],
            solve_time_ms=result.get("elapsed", 0),
            suspicious=result.get("suspicious", False),
        )
        response = JSONResponse(content={**result, "proofToken": token})
        response.headers[proof_header] = token
        return response

    # Explicit annotation binding so FastAPI DI treats `request` as the
    # Request object (not a body model). Closure-scoped imports would
    # otherwise be invisible to FastAPI's signature inspection.
    verify_route.__annotations__["request"] = Request
    router.add_api_route("/verify", verify_route, methods=["POST"])

    return router


def require_agent(
    *,
    secret: str,
    header_name: str = DEFAULT_PROOF_HEADER,
    issuer_name: str = DEFAULT_ISSUER,
    clock_skew_sec: int = 5,
    key_id: Optional[str] = None,
    previous_secrets: Optional[list[dict[str, str]]] = None,
    bypass: Optional[Callable[[Any], Awaitable[bool]]] = None,
) -> Callable[..., Awaitable[dict[str, Any]]]:
    """FastAPI dependency that enforces a valid ``X-Agent-Proof`` token.

    Returns the decoded JWT payload as a dict — inject with ``Depends``.
    """
    _fastapi, _ = _import_fastapi()
    HTTPException = _fastapi.HTTPException
    Request = _fastapi.Request

    token_issuer = ProofTokenIssuer(
        secret=secret,
        issuer=issuer_name,
        clock_skew_sec=clock_skew_sec,
        key_id=key_id,
        previous_secrets=previous_secrets,
    )

    async def _dep(request: Request) -> dict[str, Any]:  # type: ignore[valid-type]
        if bypass is not None:
            skip = await bypass(request)
            if skip:
                return {"agent_verified": True, "bypassed": True}
        token = request.headers.get(header_name)
        if not token:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "agent_proof_required",
                    "message": f"Missing {header_name} header — call /imrobot/verify first.",
                },
            )
        result = await token_issuer.verify(token)
        if not result.get("valid") or "payload" not in result:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "agent_proof_invalid",
                    "reason": result.get("reason", "unknown"),
                },
            )
        return dict(result["payload"])

    # Explicit annotation binding so FastAPI's DI knows this parameter is
    # the request object, not a body model — same fix pattern as verify_route.
    _dep.__annotations__["request"] = Request
    return _dep
