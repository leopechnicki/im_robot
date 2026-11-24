"""Agent side of the imrobot challenge flow: pass a site's gate from Python.

Python mirror of ``passGate`` in the npm ``imrobot/agent`` entry point. Find a
site's challenge endpoint, solve the challenge and trade the answer for a
proof token:

    >>> from imrobot.gate import pass_gate
    >>> result = pass_gate("https://site.example")
    >>> httpx.get("https://site.example/api/data",
    ...           headers={result.proof_header: result.proof_token})

It is what the LangChain and CrewAI tools (``imrobot.langchain``,
``imrobot.crewai``) call, so it is deliberately narrow:

- only http(s), only the origin of the URL you pass (discovery documents that
  point elsewhere are refused), no redirects;
- private, loopback and link-local hosts are refused unless you opt in with
  ``allow_private_hosts=True`` (a model can be talked into calling internal URLs);
- responses are size capped and time limited, and only the parsed result is
  returned, never the raw body;
- the challenge comes from an untrusted server, so it is solved step by step
  under :data:`SOLVE_LIMITS` instead of trusting its parameters.

Host names are not resolved: a public name that resolves (or rebinds) to a
private address is not caught. In production, run agents behind an egress
filter or an allow-list of sites.

Standard library only (``urllib``). Like any ``urllib`` client it honours the
``HTTP(S)_PROXY`` / ``NO_PROXY`` environment variables.
"""

from __future__ import annotations

import asyncio
import http.client
import json
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urljoin, urlsplit

from .core import execute_operation
from .web_bot_auth import is_private_host

DISCOVERY_PATH = "/.well-known/imrobot.json"
DEFAULT_CHALLENGE_PATH = "/imrobot/challenge"
DEFAULT_VERIFY_PATH = "/imrobot/verify"
DEFAULT_PROOF_HEADER = "X-Agent-Proof"
DEFAULT_TIMEOUT = 10.0
MAX_BODY_BYTES = 256 * 1024

#: Bounds for solving a challenge from an untrusted server. imrobot servers send
#: at most 8 operations, ``repeat`` 2-3 times and ``hash_chain`` 2-5 rounds, so
#: these are far above anything real; they stop a hostile site from making the
#: agent allocate gigabytes or spin forever. Same values as ``SOLVE_LIMITS`` in npm.
SOLVE_LIMITS: dict[str, int] = {
    "max_operations": 32,
    "max_value_length": 256 * 1024,
    "max_hash_rounds": 10_000,
    "max_key_length": 1024,
}

PASS_GATE_TOOL_NAME = "imrobot_pass_gate"
SOLVE_TOOL_NAME = "imrobot_solve_challenge"

PASS_GATE_DESCRIPTION = (
    'Pass an imrobot reverse-CAPTCHA ("prove you are an AI agent") on a website. Give the site '
    "URL, a page on it, or its challenge endpoint. The tool finds the challenge (via "
    "/.well-known/imrobot.json), solves it in code and returns a proof token. Send that token in "
    "the returned header (usually X-Agent-Proof) on your next requests to the site."
)

SOLVE_DESCRIPTION = (
    "Solve an imrobot challenge object you already have (JSON with seed and pipeline). Returns "
    "the answer string to submit to the site. Use imrobot_pass_gate instead when you only have "
    "a URL."
)

_HEADER_NAME_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-")


