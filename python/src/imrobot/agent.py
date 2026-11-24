"""Web Bot Auth signing client: make your agent's requests verifiable.

Python mirror of the npm ``imrobot/agent`` entry point
(draft-ietf-webbotauth-httpsig-protocol-01):

    >>> from imrobot.agent import generate_agent_key, sign_request, build_key_directory
    >>> key = generate_agent_key()                       # keep key.private_jwk secret
    >>> directory = build_key_directory([key.private_jwk])
    >>> # serve `directory` at https://agent.example/.well-known/http-message-signatures-directory
    >>> headers = sign_request("GET", "https://site.example/api",
    ...                        private_jwk=key.private_jwk,
    ...                        signature_agent="https://agent.example")
    >>> httpx.get("https://site.example/api", headers=headers)

Needs the ``cryptography`` package: ``pip install "imrobot[wba]"``.
"""

from __future__ import annotations

import base64
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Mapping, Optional, Union
from urllib.parse import urlsplit

from . import _sf
from .web_bot_auth import (
    DIRECTORY_MEDIA_TYPE,
    DIRECTORY_TAG,
    WELL_KNOWN_DIRECTORY_PATH,
    _require_cryptography,
    b64decode_any,
    b64url,
    content_digest,
    jwk_thumbprint,
)

WEB_BOT_AUTH_TAG = "web-bot-auth"
DEFAULT_EXPIRES_IN_SECONDS = 60
MAX_EXPIRES_IN_SECONDS = 86_400
_LABEL_RE = re.compile(r"^[a-z*][a-z0-9_\-.*]*$")


@dataclass
class AgentKey:
    private_jwk: dict[str, str]
    public_jwk: dict[str, str]
    keyid: str


def generate_agent_key() -> AgentKey:
    """New Ed25519 key. ``kid`` is the RFC 7638 thumbprint (the WBA ``keyid``)."""
    ed25519 = _require_cryptography()
    from cryptography.hazmat.primitives import serialization

    priv = ed25519.Ed25519PrivateKey.generate()
    d = priv.private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
    )
    x = priv.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    public = {"kty": "OKP", "crv": "Ed25519", "x": b64url(x)}
    keyid = jwk_thumbprint(public)
    public_jwk = {**public, "kid": keyid, "use": "sig"}
    return AgentKey(private_jwk={**public_jwk, "d": b64url(d)}, public_jwk=public_jwk, keyid=keyid)


def to_public_jwk(jwk: Mapping[str, Any]) -> dict[str, Any]:
    """Public half of a JWK, with ``kid`` set to the thumbprint."""
    out = {"kty": "OKP", "crv": "Ed25519", "x": jwk["x"]}
    out["kid"] = jwk_thumbprint(out)
    out["use"] = "sig"
    for k in ("nbf", "exp"):
        if k in jwk:
            out[k] = jwk[k]
    return out


def build_key_directory(keys: list[Mapping[str, Any]]) -> dict[str, Any]:
    """The JWK Set to publish at ``/.well-known/http-message-signatures-directory``."""
    return {"keys": [to_public_jwk(k) for k in keys]}


def _private_key(jwk: Mapping[str, Any]) -> Any:
    ed25519 = _require_cryptography()
    if jwk.get("kty") != "OKP" or jwk.get("crv") != "Ed25519" or not isinstance(jwk.get("d"), str):
        raise ValueError("imrobot.agent: private_jwk must be an Ed25519 OKP JWK with 'd'")
    return ed25519.Ed25519PrivateKey.from_private_bytes(b64decode_any(jwk["d"]))


def _component_value(name: str, url: str, method: str, headers: Mapping[str, str]) -> str:
    parts = urlsplit(url)
    if name == "@authority":
        host = (parts.hostname or "").lower()
        port = parts.port
        default = {"https": 443, "http": 80}.get(parts.scheme)
        return f"{host}:{port}" if port and port != default else host
    if name == "@method":
        return method.upper()
    if name == "@path":
        return parts.path or "/"
    if name == "@query":
        return f"?{parts.query}"
    if name == "@scheme":
        return parts.scheme.lower()
    if name == "@target-uri":
        return url
    if name.startswith("@"):
        raise ValueError(f"imrobot.agent: unsupported component {name}")
    for k, v in headers.items():
        if k.lower() == name:
            return str(v).strip()
    raise ValueError(f"imrobot.agent: header {name} is not on the request")


