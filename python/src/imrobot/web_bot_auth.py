"""Web Bot Auth: verify HTTP Message Signatures from AI agents.

Python mirror of ``imrobot/server``'s ``WebBotAuthVerifier``. Implements the
verifier side of draft-ietf-webbotauth-httpsig-protocol-01 on top of RFC 9421:

- ``Signature-Agent`` discovery: a Dictionary whose member (keyed by the
  signature label) is an https URL of the agent's JWK Set. The legacy bare
  sf-string form is accepted. Only the covered member is used.
- Key-directory fetch + cache: no redirects, 5 s timeout, 64 kB / 100-key caps,
  ``Cache-Control: max-age`` honoured (clamped 60 s .. 24 h), stale entries
  survive a failed refetch, negative entries expire after 60 s.
- Signature-Input checks: ``tag="web-bot-auth"``, ``created`` and ``expires``
  (both required), ``keyid`` = RFC 7638 JWK thumbprint, optional ``alg`` must be
  ``ed25519``, ``@authority`` (or ``@target-uri``) must be covered.
- ``nonce`` replay check with a pluggable store.
- Optional signed directory responses (draft -01 Appendix B.1).

Needs the ``cryptography`` package for Ed25519: ``pip install "imrobot[wba]"``.

    >>> from imrobot.web_bot_auth import WebBotAuthVerifier, SignedHttpRequest
    >>> verifier = WebBotAuthVerifier(trusted_signature_agents=["https://agent.example"])
    >>> result = await verifier.verify(SignedHttpRequest(method="GET", url="/api",
    ...                                                  headers=dict(request.headers)))
    >>> if result.verified:
    ...     ...  # signed agent: skip the challenge
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import inspect
import ipaddress
import json
import re
import time
import urllib.error
import urllib.request
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Mapping, Optional, Protocol, Union
from urllib.parse import urlsplit, urlunsplit

from . import _sf

DEFAULT_TAG = "web-bot-auth"
DIRECTORY_TAG = "http-message-signatures-directory"
WELL_KNOWN_DIRECTORY_PATH = "/.well-known/http-message-signatures-directory"
DIRECTORY_MEDIA_TYPE = "application/http-message-signatures-directory+json"
#: Value for an ``Accept-Signature`` response header (RFC 9421 5.1, draft -01 5.3).
WEB_BOT_AUTH_ACCEPT_SIGNATURE = (
    'sig1=("@authority" "signature-agent";key="sig1");created;expires;keyid;tag="web-bot-auth"'
)

DEFAULT_MAX_AGE_SECONDS = 86_400
DEFAULT_CLOCK_SKEW_SECONDS = 60
DEFAULT_DIRECTORY_CACHE_SECONDS = 300.0
MIN_DIRECTORY_CACHE_SECONDS = 60.0
MAX_DIRECTORY_CACHE_SECONDS = 86_400.0
NEGATIVE_CACHE_SECONDS = 60.0
UNKNOWN_KEY_REFETCH_SECONDS = 60.0
FETCH_TIMEOUT_SECONDS = 5.0
MAX_DIRECTORY_BYTES = 64_000
MAX_DIRECTORY_KEYS = 100
MAX_CACHED_DIRECTORIES = 256
MAX_SIGNATURE_CANDIDATES = 4

#: Published test keys (RFC 9421 B.1.4, RFC 8037 A.1). Rejected by default (draft -01 6.8).
KNOWN_TEST_KEY_X = frozenset(
    {
        "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
        "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
    }
)

_UNVERIFIED_REASONS = frozenset(
    {"no_signature", "untrusted_agent", "directory_error", "unknown_key"}
)
_ABSOLUTE_URL = re.compile(r"^[a-z][a-z0-9+.\-]*://", re.IGNORECASE)
_X_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")


# ---------------------------------------------------------------------------
# Byte helpers
# ---------------------------------------------------------------------------


def b64decode_any(value: str) -> bytes:
    """Decode standard or URL-safe base64 (padding optional). Raises ValueError."""
    std = value.replace("-", "+").replace("_", "/")
    if not re.fullmatch(r"[A-Za-z0-9+/]*={0,2}", std):
        raise ValueError("invalid base64")
    std += "=" * (-len(std) % 4)
    return base64.b64decode(std, validate=True)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def jwk_thumbprint(jwk: Mapping[str, Any]) -> str:
    """RFC 7638 SHA-256 thumbprint (base64url) of an Ed25519 OKP JWK: the WBA ``keyid``."""
    if jwk.get("kty") != "OKP" or jwk.get("crv") != "Ed25519" or not isinstance(jwk.get("x"), str):
        raise ValueError("jwk_thumbprint: only Ed25519 OKP keys are supported")
    canonical = '{"crv":"Ed25519","kty":"OKP","x":"' + jwk["x"] + '"}'
    return b64url(hashlib.sha256(canonical.encode("utf-8")).digest())


def content_digest(body: Union[str, bytes]) -> str:
    """RFC 9530 ``Content-Digest`` value: ``sha-256=:<base64>:``."""
    raw = body.encode("utf-8") if isinstance(body, str) else body
    return "sha-256=:" + base64.b64encode(hashlib.sha256(raw).digest()).decode("ascii") + ":"


def _require_cryptography() -> Any:
    try:
        from cryptography.hazmat.primitives.asymmetric import ed25519
    except ImportError as e:  # pragma: no cover - depends on the environment
        raise ImportError(
            "Web Bot Auth needs the 'cryptography' package: pip install \"imrobot[wba]\""
        ) from e
    return ed25519


def _ed25519_verify(x: str, signature_b64: str, base: str) -> bool:
    ed25519 = _require_cryptography()
    try:
        key = ed25519.Ed25519PublicKey.from_public_bytes(b64decode_any(x))
        key.verify(b64decode_any(signature_b64), base.encode("utf-8"))
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


class NonceStore(Protocol):
    """Atomic check-and-record store for nonces. Redis: ``SET key 1 NX PX ttl``."""

    def check_and_record(self, key: str, ttl_seconds: float) -> Union[bool, Awaitable[bool]]:
        """Record ``key`` for ``ttl_seconds``; return True if new, False if still recorded."""
        ...


class MemoryNonceStore:
    """In-process nonce store (bounded). Use a shared store across workers."""

    def __init__(self, capacity: int = 100_000) -> None:
        self.capacity = capacity
        self._seen: OrderedDict[str, float] = OrderedDict()

    def check_and_record(self, key: str, ttl_seconds: float) -> bool:
        now = time.time()
        prev = self._seen.get(key)
        if prev is not None and prev > now:
            return False
        if len(self._seen) >= self.capacity:
            for k in [k for k, exp in self._seen.items() if exp <= now]:
                del self._seen[k]
        if len(self._seen) >= self.capacity:
            self._seen.popitem(last=False)
        self._seen.pop(key, None)
        self._seen[key] = now + max(0.0, ttl_seconds)
        return True


@dataclass
class SignedHttpRequest:
    """The parts of an HTTP request that Web Bot Auth reads."""

    headers: Mapping[str, Any]
    method: str = "GET"
    #: Path with optional query (``/api?x=1``) or an absolute URL.
    url: str = "/"
    #: ``host[:port]`` when there is no Host header.
    authority: Optional[str] = None
    #: ``http`` / ``https``, needed only for ``@target-uri`` / ``@scheme``.
    scheme: Optional[str] = None


@dataclass
class WebBotAuthResult:
    verified: bool
    #: ``verified`` | ``invalid`` (bad signature) | ``unverified`` (cannot tell).
    outcome: str
    reason: Optional[str] = None
    label: Optional[str] = None
    keyid: Optional[str] = None
    tag: Optional[str] = None
    created: Optional[int] = None
    expires: Optional[int] = None
    nonce: Optional[str] = None
    agent: Optional[str] = None


@dataclass
class DirectoryResponse:
    """What a directory fetch returns. ``headers`` keys are lowercased."""

    status: int
    headers: Mapping[str, str]
    body: bytes


FetchFn = Callable[[str], Union[DirectoryResponse, Awaitable[DirectoryResponse]]]


@dataclass
class ParsedSignatureInput:
    label: str
    components: list[str]
    component_items: list[_sf.Item]
    raw_params: str
    created: Optional[int] = None
    expires: Optional[int] = None
    keyid: Optional[str] = None
    alg: Optional[str] = None
    tag: Optional[str] = None
    nonce: Optional[str] = None


@dataclass
class _DirectoryEntry:
    ok: bool
    keys: dict[str, str] = field(default_factory=dict)
    expires_at: float = 0.0
    last_refetch_at: float = 0.0


class _DirectoryError(Exception):
    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------------------
# Parsing + signature base
# ---------------------------------------------------------------------------


def _header(headers: Mapping[str, Any], name: str) -> Optional[str]:
    lower = name.lower()
    v = headers.get(lower)
    if v is None:
        for k in headers:
            if k.lower() == lower:
                v = headers[k]
                break
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        return ", ".join(str(s).strip() for s in v)
    return str(v).strip()


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _str_param(member: Union[_sf.Item, _sf.InnerList], key: str) -> Optional[str]:
    v = member.params.get(key)
    return v if isinstance(v, str) else None


def _int_param(member: Union[_sf.Item, _sf.InnerList], key: str) -> Optional[int]:
    v = member.params.get(key)
    return v if _is_int(v) else None  # type: ignore[return-value]


def parse_signature_inputs(value: str) -> Optional[list[ParsedSignatureInput]]:
    """Parse every member of a Signature-Input header. None when malformed."""
    try:
        d = _sf.parse_dictionary(value)
    except _sf.StructuredFieldError:
        return None
    out: list[ParsedSignatureInput] = []
    for label, member in d.items():
        if not isinstance(member, _sf.InnerList):
            return None
        comps: list[str] = []
        for item in member.items:
            if not isinstance(item.value, str):
                return None
            comps.append(item.value.lower())
        out.append(
            ParsedSignatureInput(
                label=label,
                components=comps,
                component_items=member.items,
                raw_params=member.raw,
                created=_int_param(member, "created"),
                expires=_int_param(member, "expires"),
                keyid=_str_param(member, "keyid"),
                alg=_str_param(member, "alg"),
                tag=_str_param(member, "tag"),
                nonce=_str_param(member, "nonce"),
            )
        )
    return out


def parse_signature_input(
    value: str, label: Optional[str] = None
) -> Optional[ParsedSignatureInput]:
    """One Signature-Input member: ``label`` or the first one."""
    all_ = parse_signature_inputs(value)
    if not all_:
        return None
    if label is None:
        return all_[0]
    return next((p for p in all_ if p.label == label), None)


def _path_and_query(req: SignedHttpRequest) -> tuple[str, str]:
    target = req.url or "/"
    if _ABSOLUTE_URL.match(target):
        parts = urlsplit(target)
        target = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    path, sep, query = target.partition("?")
    return (path or "/"), (f"?{query}" if sep else "?")


def _authority_of(req: SignedHttpRequest) -> Optional[str]:
    raw = _header(req.headers, "host") or req.authority
    if not raw and req.url and _ABSOLUTE_URL.match(req.url):
        raw = urlsplit(req.url).netloc
    return raw.lower() if raw else None


def _scheme_of(req: SignedHttpRequest) -> Optional[str]:
    if req.scheme:
        return req.scheme.lower()
    if req.url and re.match(r"^https?://", req.url, re.IGNORECASE):
        return urlsplit(req.url).scheme.lower()
    return None


def _resolve_component(item: _sf.Item, req: SignedHttpRequest) -> Optional[str]:
    if not isinstance(item.value, str):
        return None
    name = item.value.lower()
    key = item.params.get("key")
    if any(k != "key" for k in item.params):
        return None  # ;sf ;bs ;req ;tr ;name: not supported on requests
    if name.startswith("@"):
        if key is not None:
            return None
        if name == "@method":
            return (req.method or "GET").upper()
        if name == "@authority":
            return _authority_of(req)
        if name == "@path":
            return _path_and_query(req)[0]
        if name == "@query":
            return _path_and_query(req)[1]
        if name == "@scheme":
            return _scheme_of(req)
        if name == "@target-uri":
            scheme, authority = _scheme_of(req), _authority_of(req)
            if not scheme or not authority:
                return None
            path, query = _path_and_query(req)
            return f"{scheme}://{authority}{path}{'' if query == '?' else query}"
        return None
    raw = _header(req.headers, name)
    if raw is None:
        return None
    if key is None:
        return raw
    if not isinstance(key, str):
        return None
    try:
        member = _sf.parse_dictionary(raw).get(key)
    except _sf.StructuredFieldError:
        return None
    return _sf.serialize_member(member) if member is not None else None


def _component_identifier(item: _sf.Item) -> str:
    value = item.value.lower() if isinstance(item.value, str) else item.value
    return _sf.serialize_bare_item(value) + _sf.serialize_params(item.params)


def build_signature_base(parsed: ParsedSignatureInput, req: SignedHttpRequest) -> Optional[str]:
    """Rebuild the RFC 9421 signature base; None if a component is unsupported/missing."""
    lines: list[str] = []
    for item in parsed.component_items:
        value = _resolve_component(item, req)
        if value is None:
            return None
        lines.append(f"{_component_identifier(item)}: {value}")
    lines.append(f'"@signature-params": {parsed.raw_params}')
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Signature-Agent + trust
# ---------------------------------------------------------------------------


def _resolve_signature_agent(
    parsed: ParsedSignatureInput, req: SignedHttpRequest
) -> tuple[str, Optional[str]]:
    """Return ("ok", url) | ("absent", None) | ("fail", reason)."""
    covered = [
        i
        for i in parsed.component_items
        if isinstance(i.value, str) and i.value.lower() == "signature-agent"
    ]
    raw = _header(req.headers, "signature-agent")
    if not covered:
        return ("absent", None) if raw is None else ("fail", "missing_signature_agent")
    if len(covered) > 1 or raw is None:
        return ("fail", "missing_signature_agent")
    key = covered[0].params.get("key")
    value: Optional[str] = None
    try:
        if raw.startswith('"'):
            if key is not None:
                return ("fail", "missing_signature_agent")
            item = _sf.parse_item(raw)
            if isinstance(item.value, str) and not item.params:
                value = item.value
        else:
            if not isinstance(key, str):
                return ("fail", "missing_signature_agent")
            member = _sf.parse_dictionary(raw).get(key)
            # A member with parameters MUST be ignored (draft -01 5.2.1).
            if isinstance(member, _sf.Item) and isinstance(member.value, str) and not member.params:
                value = member.value
    except _sf.StructuredFieldError:
        return ("fail", "malformed")
    if value is None:
        return ("fail", "missing_signature_agent")
    try:
        parts = urlsplit(value)
        _ = parts.port  # raises on a bad port
    except ValueError:
        return ("fail", "malformed")
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return ("fail", "untrusted_agent")
    return ("ok", urlunsplit(("https", parts.netloc.lower(), parts.path or "/", "", "")))


def is_private_host(hostname: str) -> bool:
    """Loopback / private / link-local / reserved IP literals and local names (draft -01 6.7)."""
    h = hostname.lower().strip("[]")
    if h == "localhost" or h.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        ip = ipaddress.ip_address(h)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or (isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"))
    )


def _origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc.lower()}"


def _normalize_trusted(entry: str) -> tuple[str, str, bool]:
    p = urlsplit(entry)
    if p.scheme != "https" or not p.hostname:
        raise ValueError("trusted_signature_agents entries must be absolute https URLs")
    href = urlunsplit(("https", p.netloc.lower(), p.path or "/", "", ""))
    return _origin(href), href, (p.path or "/") == "/"


# ---------------------------------------------------------------------------
# Directory fetch
# ---------------------------------------------------------------------------


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:  # type: ignore[override]
        return None  # draft -01 5.5: never follow redirects


def _urllib_fetch(url: str) -> DirectoryResponse:
    opener = urllib.request.build_opener(_NoRedirect)
    request = urllib.request.Request(
        url,
        headers={
            "Accept": f"{DIRECTORY_MEDIA_TYPE}, application/jwk-set+json, application/json",
            "User-Agent": "imrobot-web-bot-auth",
        },
    )
    try:
        with opener.open(request, timeout=FETCH_TIMEOUT_SECONDS) as resp:
            body = resp.read(MAX_DIRECTORY_BYTES + 1)
            headers = {k.lower(): v for k, v in resp.headers.items()}
            return DirectoryResponse(status=resp.status, headers=headers, body=body)
    except urllib.error.HTTPError as e:
        return DirectoryResponse(status=e.code, headers={}, body=b"")


async def default_fetch(url: str) -> DirectoryResponse:
    """Blocking urllib fetch in a worker thread: no redirects, 5 s timeout, size-capped read."""
    return await asyncio.get_running_loop().run_in_executor(None, _urllib_fetch, url)


def _cache_lifetime(headers: Mapping[str, str], fallback: float) -> float:
    cc = headers.get("cache-control", "") or ""
    if re.search(r"\b(no-store|no-cache)\b", cc, re.IGNORECASE):
        return MIN_DIRECTORY_CACHE_SECONDS
    m = re.search(r"\bmax-age=(\d+)", cc, re.IGNORECASE)
    seconds = float(m.group(1)) if m else fallback
    return min(MAX_DIRECTORY_CACHE_SECONDS, max(MIN_DIRECTORY_CACHE_SECONDS, seconds))


def verify_directory_response(
    *,
    body: Union[str, bytes],
    headers: Mapping[str, str],
    authority: str,
    keys: Mapping[str, str],
    now: Optional[int] = None,
    clock_skew_seconds: int = DEFAULT_CLOCK_SKEW_SECONDS,
) -> set[str]:
    """Thumbprints whose key signed this directory response (draft -01 Appendix B.1)."""
    verified: set[str] = set()
    lower = {k.lower(): v for k, v in headers.items()}
    sig_input, sig = lower.get("signature-input"), lower.get("signature")
    digest = (lower.get("content-digest") or "").strip()
    if not sig_input or not sig or not digest:
        return verified
    if not hmac.compare_digest(digest.encode(), content_digest(body).encode()):
        return verified
    parsed_all = parse_signature_inputs(sig_input)
    if not parsed_all:
        return verified
    try:
        sig_dict = _sf.parse_dictionary(sig)
    except _sf.StructuredFieldError:
        return verified
    now_s = int(time.time()) if now is None else now
    for p in parsed_all[:MAX_DIRECTORY_KEYS]:
        if p.tag != DIRECTORY_TAG or not p.keyid or p.created is None or p.expires is None:
            continue
        if p.created > now_s + clock_skew_seconds or p.expires < now_s - clock_skew_seconds:
            continue
        if p.alg is not None and p.alg != "ed25519":
            continue
        x = keys.get(p.keyid)
        member = sig_dict.get(p.label)
        if not x or not isinstance(member, _sf.Item) or not isinstance(member.value, _sf.Binary):
            continue
        lines: list[str] = []
        seen: set[str] = set()
        ok = True
        for item in p.component_items:
            ident = _component_identifier(item)
            seen.add(ident)
            if ident == '"@authority";req':
                lines.append(f"{ident}: {authority.lower()}")
            elif ident == '"content-digest"':
                lines.append(f"{ident}: {digest}")
            else:
                ok = False
        if not ok or '"@authority";req' not in seen or '"content-digest"' not in seen:
            continue
        lines.append(f'"@signature-params": {p.raw_params}')
        if _ed25519_verify(x, member.value.value, "\n".join(lines)):
            verified.add(p.keyid)
    return verified


# ---------------------------------------------------------------------------
# Verifier
# ---------------------------------------------------------------------------


def _fail(reason: str, **info: Any) -> WebBotAuthResult:
    return WebBotAuthResult(
        verified=False,
        outcome="unverified" if reason in _UNVERIFIED_REASONS else "invalid",
        reason=reason,
        **info,
    )


async def _maybe_await(v: Any) -> Any:
    return await v if inspect.isawaitable(v) else v


class WebBotAuthVerifier:
    """Verifies Web Bot Auth signatures. Hold one per process (it caches directories + nonces).

    Pick ONE key source: ``trusted_signature_agents`` (allow-list, recommended),
    ``directory_url`` (one pinned JWK Set) or ``allow_any_signature_agent``
    (any public https agent; private hosts are refused).
    """

    def __init__(
        self,
        *,
        directory_url: Optional[str] = None,
        trusted_signature_agents: Optional[list[str]] = None,
        allow_any_signature_agent: bool = False,
        expected_tag: Optional[str] = DEFAULT_TAG,
        label: Optional[str] = None,
        max_age_seconds: int = DEFAULT_MAX_AGE_SECONDS,
        clock_skew_seconds: int = DEFAULT_CLOCK_SKEW_SECONDS,
        directory_cache_seconds: float = DEFAULT_DIRECTORY_CACHE_SECONDS,
        nonce_store: Union[NonceStore, bool] = True,
        require_nonce: bool = False,
        reject_test_keys: bool = True,
        require_signed_directory: bool = False,
        fetch: Optional[FetchFn] = None,
        now: Optional[Callable[[], int]] = None,
    ) -> None:
        _require_cryptography()
        if directory_url is not None and not directory_url.strip():
            raise ValueError("WebBotAuthVerifier: directory_url is empty")
        self._trusted = [_normalize_trusted(t) for t in (trusted_signature_agents or [])]
        if not directory_url and not self._trusted and not allow_any_signature_agent:
            raise ValueError(
                "WebBotAuthVerifier: set directory_url, trusted_signature_agents, "
                "or allow_any_signature_agent"
            )
        self.directory_url = directory_url.strip() if directory_url else None
        self.allow_any_signature_agent = allow_any_signature_agent
        self.expected_tag = expected_tag
        self.label = label
        self.max_age_seconds = max_age_seconds
        self.clock_skew_seconds = clock_skew_seconds
        self.directory_cache_seconds = directory_cache_seconds
        self.require_nonce = require_nonce
        self.reject_test_keys = reject_test_keys
        self.require_signed_directory = require_signed_directory
        self._fetch: FetchFn = fetch or default_fetch
        self._now = now
        if nonce_store is True:
            self._nonce_store: Optional[NonceStore] = MemoryNonceStore()
        elif nonce_store is False:
            self._nonce_store = None
        else:
            self._nonce_store = nonce_store
        self._cache: OrderedDict[str, _DirectoryEntry] = OrderedDict()
        self._inflight: dict[str, asyncio.Future[_DirectoryEntry]] = {}

    def _now_s(self) -> int:
        return self._now() if self._now else int(time.time())

    async def verify(self, req: SignedHttpRequest) -> WebBotAuthResult:
        """Verify the Web Bot Auth signature on a request. Never raises."""
        sig_input_raw = _header(req.headers, "signature-input")
        sig_raw = _header(req.headers, "signature")
        if not sig_input_raw or not sig_raw:
            return _fail("no_signature")
        all_ = parse_signature_inputs(sig_input_raw)
        if not all_:
            return _fail("malformed")
        try:
            signatures = _sf.parse_dictionary(sig_raw)
        except _sf.StructuredFieldError:
            return _fail("malformed")
        candidates = [p for p in all_ if p.label == self.label] if self.label else all_
        if not candidates:
            return _fail("no_signature")
        if self.expected_tag is not None:
            tagged = [p for p in candidates if p.tag == self.expected_tag]
            if not tagged:
                return _fail("tag_mismatch", tag=candidates[0].tag, label=candidates[0].label)
            candidates = tagged
        first: Optional[WebBotAuthResult] = None
        for parsed in candidates[:MAX_SIGNATURE_CANDIDATES]:
            try:
                result = await self._verify_one(parsed, signatures, req)
            except Exception:
                result = _fail("malformed", label=parsed.label)
            if result.verified:
                return result
            first = first or result
        assert first is not None
        return first

    async def _verify_one(
        self,
        p: ParsedSignatureInput,
        signatures: Mapping[str, Union[_sf.Item, _sf.InnerList]],
        req: SignedHttpRequest,
    ) -> WebBotAuthResult:
        info: dict[str, Any] = {
            "label": p.label,
            "keyid": p.keyid,
            "tag": p.tag,
            "created": p.created,
            "expires": p.expires,
            "nonce": p.nonce,
        }
        if p.created is None or p.expires is None or not p.keyid or not p.tag:
            return _fail("missing_param", **info)
        if p.alg is not None and p.alg != "ed25519":
            return _fail("unsupported_alg", **info)
        if "@authority" not in p.components and "@target-uri" not in p.components:
            return _fail("missing_authority", **info)
        now = self._now_s()
        skew, max_age = self.clock_skew_seconds, self.max_age_seconds
        if p.created > p.expires:
            return _fail("malformed", **info)
        if p.created > now + skew:
            return _fail("not_yet_valid", **info)
        if p.expires < now - skew or now - p.created > max_age + skew:
            return _fail("expired", **info)
        if self.require_nonce and not p.nonce:
            return _fail("missing_nonce", **info)
        sig_member = signatures.get(p.label)
        if not isinstance(sig_member, _sf.Item) or not isinstance(sig_member.value, _sf.Binary):
            return _fail("malformed", **info)

        status, value = _resolve_signature_agent(p, req)
        if status == "fail":
            return _fail(value or "malformed", **info)
        if self.directory_url:
            directory_url = self.directory_url
        else:
            if status != "ok" or value is None:
                return _fail("missing_signature_agent", **info)
            if not self._is_trusted(value):
                return _fail("untrusted_agent", **{**info, "agent": value})
            directory_url = value
        info["agent"] = directory_url

        base = build_signature_base(p, req)
        if base is None:
            return _fail("unsupported_component", **info)
        try:
            x = await self._lookup_key(directory_url, p.keyid)
        except _DirectoryError:
            return _fail("directory_error", **info)
        if not x:
            return _fail("unknown_key", **info)
        if self.reject_test_keys and x in KNOWN_TEST_KEY_X:
            return _fail("test_key", **info)
        if not _ed25519_verify(x, sig_member.value.value, base):
            return _fail("bad_signature", **info)
        # Record the nonce only after the signature verified, so junk cannot fill the store.
        if p.nonce and self._nonce_store is not None:
            ttl = min(p.expires, p.created + max_age) + skew - now + 1
            fresh = await _maybe_await(
                self._nonce_store.check_and_record(
                    f"{directory_url}|{p.keyid}|{p.nonce}", float(ttl)
                )
            )
            if not fresh:
                return _fail("replayed_nonce", **info)
        return WebBotAuthResult(verified=True, outcome="verified", **info)

    def _is_trusted(self, url: str) -> bool:
        origin = _origin(url)
        for t_origin, t_href, origin_only in self._trusted:
            if (origin == t_origin) if origin_only else (url == t_href):
                return True
        if self.allow_any_signature_agent:
            return not is_private_host(urlsplit(url).hostname or "")
        return False

    async def _lookup_key(self, url: str, keyid: str) -> Optional[str]:
        entry = self._cache.get(url)
        now = time.time()
        if entry is None or now >= entry.expires_at:
            entry = await self._refresh(url, entry)
        elif (
            entry.ok
            and keyid not in entry.keys
            and now - entry.last_refetch_at >= UNKNOWN_KEY_REFETCH_SECONDS
        ):
            entry = await self._refresh(url, entry)  # the agent may have rotated its key
        if not entry.ok:
            raise _DirectoryError("directory unavailable")
        for thumb, x in entry.keys.items():
            if hmac.compare_digest(thumb.encode(), keyid.encode()):
                return x
        return None

    async def _refresh(self, url: str, previous: Optional[_DirectoryEntry]) -> _DirectoryEntry:
        loop = asyncio.get_running_loop()
        running = self._inflight.get(url)
        if running is not None and running.get_loop() is loop:
            return await asyncio.shield(running)
        fut: asyncio.Future[_DirectoryEntry] = loop.create_future()
        self._inflight[url] = fut
        try:
            try:
                entry = await self._fetch_directory(url)
            except Exception:
                now = time.time()
                # A failed fetch MUST NOT evict a cached entry (draft -01 6.10).
                if previous is not None and previous.ok:
                    entry = _DirectoryEntry(True, previous.keys, now + NEGATIVE_CACHE_SECONDS, now)
                else:
                    entry = _DirectoryEntry(False, {}, now + NEGATIVE_CACHE_SECONDS, now)
            self._cache.pop(url, None)
            self._cache[url] = entry
            while len(self._cache) > MAX_CACHED_DIRECTORIES:
                self._cache.popitem(last=False)
            fut.set_result(entry)
            return entry
        finally:
            if not fut.done():
                fut.cancel()
            if self._inflight.get(url) is fut:
                del self._inflight[url]

    async def _fetch_directory(self, url: str) -> _DirectoryEntry:
        parts = urlsplit(url)
        attempts = [url]
        if (parts.path or "/") == "/":
            # Bare origin: try the well-known path, fall back to the literal URL on 404/410.
            attempts = [f"{_origin(url)}{WELL_KNOWN_DIRECTORY_PATH}", url]
        last: Optional[Exception] = None
        for target in attempts:
            try:
                return await self._fetch_one(target)
            except _DirectoryError as e:
                last = e
                if e.status not in (404, 410):
                    break
        raise last or _DirectoryError("directory fetch failed")

    async def _fetch_one(self, target: str) -> _DirectoryEntry:
        res = await _maybe_await(self._fetch(target))
        if not isinstance(res, DirectoryResponse):
            raise _DirectoryError("fetch must return a DirectoryResponse")
        if res.status != 200:
            raise _DirectoryError(f"directory status {res.status}", res.status)
        if len(res.body) > MAX_DIRECTORY_BYTES:
            raise _DirectoryError("directory too large")
        try:
            data = json.loads(res.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as e:
            raise _DirectoryError("directory is not JSON") from e
        lst = data.get("keys") if isinstance(data, dict) else None
        if not isinstance(lst, list):
            raise _DirectoryError("directory has no keys array")
        if len(lst) > MAX_DIRECTORY_KEYS:
            raise _DirectoryError("directory has too many keys")
        is_well_known = urlsplit(target).path == WELL_KNOWN_DIRECTORY_PATH
        now_s = self._now_s()
        keys: dict[str, str] = {}
        for k in lst:
            if not isinstance(k, dict) or k.get("kty") != "OKP" or k.get("crv") != "Ed25519":
                continue
            x = k.get("x")
            if not isinstance(x, str) or not _X_RE.match(x):
                continue
            nbf, exp = k.get("nbf"), k.get("exp")
            if isinstance(nbf, int) and not isinstance(nbf, bool) and nbf > now_s:
                continue
            if isinstance(exp, int) and not isinstance(exp, bool) and exp < now_s:
                continue
            thumb = jwk_thumbprint(k)
            # At the well-known path a kid, when present, MUST be the thumbprint.
            if is_well_known and isinstance(k.get("kid"), str) and k["kid"] != thumb:
                continue
            keys[thumb] = x
        headers = {key.lower(): v for key, v in res.headers.items()}
        if self.require_signed_directory:
            signed = verify_directory_response(
                body=res.body,
                headers=headers,
                authority=urlsplit(target).netloc,
                keys=keys,
                now=now_s,
                clock_skew_seconds=self.clock_skew_seconds,
            )
            keys = {t: x for t, x in keys.items() if t in signed}
        now = time.time()
        lifetime = _cache_lifetime(headers, self.directory_cache_seconds)
        return _DirectoryEntry(True, keys, now + lifetime, now)


def signed_request_from_starlette(request: Any) -> SignedHttpRequest:
    """Build a :class:`SignedHttpRequest` from a Starlette / FastAPI ``Request``."""
    url = request.url
    target = url.path + (f"?{url.query}" if url.query else "")
    headers: dict[str, str] = {}
    for k, v in request.headers.items():
        lk = k.lower()
        headers[lk] = f"{headers[lk]}, {v}" if lk in headers else v
    return SignedHttpRequest(
        headers=headers, method=request.method, url=target, authority=url.netloc, scheme=url.scheme
    )


async def evaluate_web_bot_auth(
    verifier: WebBotAuthVerifier,
    req: SignedHttpRequest,
    accept: Optional[Callable[[WebBotAuthResult], Union[bool, Awaitable[bool]]]] = None,
) -> tuple[bool, WebBotAuthResult]:
    """The imrobot policy: ``(skip_challenge, result)``. Valid signed agent => skip."""
    result = await verifier.verify(req)
    if not result.verified:
        return False, result
    ok = True if accept is None else bool(await _maybe_await(accept(result)))
    return ok, result


__all__ = [
    "DEFAULT_TAG",
    "DIRECTORY_MEDIA_TYPE",
    "DIRECTORY_TAG",
    "WEB_BOT_AUTH_ACCEPT_SIGNATURE",
    "WELL_KNOWN_DIRECTORY_PATH",
    "DirectoryResponse",
    "MemoryNonceStore",
    "NonceStore",
    "ParsedSignatureInput",
    "SignedHttpRequest",
    "WebBotAuthResult",
    "WebBotAuthVerifier",
    "build_signature_base",
    "content_digest",
    "default_fetch",
    "evaluate_web_bot_auth",
    "is_private_host",
    "jwk_thumbprint",
    "parse_signature_input",
    "parse_signature_inputs",
    "signed_request_from_starlette",
    "verify_directory_response",
]
