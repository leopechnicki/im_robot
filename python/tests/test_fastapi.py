"""End-to-end tests for the FastAPI middleware — challenge, verify, gated route."""

from __future__ import annotations

import pytest

fastapi = pytest.importorskip("fastapi")
starlette = pytest.importorskip("starlette")
httpx = pytest.importorskip("httpx")

from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from imrobot import solve_challenge
from imrobot.fastapi import create_imrobot_router, require_agent

SECRET = "test-secret-at-least-sixteen-chars-ok"


def _build_app(bypass=None) -> FastAPI:
    app = FastAPI()
    router = create_imrobot_router(secret=SECRET, difficulty="easy")
    app.include_router(router, prefix="/imrobot")

    guard = require_agent(secret=SECRET, bypass=bypass) if bypass else require_agent(secret=SECRET)

    @app.get("/protected")
    async def protected(payload: dict = Depends(guard)):
        return {"ok": True, "sub": payload.get("sub")}

    @app.get("/public")
    async def public():
        return {"ok": True}

    return app


async def _client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestRouter:
    async def test_challenge_endpoint_returns_signed_challenge(self):
        app = _build_app()
        async with await _client(app) as c:
            r = await c.get("/imrobot/challenge")
        assert r.status_code == 200
        body = r.json()
        assert body["version"] == 1
        assert "hmac" in body
        assert len(body["pipeline"]) >= 2

    async def test_verify_success_returns_proof_token(self):
        app = _build_app()
        async with await _client(app) as c:
            r1 = await c.get("/imrobot/challenge")
            challenge = r1.json()
            answer = solve_challenge(challenge)
            r2 = await c.post("/imrobot/verify", json={"challenge": challenge, "answer": answer})
        assert r2.status_code == 200
        body = r2.json()
        assert body["valid"] is True
        assert "proofToken" in body
        assert body["proofToken"].count(".") == 2
        assert r2.headers.get("X-Agent-Proof") == body["proofToken"]

    async def test_verify_missing_fields_400(self):
        app = _build_app()
        async with await _client(app) as c:
            r = await c.post("/imrobot/verify", json={"garbage": True})
        assert r.status_code == 400
        assert r.json()["reason"] == "missing_fields"

    async def test_verify_invalid_json_400(self):
        app = _build_app()
        async with await _client(app) as c:
            r = await c.post(
                "/imrobot/verify",
                content=b"not json",
                headers={"content-type": "application/json"},
            )
        assert r.status_code == 400
        assert r.json()["reason"] == "invalid_json"

    async def test_verify_wrong_answer_400(self):
        app = _build_app()
        async with await _client(app) as c:
            r1 = await c.get("/imrobot/challenge")
            challenge = r1.json()
            r2 = await c.post("/imrobot/verify", json={"challenge": challenge, "answer": "nope"})
        assert r2.status_code == 400
        body = r2.json()
        assert body["valid"] is False


class TestRequireAgent:
    async def test_missing_header_401(self):
        app = _build_app()
        async with await _client(app) as c:
            r = await c.get("/protected")
        assert r.status_code == 401
        assert r.json()["detail"]["error"] == "agent_proof_required"

    async def test_invalid_token_401(self):
        app = _build_app()
        async with await _client(app) as c:
            r = await c.get("/protected", headers={"X-Agent-Proof": "junk.junk.junk"})
        assert r.status_code == 401
        assert r.json()["detail"]["error"] == "agent_proof_invalid"

    async def test_valid_token_passes_gate(self):
        app = _build_app()
        async with await _client(app) as c:
            r1 = await c.get("/imrobot/challenge")
            challenge = r1.json()
            answer = solve_challenge(challenge)
            r2 = await c.post("/imrobot/verify", json={"challenge": challenge, "answer": answer})
            token = r2.json()["proofToken"]
            r3 = await c.get("/protected", headers={"X-Agent-Proof": token})
        assert r3.status_code == 200
        assert r3.json()["ok"] is True
        assert r3.json()["sub"].startswith("agent_")

    async def test_bypass_function_short_circuits(self):
        async def _bypass(_request):
            return True

        app = _build_app(bypass=_bypass)
        async with await _client(app) as c:
            r = await c.get("/protected")
        assert r.status_code == 200
        assert r.json()["ok"] is True
