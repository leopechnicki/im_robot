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
- **JWT** — RFC 7519 HS256, standard claims + namespaced `imr` claim.
- **Challenge JSON** — same field names (camelCase for wire compatibility with JS: `visibleSeed`, `expiresAt`, `hmac`, `pipeline`).

The `tests/test_interop.py` suite pins known JS reference outputs so any drift breaks CI.

## Naming note — `sha256_hash`

The operation `{ "op": "sha256_hash" }` is a **deprecated alias for `fnv1a_cascade`** (8 rounds of FNV-1a → 64 hex chars). It is **not** SHA-256. Kept for wire-format compatibility; new challenges use `fnv1a_cascade` or `hash_chain`. The Python SDK emits a `DeprecationWarning` when the alias is executed. See the main `README.md` for full context.

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
