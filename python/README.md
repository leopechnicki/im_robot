# imrobot (Python)

**Reverse-CAPTCHA that verifies AI agents and robots, not humans — Python SDK.**

[![PyPI](https://img.shields.io/pypi/v/imrobot?style=flat-square&color=f59e0b)](https://pypi.org/project/imrobot/)
[![Python](https://img.shields.io/pypi/pyversions/imrobot?style=flat-square)](https://pypi.org/project/imrobot/)
[![License: MIT](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)](../LICENSE)

Companion package to the JavaScript [imrobot](https://www.npmjs.com/package/imrobot) SDK. Produces byte-identical challenge outputs so a Python client can solve JS-issued challenges and vice-versa. Zero required dependencies for the solver + verifier; FastAPI is an optional extra.

## Install

```bash
pip install imrobot                  # solver + verifier + JWT (zero deps)
pip install "imrobot[fastapi]"       # + FastAPI middleware
```

## Quick start — AI agent (LangChain / CrewAI / AutoGPT / any Python bot)

```python
import httpx
from imrobot import solve_challenge

# 1. Fetch challenge
resp = httpx.get("https://example.com/imrobot/challenge")
challenge = resp.json()

# 2. Solve it
answer = solve_challenge(challenge)

# 3. Get your proof token
resp = httpx.post(
    "https://example.com/imrobot/verify",
    json={"challenge": challenge, "answer": answer},
)
proof_token = resp.json()["proofToken"]

# 4. Use the token on protected routes
httpx.get(
    "https://example.com/api/agent-data",
    headers={"X-Agent-Proof": proof_token},
)
```

## Quick start — FastAPI server

```python
import os
from fastapi import Depends, FastAPI
from imrobot.fastapi import create_imrobot_router, require_agent

app = FastAPI()
secret = os.environ["IMROBOT_SECRET"]  # min 16 chars

# Mount /imrobot/challenge + /imrobot/verify
app.include_router(create_imrobot_router(secret=secret), prefix="/imrobot")

# Protect a route
@app.get("/api/agent-data", dependencies=[Depends(require_agent(secret=secret))])
async def agent_only():
    return {"secret": "only bots see this"}
```

## Agent frameworks: LangChain and CrewAI

`pass_gate` does the whole agent side in one call (standard library only):

```python
from imrobot.gate import pass_gate, GateError

gate = pass_gate("https://site.example", agent_id="my-agent")   # or: await apass_gate(...)
headers = {gate.proof_header: gate.proof_token}
```

As tools for an agent framework (`imrobot_pass_gate(url)` and `imrobot_solve_challenge(challenge)`;
both return JSON strings and never raise):

```python
# pip install "imrobot[langchain]"
from imrobot.langchain import get_langchain_tools
agent = create_agent(model="anthropic:claude-opus-5-5", tools=get_langchain_tools(agent_id="my-agent"))

# pip install "imrobot[crewai]"
from imrobot.crewai import get_crewai_tools
agent = Agent(role="...", goal="...", backstory="...", tools=get_crewai_tools(agent_id="my-crew"))
```

Full scripts: [`examples/langchain_agent.py`](examples/langchain_agent.py),
[`examples/crewai_agent.py`](examples/crewai_agent.py).

Private, loopback and link-local hosts are refused unless you pass `allow_private_hosts=True` (local
development). Only http(s), same-origin discovery endpoints, no redirects, 10 s timeout per request,
256 kB per response. The challenge is solved under `SOLVE_LIMITS`, so a hostile pipeline is refused
instead of hanging the agent. Host names are not resolved (use an egress filter in production), and
`HTTP(S)_PROXY` from the environment is honoured, as in any `urllib` client. `GateError.code` is one of `invalid_url`, `private_host`, `network`, `timeout`,
`bad_response`, `unsupported_challenge`, `rejected`.

## Web Bot Auth: signed agents skip the challenge

`pip install "imrobot[wba]"` adds Ed25519 support (`cryptography`). A request with a valid
[Web Bot Auth](https://datatracker.ietf.org/doc/draft-ietf-webbotauth-httpsig-protocol/) signature
(draft -01) passes `require_agent` without a proof token. Everything else is challenged as before:

```python
from imrobot.web_bot_auth import WebBotAuthVerifier

verifier = WebBotAuthVerifier(
    trusted_signature_agents=["https://agent.example"],
    authorities=["api.your-site.example"],  # your own host(s): stops cross-site replay
)

@app.get("/api/agent-data")
async def agent_only(agent=Depends(require_agent(secret=secret, web_bot_auth=verifier))):
    return agent  # {"agent_verified": True, "web_bot_auth": {...}} for a signed agent
```

Set `authorities`; without it `require_agent` warns, because a signature made for another site
could be replayed to you with a spoofed `Host`. A signature is accepted for 5 minutes after
`created` (`max_age_seconds`). `require_components=["@method", "@path"]` binds it to one request,
and `require_nonce=True` makes it single-use.

Signing as an agent:

```python
import httpx
from imrobot.agent import generate_agent_key, key_directory_response, sign_request

key = generate_agent_key()  # keep key.private_jwk secret
body, headers = key_directory_response([key.private_jwk], authority="agent.example")
# serve body + headers at https://agent.example/.well-known/http-message-signatures-directory

url = "https://site.example/api/agent-data"
httpx.get(url, headers=sign_request("GET", url, private_jwk=key.private_jwk,
                                    signature_agent="https://agent.example"))
```

## API surface

### `imrobot`

| Function | Purpose |
|---|---|
| `solve_challenge(challenge)` | Compute the answer for a challenge (agent-side) |
| `execute_operation(input, op)` | Run one operation directly |
| `execute_pipeline(seed, pipeline)` | Run a full pipeline |
| `fnv1a(text)` | 32-bit FNV-1a hash — deterministic, 8 hex chars |
| `ImRobotVerifier(secret, ...)` | Server-side challenge generator + verifier |
| `ProofTokenIssuer(secret, ...)` | JWT (HS256) proof token issue/verify |
| `InMemoryReplayGuard(capacity)` | Bounded replay-attack guard |
| `hmac_sign(secret, message)` | HMAC-SHA256 hex (matches JS `hmacSign`) |
| `hmac_verify(secret, message, sig)` | Constant-time HMAC verify |

`ImRobotVerifier.generate` / `.verify` and `ProofTokenIssuer.issue` / `.verify` are coroutines (`await` them, or `asyncio.run(...)` from sync code), and they return plain dicts (`TypedDict`s), so read results as `result["valid"]` and `result.get("reason")`, not `result.valid`:

```python
import asyncio
from imrobot import ImRobotVerifier, solve_challenge

async def main():
    verifier = ImRobotVerifier(secret)
    challenge = await verifier.generate()
    result = await verifier.verify(challenge, solve_challenge(challenge))
    print(result["valid"], result.get("reason"))

asyncio.run(main())
```

### `imrobot.gate`, `imrobot.langchain`, `imrobot.crewai`

| Function | Purpose |
|---|---|
| `pass_gate(url, *, agent_id, timeout, allow_private_hosts)` | Discover, solve, verify; returns `PassGateResult` (raises `GateError`) |
| `apass_gate(...)` | Async `pass_gate` |
| `pass_gate_tool(url, ...)` / `solve_challenge_tool(challenge)` | Tool bodies: JSON string out, never raise |
| `get_langchain_tools(...)` | Both tools as LangChain `StructuredTool`s |
| `get_crewai_tools(...)`, `ImRobotPassGateTool`, `ImRobotSolveChallengeTool` | Both tools as CrewAI `BaseTool`s |

### `imrobot.fastapi`

| Function | Purpose |
|---|---|
| `create_imrobot_router(secret=..., ...)` | Returns an `APIRouter` with GET `/challenge` + POST `/verify` |
| `require_agent(secret=..., ...)` | Returns a FastAPI dependency that enforces the `X-Agent-Proof` header |

## Interoperability

The Python and JS SDKs share the exact same wire format:

- **FNV-1a** — bit-for-bit identical output (matches JS `Math.imul` semantics).
- **HMAC-SHA256** — 64-char lowercase hex.
- **Base64url** — RFC 4648 §5, no padding.
- **JWT** — RFC 7519 HS256, standard claims + namespaced `imr` claim; the signature segment is base64url of the raw 32-byte HMAC (RFC 7515), so `PyJWT` verifies it. Tokens from 0.8.0 and earlier used base64url of the hex HMAC; `ProofTokenIssuer.verify` still accepts them.
- **Challenge JSON** — same field names (camelCase for wire compatibility with JS: `visibleSeed`, `expiresAt`, `hmac`, `pipeline`).

The `tests/test_interop.py` suite pins known JS reference outputs so any drift breaks CI.

Since 0.9 the challenge HMAC uses message format `v2`, which also signs the issue time and the seed. A challenge issued by a 0.8 server fails with `invalid_hmac` after the upgrade, until it expires. `tests/test_hardening.py` verifies a JS-issued `v2` challenge.

## Timing gate and real SHA-256 (0.9)

```python
verifier = create_verifier(
    secret,
    min_solve_ms=50,     # faster: {"valid": False, "reason": "too_fast"}
    max_solve_ms=8_000,  # slower: {"valid": False, "reason": "too_slow"}
    sha256=True,         # one real SHA-256 step in every pipeline
)
```

The solve time is measured on the server clock, from the signed issue time. Solvers older than 0.9 cannot run the `sha256` op, so turn it on once your agents run 0.9 or later. What these checks do and do not prove: [docs/THREAT_MODEL.md](https://github.com/leopechnicki/im_robot/blob/main/docs/THREAT_MODEL.md).

## Naming note — `sha256_hash`

The operation `{ "op": "sha256_hash" }` is a **deprecated alias for `fnv1a_cascade`** (8 rounds of FNV-1a → 64 hex chars). It is **not** SHA-256; the real one is the opt-in `{ "op": "sha256" }` (0.9). Kept for wire-format compatibility; new challenges use `fnv1a_cascade` or `hash_chain`. The Python SDK emits a `DeprecationWarning` when the alias is executed. See the main `README.md` for full context.

## Development

```bash
git clone https://github.com/leopechnicki/im_robot
cd im_robot/python
pip install -e ".[dev]"
pytest
ruff check src tests
mypy src
```

## License

MIT © Leo Pechnicki