def sign_request(
    method: str,
    url: str,
    headers: Optional[Mapping[str, str]] = None,
    *,
    private_jwk: Mapping[str, Any],
    signature_agent: str,
    label: str = "sig1",
    expires_in_seconds: int = DEFAULT_EXPIRES_IN_SECONDS,
    created: Optional[int] = None,
    expires: Optional[int] = None,
    nonce: Union[str, bool, None] = None,
    components: Optional[list[str]] = None,
    include_alg: bool = True,
) -> dict[str, str]:
    """Sign a request; returns ``Signature-Agent``, ``Signature-Input`` and ``Signature``.

    Covers ``@authority`` and the ``Signature-Agent`` member, plus ``components``.
    ``nonce``: None = 64 random bytes, a string = that nonce, False = no nonce.
    """
    if urlsplit(signature_agent).scheme != "https":
        raise ValueError("imrobot.agent: signature_agent must be an https URL")
    if not _LABEL_RE.match(label):
        raise ValueError("imrobot.agent: invalid label")
    created_s = int(time.time()) if created is None else created
    expires_s = (
        created_s + min(expires_in_seconds, MAX_EXPIRES_IN_SECONDS) if expires is None else expires
    )
    nonce_s: Optional[str]
    if nonce is False:
        nonce_s = None
    elif nonce is None or nonce is True:
        nonce_s = base64.b64encode(os.urandom(64)).decode("ascii")
    else:
        nonce_s = nonce
    keyid = jwk_thumbprint(private_jwk)
    hdrs = dict(headers or {})

    agent_member = _sf.serialize_bare_item(signature_agent)
    lines = [f'"@authority": {_component_value("@authority", url, method, hdrs)}']
    ids = ['"@authority"', f'"signature-agent";key="{label}"']
    lines.append(f'"signature-agent";key="{label}": {agent_member}')
    for name in (c.lower() for c in (components or [])):
        if name in ("@authority", "signature-agent"):
            continue
        lines.append(f'"{name}": {_component_value(name, url, method, hdrs)}')
        ids.append(f'"{name}"')

    params = f'({" ".join(ids)});created={created_s};keyid="{keyid}"'
    if include_alg:
        params += ';alg="ed25519"'
    params += f";expires={expires_s}"
    if nonce_s:
        params += f";nonce={_sf.serialize_bare_item(nonce_s)}"
    params += f';tag="{WEB_BOT_AUTH_TAG}"'
    lines.append(f'"@signature-params": {params}')

    sig = _private_key(private_jwk).sign("\n".join(lines).encode("utf-8"))
    return {
        "Signature-Agent": f"{label}={agent_member}",
        "Signature-Input": f"{label}={params}",
        "Signature": f"{label}=:{base64.b64encode(sig).decode('ascii')}:",
    }


def sign_directory_response(
    body: Union[str, bytes],
    *,
    private_jwks: list[Mapping[str, Any]],
    authority: str,
    created: Optional[int] = None,
    expires_in_seconds: int = 86_400,
) -> dict[str, str]:
    """Headers for a signed key-directory response (draft -01 Appendix B.1)."""
    digest = content_digest(body)
    created_s = int(time.time()) if created is None else created
    expires_s = created_s + expires_in_seconds
    inputs: list[str] = []
    sigs: list[str] = []
    for i, jwk in enumerate(private_jwks):
        label = "binding" if len(private_jwks) == 1 else f"binding{i}"
        keyid = jwk_thumbprint(jwk)
        params = (
            f'("@authority";req "content-digest");created={created_s};expires={expires_s};'
            f'keyid="{keyid}";tag="{DIRECTORY_TAG}"'
        )
        base = "\n".join(
            [
                f'"@authority";req: {authority.lower()}',
                f'"content-digest": {digest}',
                f'"@signature-params": {params}',
            ]
        )
        sig = _private_key(jwk).sign(base.encode("utf-8"))
        inputs.append(f"{label}={params}")
        sigs.append(f"{label}=:{base64.b64encode(sig).decode('ascii')}:")
    return {
        "Content-Digest": digest,
        "Signature-Input": ", ".join(inputs),
        "Signature": ", ".join(sigs),
    }


def key_directory_response(
    private_jwks: list[Mapping[str, Any]], *, authority: str, max_age_seconds: int = 3600
) -> tuple[str, dict[str, str]]:
    """``(body, headers)`` for serving your signed key directory from any framework."""
    import json

    body = json.dumps(build_key_directory(private_jwks), separators=(",", ":"))
    headers = {
        "Content-Type": DIRECTORY_MEDIA_TYPE,
        "Cache-Control": f"max-age={max_age_seconds}",
        **sign_directory_response(body, private_jwks=private_jwks, authority=authority),
    }
    return body, headers


__all__ = [
    "DIRECTORY_MEDIA_TYPE",
    "DIRECTORY_TAG",
    "WEB_BOT_AUTH_TAG",
    "WELL_KNOWN_DIRECTORY_PATH",
    "AgentKey",
    "build_key_directory",
    "generate_agent_key",
    "jwk_thumbprint",
    "key_directory_response",
    "sign_directory_response",
    "sign_request",
    "to_public_jwk",
]
