"""imrobot.gate: the Python agent client, against a real local HTTP site."""

from __future__ import annotations

import asyncio
import json
import time
from http.server import BaseHTTPRequestHandler
from typing import Any

import pytest

from imrobot.gate import (
    DEFAULT_PROOF_HEADER,
    GateError,
    apass_gate,
    pass_gate,
    pass_gate_tool,
    solve_challenge_input,
    solve_challenge_tool,
)

from ._site import Site


def _local(url: str, **kw: Any):
    return pass_gate(url, allow_private_hosts=True, timeout=5.0, **kw)


async def _verify_token(site: Site, token: str) -> dict[str, Any]:
    return dict(await site.issuer.verify(token))


def test_default_endpoints(site: Site) -> None:
    r = _local(site.url + "/some/page?x=1")
    assert r.source == "default"
    assert r.proof_header == DEFAULT_PROOF_HEADER
    assert r.challenge_url == site.url + "/imrobot/challenge"
    assert r.difficulty == "easy"
    assert isinstance(r.elapsed, int)
    assert asyncio.run(_verify_token(site, r.proof_token))["valid"] is True


def test_discovery_document(site: Site) -> None:
    site.prefix = "/gate"
    site.discovery = {
        "protocol": "imrobot",
        "endpoints": {"challenge": "/gate/challenge", "verify": "/gate/verify", "proofHeader": "X-Bot-Proof"},
    }
    r = _local(site.url)
    assert (r.source, r.proof_header) == ("discovery", "X-Bot-Proof")
    assert r.verify_url == site.url + "/gate/verify"


def test_bad_proof_header_falls_back(site: Site) -> None:
    site.discovery = {
        "protocol": "imrobot",
        "endpoints": {"challenge": "/imrobot/challenge", "verify": "/imrobot/verify", "proofHeader": "X\r\nInjected: 1"},
    }
    assert _local(site.url).proof_header == DEFAULT_PROOF_HEADER


@pytest.mark.parametrize(
    "endpoint",
    ["https://evil.example/c", "//evil.example/c", "/\\evil.example/c", "c", 5, "/ok\t/c"],
)
def test_cross_origin_discovery_refused(site: Site, endpoint: Any) -> None:
    site.discovery = {"protocol": "imrobot", "endpoints": {"challenge": endpoint, "verify": "/imrobot/verify"}}
    with pytest.raises(GateError) as e:
        _local(site.url)
    assert e.value.code == "bad_response"
    assert not any(p.startswith("http") for _, p, _ in site.seen[1:])


def test_direct_challenge_url_and_agent_id(site: Site) -> None:
    site.prefix = "/api/bot"
    r = _local(site.url + "/api/bot/challenge", agent_id="agent-7")
    assert r.source == "url"
    assert r.verify_url == site.url + "/api/bot/verify"
    posted = [b for m, _, b in site.seen if m == "POST"][0]
    assert posted["agentId"] == "agent-7"
    assert not any(p == "/.well-known/imrobot.json" for _, p, _ in site.seen)


def test_private_hosts_refused_by_default(site: Site) -> None:
    for url in (site.url, "http://localhost/x", "http://10.0.0.1/", "http://[::1]/", "http://169.254.169.254/"):
        with pytest.raises(GateError) as e:
            pass_gate(url)
        assert e.value.code == "private_host"
    assert site.seen == []


@pytest.mark.parametrize(
    "url", ["ftp://site.example/", "file:///etc/passwd", "not a url", "https://user:pw@site.example/", "http://h:99999/", ""]
)
def test_invalid_urls(url: str) -> None:
    with pytest.raises(GateError) as e:
        pass_gate(url)
    assert e.value.code == "invalid_url"


def test_rejected_answer_carries_reason(site: Site) -> None:
    site.overrides["/imrobot/verify"] = lambda h: h._send(400, {"valid": False, "reason": "expired"})  # type: ignore[attr-defined]
    with pytest.raises(GateError) as e:
        _local(site.url)
    assert (e.value.code, e.value.reason, e.value.status) == ("rejected", "expired", 400)


def test_redirects_are_not_followed(site: Site) -> None:
    def redirect(h: BaseHTTPRequestHandler) -> None:
        h.send_response(302)
        h.send_header("Location", "http://169.254.169.254/latest/meta-data")
        h.send_header("Content-Length", "0")
        h.end_headers()

    site.overrides["/imrobot/challenge"] = redirect
    with pytest.raises(GateError) as e:
        _local(site.url)
    assert (e.value.code, e.value.status) == ("bad_response", 302)


def test_size_cap_streaming_and_declared(site: Site) -> None:
    def endless(h: BaseHTTPRequestHandler) -> None:
        h.send_response(200)
        h.send_header("Content-Type", "application/json")
        h.end_headers()
        try:
            for _ in range(200):
                h.wfile.write(b" " * 4096)
        except OSError:
            pass

    site.overrides["/imrobot/challenge"] = endless
    with pytest.raises(GateError, match="too large"):
        _local(site.url)

    def declared(h: BaseHTTPRequestHandler) -> None:
        h.send_response(200)
        h.send_header("Content-Length", str(10 * 1024 * 1024))
        h.end_headers()

    site.overrides["/imrobot/challenge"] = declared
    with pytest.raises(GateError, match="too large"):
        _local(site.url)


def test_timeout(site: Site) -> None:
    site.overrides["/imrobot/challenge"] = lambda h: time.sleep(1.5)
    t0 = time.monotonic()
    with pytest.raises(GateError) as e:
        pass_gate(site.url, allow_private_hosts=True, timeout=0.3)
    assert e.value.code == "timeout"
    assert time.monotonic() - t0 < 1.4


def test_non_challenge_body(site: Site) -> None:
    site.overrides["/imrobot/challenge"] = lambda h: h._send(200, {"hello": "world"})  # type: ignore[attr-defined]
    with pytest.raises(GateError) as e:
        _local(site.url)
    assert e.value.code == "bad_response"


def test_network_error() -> None:
    s = Site()
    url = s.url
    s.close()
    with pytest.raises(GateError) as e:
        pass_gate(url, allow_private_hosts=True, timeout=8.0)  # Windows retries refused SYNs ~2 s
    assert e.value.code == "network"


def test_solve_challenge_input_and_tools(site: Site) -> None:
    challenge = asyncio.run(site.verifier.generate())
    answer = solve_challenge_input(json.dumps(challenge))
    assert asyncio.run(site.verifier.verify(challenge, answer))["valid"] is True
    assert json.loads(solve_challenge_tool(challenge)) == {"answer": answer}
    assert json.loads(solve_challenge_tool("{nope"))["error"] == "bad_response"
    bad = {**challenge, "pipeline": [{"op": "launch_missiles"}]}
    assert json.loads(solve_challenge_tool(bad))["error"] == "unsupported_challenge"

    out = json.loads(pass_gate_tool(site.url, allow_private_hosts=True))
    assert out["proofHeader"] == DEFAULT_PROOF_HEADER and isinstance(out["proofToken"], str)
    refused = json.loads(pass_gate_tool(site.url))
    assert refused["error"] == "private_host"


async def test_async_pass_gate(site: Site) -> None:
    r = await apass_gate(site.url, allow_private_hosts=True)
    assert r.source == "default"