class GateError(Exception):
    """Raised by :func:`pass_gate`. ``code`` is stable; the message is for people.

    Codes: ``invalid_url``, ``private_host``, ``network``, ``timeout``,
    ``bad_response``, ``unsupported_challenge``, ``rejected``.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        reason: Optional[str] = None,
        status: Optional[int] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        #: Server's ``reason`` when it rejected the answer (``code == "rejected"``).
        self.reason = reason
        self.status = status


@dataclass(frozen=True)
class PassGateResult:
    #: Send it as ``proof_header`` on later requests.
    proof_token: str
    proof_header: str
    challenge_url: str
    verify_url: str
    #: Where the endpoints came from: ``"discovery"``, ``"url"`` or ``"default"``.
    source: str
    #: Milliseconds between issue and verification, as the server measured it.
    elapsed: Optional[int] = None
    difficulty: Optional[str] = None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None  # urllib then raises HTTPError for the 3xx, which we read as a status


_OPENER = urllib.request.build_opener(_NoRedirect)


@dataclass
class _Response:
    status: int
    body: bytes


def _parse_target(url: str, allow_private: bool) -> Any:
    if not isinstance(url, str):
        raise GateError("invalid_url", "url must be a string")
    try:
        parts = urlsplit(url)
        _ = parts.port  # raises ValueError on a bad port
    except ValueError as exc:
        raise GateError("invalid_url", f"Not a URL: {url}") from exc
    if parts.scheme not in ("http", "https"):
        raise GateError("invalid_url", f"Only http(s) URLs are supported (got {parts.scheme or 'none'})")
    if not parts.hostname:
        raise GateError("invalid_url", f"Not a URL: {url}")
    if parts.username is not None or parts.password is not None:
        raise GateError("invalid_url", "URLs with credentials are not supported")
    if not allow_private and is_private_host(parts.hostname):
        raise GateError(
            "private_host",
            f"{parts.hostname} is a private or local address "
            "(allow_private_hosts=True for local development)",
        )
    return parts


def _origin(parts: Any) -> str:
    return f"{parts.scheme}://{parts.netloc.lower()}"


def _same_origin_path(origin: str, value: Any) -> Optional[str]:
    """A discovery endpoint must be a root-relative path on the same origin."""
    if not isinstance(value, str) or not value.startswith("/") or value.startswith("//"):
        return None
    if "\\" in value or any(ord(c) < 0x21 for c in value):
        return None
    url = urljoin(origin + "/", value)
    resolved = urlsplit(url)
    return url if f"{resolved.scheme}://{resolved.netloc.lower()}" == origin else None


def _request(
    url: str,
    *,
    timeout: float,
    method: str = "GET",
    body: Optional[bytes] = None,
    user_agent: Optional[str] = None,
) -> _Response:
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if user_agent:
        headers["User-Agent"] = user_agent
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    origin = _origin(urlsplit(url))
    deadline = time.monotonic() + timeout
    try:
        try:
            resp = _OPENER.open(req, timeout=timeout)
        except urllib.error.HTTPError as http_err:
            resp = http_err  # non-2xx and refused redirects: still a response
        with resp:
            status = int(resp.status if hasattr(resp, "status") and resp.status else resp.code)
            declared = resp.headers.get("Content-Length") if resp.headers else None
            if declared and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
                raise GateError("bad_response", f"{origin}: response too large", status=status)
            chunks: list[bytes] = []
            total = 0
            # read1: return whatever arrived (one recv), so a body trickled a byte at a
            # time still hits the deadline. Worst case is deadline + one socket timeout.
            read = getattr(resp, "read1", resp.read)
            while True:
                if time.monotonic() > deadline:
                    raise GateError("timeout", f"{origin}: no answer within {timeout:g} s")
                chunk = read(16 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_BODY_BYTES:
                    raise GateError("bad_response", f"{origin}: response too large", status=status)
                chunks.append(chunk)
            return _Response(status=status, body=b"".join(chunks))
    except GateError:
        raise
    except (TimeoutError, socket.timeout) as exc:  # socket.timeout: Python 3.9
        raise GateError("timeout", f"{origin}: no answer within {timeout:g} s") from exc
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise GateError("timeout", f"{origin}: no answer within {timeout:g} s") from exc
        raise GateError("network", f"{origin}: {exc.reason}") from exc
    except OSError as exc:
        raise GateError("network", f"{origin}: {exc}") from exc
    except http.client.InvalidURL as exc:  # e.g. a space or control character in the path
        raise GateError("invalid_url", f"{origin}: {exc}") from exc
    except http.client.HTTPException as exc:  # IncompleteRead, bad status line, ...
        raise GateError("network", f"{origin}: {type(exc).__name__}: {exc}") from exc
    except ValueError as exc:  # urllib refusing the URL itself
        raise GateError("invalid_url", f"{origin}: {exc}") from exc


def _json(resp: _Response, what: str) -> Any:
    try:
        return json.loads(resp.body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise GateError("bad_response", f"{what}: not JSON", status=resp.status) from exc


def _find_endpoints(
    parts: Any, timeout: float, user_agent: Optional[str]
) -> tuple[str, str, str, str]:
    origin = _origin(parts)
    path = parts.path or "/"
    # 1. The URL itself is a challenge endpoint (``.../challenge``): verify is its sibling.
    if path.endswith("/challenge"):
        challenge = f"{origin}{path}" + (f"?{parts.query}" if parts.query else "")
        verify = f"{origin}{path[: -len('/challenge')]}/verify"
        return challenge, verify, DEFAULT_PROOF_HEADER, "url"
    # 2. Discovery document on the origin.
    resp = _request(origin + DISCOVERY_PATH, timeout=timeout, user_agent=user_agent)
    if resp.status == 200:
        doc = _json(resp, "discovery document")
        if isinstance(doc, dict) and doc.get("protocol") == "imrobot":
            raw = doc.get("endpoints")
            endpoints: dict[str, Any] = raw if isinstance(raw, dict) else {}
            challenge_url = _same_origin_path(origin, endpoints.get("challenge"))
            verify_url = _same_origin_path(origin, endpoints.get("verify"))
            if not challenge_url or not verify_url:
                raise GateError(
                    "bad_response", "discovery document endpoints must be paths on the same origin"
                )
            header = endpoints.get("proofHeader")
            proof_header = (
                header
                if isinstance(header, str) and 0 < len(header) <= 64 and set(header) <= _HEADER_NAME_CHARS
                else DEFAULT_PROOF_HEADER
            )
            return challenge_url, verify_url, proof_header, "discovery"
    # 3. The default mount point of every imrobot adapter.
    return (
        origin + DEFAULT_CHALLENGE_PATH,
        origin + DEFAULT_VERIFY_PATH,
        DEFAULT_PROOF_HEADER,
        "default",
    )


def _as_challenge(value: Any) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or not isinstance(value.get("id"), str)
        or not isinstance(value.get("seed"), str)
        or not isinstance(value.get("pipeline"), list)
    ):
        raise GateError("bad_response", "challenge endpoint did not return an imrobot challenge")
    return value


def _too_big(what: str) -> GateError:
    return GateError("unsupported_challenge", f"refusing to solve: {what}")


def _count(value: Any, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value):
        raise _too_big(f"{what} is not a whole number")
    return int(value)


def _check_step(value: str, op: dict[str, Any]) -> None:
    """Reject a step whose parameters would blow up time or memory (see SOLVE_LIMITS)."""
    limit = SOLVE_LIMITS["max_value_length"]
    kind = op.get("op")
    if kind == "repeat":
        times = _count(op.get("times"), "repeat.times")
        if times < 0 or len(value) * times > limit:
            raise _too_big("repeat too large")
    elif kind == "pad_start":
        if _count(op.get("length"), "pad_start.length") > limit:
            raise _too_big("pad_start.length too large")
    elif kind == "replace":
        search, replacement = op.get("search"), op.get("replacement")
        if not isinstance(search, str) or not isinstance(replacement, str):
            raise _too_big("replace needs string search and replacement")
        hits = len(value) + 1 if search == "" else len(value) // len(search)
        if len(value) + hits * len(replacement) > limit:
            raise _too_big("replace result too large")
    elif kind == "hash_chain":
        if _count(op.get("rounds"), "hash_chain.rounds") > SOLVE_LIMITS["max_hash_rounds"]:
            raise _too_big(f"hash_chain.rounds over {SOLVE_LIMITS['max_hash_rounds']}")
    elif kind == "byte_xor":
        key = op.get("key")
        if not isinstance(key, list) or len(key) > SOLVE_LIMITS["max_key_length"]:
            raise _too_big(f"byte_xor.key longer than {SOLVE_LIMITS['max_key_length']}")


def _bounded_solve(c: dict[str, Any]) -> str:
    """Solve under SOLVE_LIMITS, one operation at a time."""
    pipeline = c["pipeline"]
    if len(pipeline) > SOLVE_LIMITS["max_operations"]:
        raise _too_big(f"{len(pipeline)} operations (limit {SOLVE_LIMITS['max_operations']})")
    value: str = c["seed"]
    if len(value) > SOLVE_LIMITS["max_value_length"]:
        raise _too_big("seed too long")
    for op in pipeline:
        if not isinstance(op, dict):
            raise _too_big("an operation is not an object")
        _check_step(value, op)
        try:
            value = execute_operation(value, op)  # type: ignore[arg-type]
        except (ValueError, KeyError, TypeError, IndexError, OverflowError) as exc:
            raise GateError("unsupported_challenge", f"cannot solve this challenge: {exc}") from exc
        if len(value) > SOLVE_LIMITS["max_value_length"]:
            raise _too_big("an intermediate value is too large")
    return value


def solve_challenge_input(challenge: Any) -> str:
    """Solve a challenge dict (or its JSON text) under :data:`SOLVE_LIMITS`.

    Raises GateError (``unsupported_challenge``) on an unknown operation or a
    pipeline over the limits.
    """
    value = challenge
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError as exc:
            raise GateError("bad_response", "challenge is not valid JSON") from exc
    return _bounded_solve(_as_challenge(value))


def pass_gate(
    url: str,
    *,
    agent_id: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    allow_private_hosts: bool = False,
    user_agent: Optional[str] = None,
) -> PassGateResult:
    """Pass an imrobot gate: discover the endpoints of ``url``, solve the challenge
    and return the proof token.

    ``url`` may be the site (``https://site.example``), any page on it, or the
    challenge endpoint itself (``https://site.example/imrobot/challenge``).
    ``timeout`` (seconds) applies to each request. Raises :class:`GateError`.
    """
    parts = _parse_target(url, allow_private_hosts)
    challenge_url, verify_url, proof_header, source = _find_endpoints(parts, timeout, user_agent)

    challenge_resp = _request(challenge_url, timeout=timeout, user_agent=user_agent)
    if challenge_resp.status != 200:
        raise GateError(
            "bad_response",
            f"challenge endpoint {urlsplit(challenge_url).path} answered HTTP {challenge_resp.status}",
            status=challenge_resp.status,
        )
    challenge = _as_challenge(_json(challenge_resp, "challenge"))
    answer = solve_challenge_input(challenge)

    payload: dict[str, Any] = {"challenge": challenge, "answer": answer}
    if agent_id:
        payload["agentId"] = agent_id
    verify_resp = _request(
        verify_url,
        method="POST",
        body=json.dumps(payload).encode("utf-8"),
        timeout=timeout,
        user_agent=user_agent,
    )
    try:
        body = _json(verify_resp, "verify")
    except GateError:
        if verify_resp.status == 200:
            raise
        body = {}
    if not isinstance(body, dict):
        body = {}
    token = body.get("proofToken")
    if verify_resp.status != 200 or not isinstance(token, str):
        reason = body.get("reason") if isinstance(body.get("reason"), str) else None
        if reason is None and isinstance(body.get("code"), str):
            reason = body["code"]
        detail = f", {reason}" if reason else ""
        raise GateError(
            "rejected",
            f"verify endpoint refused the answer (HTTP {verify_resp.status}{detail})",
            reason=reason,
            status=verify_resp.status,
        )
    elapsed = body.get("elapsed")
    difficulty = challenge.get("difficulty")
    return PassGateResult(
        proof_token=token,
        proof_header=proof_header,
        challenge_url=challenge_url,
        verify_url=verify_url,
        source=source,
        elapsed=elapsed if isinstance(elapsed, int) and not isinstance(elapsed, bool) else None,
        difficulty=difficulty if isinstance(difficulty, str) else None,
    )


async def apass_gate(
    url: str,
    *,
    agent_id: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    allow_private_hosts: bool = False,
    user_agent: Optional[str] = None,
) -> PassGateResult:
    """Async :func:`pass_gate` (runs the blocking client in a worker thread)."""
    return await asyncio.to_thread(
        pass_gate,
        url,
        agent_id=agent_id,
        timeout=timeout,
        allow_private_hosts=allow_private_hosts,
        user_agent=user_agent,
    )


def _error_json(exc: BaseException) -> str:
    if isinstance(exc, GateError):
        out: dict[str, Any] = {"error": exc.code, "message": exc.message}
        if exc.reason:
            out["reason"] = exc.reason
        return json.dumps(out)
    return json.dumps({"error": "internal", "message": str(exc)})


def pass_gate_tool(
    url: str,
    *,
    agent_id: Optional[str] = None,
    timeout: float = DEFAULT_TIMEOUT,
    allow_private_hosts: bool = False,
    user_agent: Optional[str] = None,
) -> str:
    """Tool body for agent frameworks: like :func:`pass_gate`, but returns a JSON
    string and never raises (an ``error`` field tells the model what went wrong)."""
    try:
        r = pass_gate(
            url,
            agent_id=agent_id,
            timeout=timeout,
            allow_private_hosts=allow_private_hosts,
            user_agent=user_agent,
        )
    except Exception as exc:  # noqa: BLE001 - a tool must hand the model a readable result
        return _error_json(exc)
    return json.dumps(
        {
            "proofToken": r.proof_token,
            "proofHeader": r.proof_header,
            "verifyUrl": r.verify_url,
            "elapsed": r.elapsed,
            "difficulty": r.difficulty,
        }
    )


def solve_challenge_tool(challenge: Any) -> str:
    """Tool body: solve a challenge dict or JSON text. Returns JSON, never raises."""
    try:
        return json.dumps({"answer": solve_challenge_input(challenge)})
    except Exception as exc:  # noqa: BLE001
        return _error_json(exc)


__all__ = [
    "DEFAULT_PROOF_HEADER",
    "DISCOVERY_PATH",
    "GateError",
    "PASS_GATE_DESCRIPTION",
    "PASS_GATE_TOOL_NAME",
    "PassGateResult",
    "SOLVE_DESCRIPTION",
    "SOLVE_TOOL_NAME",
    "apass_gate",
    "pass_gate",
    "pass_gate_tool",
    "SOLVE_LIMITS",
    "solve_challenge_input",
    "solve_challenge_tool",
]
