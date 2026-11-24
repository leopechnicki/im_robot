"""Web Bot Auth (Python): draft -01 vectors, signer round trip, hardening, FastAPI policy.

Vectors match test/web-bot-auth-vectors.test.ts byte for byte: draft-ietf-webbotauth-
httpsig-protocol-01 Appendix E.2.1 / E.2.2 / E.2.3 and the cloudflare/web-bot-auth
fixture web_bot_auth_architecture_v2.json, all signed with the RFC 9421 B.1.4 test key.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

pytest.importorskip("cryptography")

from imrobot import web_bot_auth as wba
from imrobot._sf import StructuredFieldError, parse_dictionary, serialize_member
from imrobot.agent import (
    build_key_directory,
    generate_agent_key,
    key_directory_response,
    sign_directory_response,
    sign_request,
)
from imrobot.web_bot_auth import (
    DirectoryResponse,
    SignedHttpRequest,
    WebBotAuthVerifier,
    build_signature_base,
    is_private_host,
    jwk_thumbprint,
    parse_signature_input,
    verify_directory_response,
)

TEST_KEY = {
    "kty": "OKP",
    "crv": "Ed25519",
    "kid": "test-key-ed25519",
    "d": "n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU",
    "x": "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
}
THUMB = "poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U"
CREATED = 1735689600
NONCE_21 = (
    "n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA=="
)

E21 = {
    "agent": 'sig2="https://signature-agent.test"',
    "input": (
        'sig2=("@authority" "signature-agent";key="sig2");created=1735689600;'
        f'keyid="{THUMB}";alg="ed25519";expires=4889289600;nonce="{NONCE_21}";tag="web-bot-auth"'
    ),
    "signature": "sig2=:CGokAoY/FrPpyuzTe1Fb2kLTAH9Idw6qSFd1+D77r1firsMRCxeuLu5e6O+ek3zQgDMAzjiXtLVfqE00xnABCQ==:",
}
E21_BASE = "\n".join(
    [
        '"@authority": example.com',
        '"signature-agent";key="sig2": "https://signature-agent.test"',
        '"@signature-params": ' + E21["input"][len("sig2=") :],
    ]
)
E22 = {
    "agent": '"https://signature-agent.test"',
    "input": (
        'sig2=("@authority" "signature-agent");created=1735689600;'
        f'keyid="{THUMB}";alg="ed25519";expires=1735693200;'
        'nonce="e8N7S2MFd/qrd6T2R3tdfAuuANngKI7LFtKYI/vowzk4lAZYadIX6wW25MwG7DCT9RUKAJ0qVkU0mEeLElW1qg==";'
        'tag="web-bot-auth"'
    ),
    "signature": "sig2=:jdq0SqOwHdyHr9+r5jw3iYZH6aNGKijYp/EstF4RQTQdi5N5YYKrD+mCT1HA1nZDsi6nJKuHxUi/5Syp3rLWBA==:",
}
CF_V2 = {
    "agent": 'agent2="https://signature-agent.test"',
    "input": (
        'sig2=("@authority" "signature-agent";key="agent2");created=1735689600;'
        f'keyid="{THUMB}";alg="ed25519";expires=4889289600;nonce="{NONCE_21}";tag="web-bot-auth"'
    ),
    "signature": "sig2=:RdNFx5Bj6au3YgAMQL/RzmUlZE8QZLIaXGRpw985hWnwPfMxT228NMk6ehRS1PSl4e8PhbNZACSanGdhEwYCCg==:",
}
E23 = {
    "body": (
        '{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U",'
        '"x":"JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs","use":"sig"}]}'
    ),
    "digest": "sha-256=:CADMT2aBdV/rqQr/NIru64ERQkCobVvllA4V0fLFDu0=:",
    "input": (
        'binding=("@authority";req "content-digest");created=1735689600;expires=4889289600;'
        f'keyid="{THUMB}";tag="http-message-signatures-directory"'
    ),
    "signature": "binding=:l6P8R67tm3kujAxbHWio7ll01qrEZ0dKD/WWlGhNYEmTnFZM8Wt0VQ9zqGfvo7T/UMkBxsigzChM1Gpz7gOVBg==:",
}


def directory_fetch(body: str = E23["body"], headers: dict[str, str] | None = None):
    calls: list[str] = []

    def f(url: str) -> DirectoryResponse:
        calls.append(url)
        return DirectoryResponse(
            200, headers or {"content-type": "application/json"}, body.encode()
        )

    return f, calls


def req(agent: str, inp: str, sig: str) -> SignedHttpRequest:
    return SignedHttpRequest(
        method="POST",
        url="/foo?param=Value&Pet=dog",
        headers={
            "host": "example.com",
            "signature-agent": agent,
            "signature-input": inp,
            "signature": sig,
        },
    )


def verifier(fetch: Any, **extra: Any) -> WebBotAuthVerifier:
    opts: dict[str, Any] = {
        "trusted_signature_agents": ["https://signature-agent.test"],
        "reject_test_keys": False,
        "now": lambda: CREATED,
        "fetch": fetch,
    }
    opts.update(extra)
    return WebBotAuthVerifier(**opts)


# --- structured fields ------------------------------------------------------


def test_sf_dictionary_keeps_raw_member_text() -> None:
    d = parse_dictionary('a=("x" "y";key="b");created=1, b="s", c')
    assert d["a"].raw == '("x" "y";key="b");created=1'
    assert serialize_member(d["b"]) == '"s"'
    assert d["c"].value is True


def test_sf_rejects_garbage() -> None:
    for bad in ['a="unterminated', "a=1,", "A=1", "a=(1 2"]:
        with pytest.raises(StructuredFieldError):
            parse_dictionary(bad)


# --- thumbprints + vectors --------------------------------------------------


def test_thumbprints() -> None:
    assert jwk_thumbprint(TEST_KEY) == THUMB
    rfc8037 = {"kty": "OKP", "crv": "Ed25519", "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"}
    assert jwk_thumbprint(rfc8037) == "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k"


def test_e21_exact_signature_base() -> None:
    parsed = parse_signature_input(E21["input"])
    assert parsed is not None
    assert (
        build_signature_base(parsed, req(E21["agent"], E21["input"], E21["signature"])) == E21_BASE
    )


async def test_e21_verifies_via_well_known() -> None:
    f, calls = directory_fetch()
    r = await verifier(f).verify(req(E21["agent"], E21["input"], E21["signature"]))
    assert r.verified and r.outcome == "verified" and r.keyid == THUMB and r.label == "sig2"
    assert calls == ["https://signature-agent.test/.well-known/http-message-signatures-directory"]


def test_signer_reproduces_e21() -> None:
    h = sign_request(
        "POST",
        "https://example.com/foo?param=Value&Pet=dog",
        private_jwk=TEST_KEY,
        signature_agent="https://signature-agent.test",
        label="sig2",
        created=CREATED,
        expires=4889289600,
        nonce=NONCE_21,
    )
    assert h["Signature-Agent"] == E21["agent"]
    assert h["Signature-Input"] == E21["input"]
    assert h["Signature"] == E21["signature"]


async def test_test_key_rejected_by_default() -> None:
    f, _ = directory_fetch()
    r = await verifier(f, reject_test_keys=True).verify(
        req(E21["agent"], E21["input"], E21["signature"])
    )
    assert not r.verified and r.reason == "test_key" and r.outcome == "invalid"


async def test_changed_authority_is_bad_signature() -> None:
    f, _ = directory_fetch()
    r0 = req(E21["agent"], E21["input"], E21["signature"])
    r0.headers = {**r0.headers, "host": "evil.example"}
    r = await verifier(f).verify(r0)
    assert r.reason == "bad_signature"


async def test_replayed_nonce() -> None:
    f, _ = directory_fetch()
    v = verifier(f)
    assert (await v.verify(req(E21["agent"], E21["input"], E21["signature"]))).verified
    r = await v.verify(req(E21["agent"], E21["input"], E21["signature"]))
    assert r.reason == "replayed_nonce"


async def test_timing_windows() -> None:
    f, _ = directory_fetch()
    early = await verifier(f, now=lambda: CREATED - 120).verify(
        req(E21["agent"], E21["input"], E21["signature"])
    )
    assert early.reason == "not_yet_valid"
    f2, _ = directory_fetch()
    late = await verifier(f2, now=lambda: CREATED + 7200).verify(
        req(E22["agent"], E22["input"], E22["signature"])
    )
    assert late.reason == "expired"


async def test_e22_legacy_string_form() -> None:
    f, _ = directory_fetch()
    r = await verifier(f).verify(req(E22["agent"], E22["input"], E22["signature"]))
    assert r.verified


async def test_cloudflare_fixture() -> None:
    f, _ = directory_fetch()
    r = await verifier(f).verify(req(CF_V2["agent"], CF_V2["input"], CF_V2["signature"]))
    assert r.verified


async def test_well_known_kid_must_be_thumbprint() -> None:
    body = json.dumps(
        {"keys": [{**{k: TEST_KEY[k] for k in ("kty", "crv", "x")}, "kid": "test-key-ed25519"}]}
    )
    f, _ = directory_fetch(body)
    r = await verifier(f).verify(req(E21["agent"], E21["input"], E21["signature"]))
    assert r.reason == "unknown_key"


def test_e23_directory_signature() -> None:
    headers = {
        "content-digest": E23["digest"],
        "signature-input": E23["input"],
        "signature": E23["signature"],
    }
    ok = verify_directory_response(
        body=E23["body"],
        headers=headers,
        authority="signature-agent.test",
        keys={THUMB: TEST_KEY["x"]},
        now=CREATED,
    )
    assert ok == {THUMB}
    bad = verify_directory_response(
        body=E23["body"] + " ",
        headers=headers,
        authority="signature-agent.test",
        keys={THUMB: TEST_KEY["x"]},
        now=CREATED,
    )
    assert bad == set()


def test_directory_signer_reproduces_e23() -> None:
    h = sign_directory_response(
        E23["body"],
        private_jwks=[TEST_KEY],
        authority="signature-agent.test",
        created=CREATED,
        expires_in_seconds=4889289600 - CREATED,
    )
    assert h == {
        "Content-Digest": E23["digest"],
        "Signature-Input": E23["input"],
        "Signature": E23["signature"],
    }


# --- signer round trip ------------------------------------------------------

AGENT = "https://agent.example"
SITE = "https://site.example/api/data?x=1"


def agent_host(key: Any, signed: bool = True):
    calls: list[str] = []

    def f(url: str) -> DirectoryResponse:
        calls.append(url)
        body, headers = key_directory_response([key.private_jwk], authority="agent.example")
        if not signed:
            headers = {"Content-Type": "application/json"}
        return DirectoryResponse(200, {k.lower(): v for k, v in headers.items()}, body.encode())

    return f, calls


def signed_req(key: Any, url: str = SITE, **extra: Any) -> SignedHttpRequest:
    h = sign_request("GET", url, private_jwk=key.private_jwk, signature_agent=AGENT, **extra)
    return SignedHttpRequest(
        method="GET",
        url="/api/data?x=1",
        headers={"host": "site.example", **{k.lower(): v for k, v in h.items()}},
    )


async def test_round_trip_with_signed_directory() -> None:
    key = generate_agent_key()
    assert key.public_jwk["kid"] == key.keyid and "d" not in key.public_jwk
    f, calls = agent_host(key)
    v = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f, require_signed_directory=True)
    r = await v.verify(signed_req(key))
    assert r.verified and r.keyid == key.keyid and r.agent == f"{AGENT}/"
    assert calls[0] == f"{AGENT}/.well-known/http-message-signatures-directory"


async def test_unsigned_directory_with_require_signed_is_unknown_key() -> None:
    key = generate_agent_key()
    f, _ = agent_host(key, signed=False)
    v = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f, require_signed_directory=True)
    assert (await v.verify(signed_req(key))).reason == "unknown_key"


async def test_rogue_key_is_unknown() -> None:
    published, rogue = generate_agent_key(), generate_agent_key()
    f, _ = agent_host(published)
    v = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f)
    r = await v.verify(signed_req(rogue))
    assert r.reason == "unknown_key" and r.outcome == "unverified"


async def test_ts_and_python_signers_agree_with_extra_components() -> None:
    key = generate_agent_key()
    f, _ = agent_host(key)
    v = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f)
    h = sign_request(
        "POST",
        SITE,
        {"content-type": "application/json"},
        private_jwk=key.private_jwk,
        signature_agent=AGENT,
        components=["@method", "@path", "content-type"],
    )
    base = {
        "host": "site.example",
        "content-type": "application/json",
        **{k.lower(): x for k, x in h.items()},
    }
    assert (
        await v.verify(SignedHttpRequest(method="POST", url="/api/data?x=1", headers=base))
    ).verified
    v2 = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f)
    r = await v2.verify(SignedHttpRequest(method="PUT", url="/api/data?x=1", headers=base))
    assert r.reason == "bad_signature"


def test_build_key_directory_has_no_private_material() -> None:
    key = generate_agent_key()
    assert key.private_jwk["d"] not in json.dumps(build_key_directory([key.private_jwk]))


# --- hardening ---------------------------------------------------------------


async def test_redirect_is_directory_error() -> None:
    key = generate_agent_key()

    def f(url: str) -> DirectoryResponse:
        return DirectoryResponse(302, {"location": "https://evil.example/"}, b"")

    r = await WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f).verify(signed_req(key))
    assert r.reason == "directory_error" and r.outcome == "unverified"


async def test_oversized_directory() -> None:
    key = generate_agent_key()
    huge = json.dumps({"keys": [key.public_jwk], "pad": "x" * 70_000}).encode()

    def f(url: str) -> DirectoryResponse:
        return DirectoryResponse(200, {}, huge)

    r = await WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f).verify(signed_req(key))
    assert r.reason == "directory_error"


async def test_failed_refetch_keeps_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1_800_000_000.0]
    monkeypatch.setattr(wba.time, "time", lambda: clock[0])
    key = generate_agent_key()
    state = {"up": True, "n": 0}
    good, _ = agent_host(key)

    def f(url: str) -> DirectoryResponse:
        state["n"] += 1
        return good(url) if state["up"] else DirectoryResponse(503, {}, b"down")

    v = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f, nonce_store=False)
    assert (await v.verify(signed_req(key, created=int(clock[0])))).verified
    state["up"] = False
    clock[0] += 7200
    assert (await v.verify(signed_req(key, created=int(clock[0])))).verified
    assert state["n"] == 2


async def test_negative_cache() -> None:
    key = generate_agent_key()
    n = [0]

    def f(url: str) -> DirectoryResponse:
        n[0] += 1
        return DirectoryResponse(503, {}, b"")

    v = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f)
    await v.verify(signed_req(key))
    await v.verify(signed_req(key))
    assert n[0] == 1


async def test_async_fetch_supported() -> None:
    key = generate_agent_key()
    sync, _ = agent_host(key)

    async def f(url: str) -> DirectoryResponse:
        return sync(url)

    assert (
        await WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f).verify(signed_req(key))
    ).verified


def test_is_private_host() -> None:
    for h in [
        "localhost",
        "127.0.0.1",
        "10.1.2.3",
        "192.168.0.1",
        "172.16.5.4",
        "169.254.169.254",
        "[::1]",
        "fd00::1",
        "printer.local",
        "svc.internal",
        "0.0.0.0",
        "100.64.0.1",
        "::ffff:127.0.0.1",
    ]:
        assert is_private_host(h), h
    for h in ["agent.example", "8.8.8.8", "172.32.0.1", "example.com"]:
        assert not is_private_host(h), h


async def test_allow_any_refuses_private_hosts() -> None:
    key = generate_agent_key()
    fetched = []

    def f(url: str) -> DirectoryResponse:
        fetched.append(url)
        return DirectoryResponse(200, {}, b"{}")

    h = sign_request(
        "GET", SITE, private_jwk=key.private_jwk, signature_agent="https://169.254.169.254"
    )
    r = await WebBotAuthVerifier(allow_any_signature_agent=True, fetch=f).verify(
        SignedHttpRequest(headers={"host": "site.example", **{k.lower(): x for k, x in h.items()}})
    )
    assert r.reason == "untrusted_agent" and not fetched


async def test_untrusted_agent_never_fetched() -> None:
    key = generate_agent_key()
    fetched = []

    def f(url: str) -> DirectoryResponse:
        fetched.append(url)
        return DirectoryResponse(200, {}, b"{}")

    r = await WebBotAuthVerifier(
        trusted_signature_agents=["https://other.example"], fetch=f
    ).verify(signed_req(key))
    assert r.reason == "untrusted_agent" and not fetched


def test_requires_key_source() -> None:
    with pytest.raises(ValueError):
        WebBotAuthVerifier()
    with pytest.raises(ValueError):
        WebBotAuthVerifier(trusted_signature_agents=["http://insecure.example"])


async def test_no_signature_is_unverified() -> None:
    r = await WebBotAuthVerifier(trusted_signature_agents=[AGENT]).verify(
        SignedHttpRequest(headers={})
    )
    assert (r.verified, r.outcome, r.reason) == (False, "unverified", "no_signature")


async def test_missing_params() -> None:
    key = generate_agent_key()
    f, _ = agent_host(key)
    v = WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f)
    r0 = signed_req(key)
    inp = r0.headers["signature-input"]
    no_tag = {**r0.headers, "signature-input": inp.replace(';tag="web-bot-auth"', "")}
    assert (
        await WebBotAuthVerifier(
            trusted_signature_agents=[AGENT], fetch=f, expected_tag=None
        ).verify(SignedHttpRequest(headers=no_tag))
    ).reason == "missing_param"
    no_auth = {**r0.headers, "signature-input": inp.replace('"@authority" ', "")}
    assert (await v.verify(SignedHttpRequest(headers=no_auth))).reason == "missing_authority"


# --- FastAPI policy ----------------------------------------------------------


def test_fastapi_require_agent_web_bot_auth() -> None:
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from imrobot.fastapi import require_agent

    key = generate_agent_key()
    f, _ = agent_host(key)
    app = fastapi.FastAPI()
    dep = require_agent(
        secret="k" * 32, web_bot_auth=WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f)
    )

    @app.get("/api/data")
    async def data(agent: dict = fastapi.Depends(dep)) -> dict:
        return agent

    client = TestClient(app, base_url="https://site.example")
    h = sign_request(
        "GET", "https://site.example/api/data", private_jwk=key.private_jwk, signature_agent=AGENT
    )
    ok = client.get("/api/data", headers=h)
    assert ok.status_code == 200, ok.text
    assert ok.json()["agent_verified"] is True
    assert ok.json()["web_bot_auth"]["keyid"] == key.keyid

    unsigned = client.get("/api/data")
    assert unsigned.status_code == 401
    assert unsigned.headers["accept-signature"] == wba.WEB_BOT_AUTH_ACCEPT_SIGNATURE

    forged = dict(h)
    forged["Signature"] = forged["Signature"].replace("=:", "=:AA", 1)
    assert client.get("/api/data", headers=forged).status_code == 401


def test_fastapi_accept_veto() -> None:
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from imrobot.fastapi import require_agent

    key = generate_agent_key()
    f, _ = agent_host(key)
    app = fastapi.FastAPI()
    dep = require_agent(
        secret="k" * 32,
        web_bot_auth=WebBotAuthVerifier(trusted_signature_agents=[AGENT], fetch=f),
        web_bot_auth_accept=lambda r: False,
    )

    @app.get("/x")
    async def x(agent: dict = fastapi.Depends(dep)) -> dict:
        return agent

    h = sign_request(
        "GET", "https://site.example/x", private_jwk=key.private_jwk, signature_agent=AGENT
    )
    assert TestClient(app, base_url="https://site.example").get("/x", headers=h).status_code == 401
