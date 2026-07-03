<div align="center">

# 🤖 imrobot

**Reverse-CAPTCHA for AI agents — verify bots, not humans.**

[![npm version](https://img.shields.io/npm/v/imrobot.svg?style=flat-square&color=3b82f6)](https://www.npmjs.com/package/imrobot)
[![npm downloads](https://img.shields.io/npm/dw/imrobot.svg?style=flat-square&color=10b981)](https://www.npmjs.com/package/imrobot)
[![license](https://img.shields.io/npm/l/imrobot.svg?style=flat-square&color=6366f1)](https://github.com/leopechnicki/im_robot/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/leopechnicki/im_robot)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-22c55e?style=flat-square)](https://www.npmjs.com/package/imrobot)

### [Try the Live Playground →](https://imrobot.vercel.app)

See it solve a challenge in real time. No install needed.

---

[npm](https://www.npmjs.com/package/imrobot) · [Dev.to Article](https://dev.to/leo_pechnicki/why-i-built-a-captcha-that-only-bots-can-solve-30np) · [Changelog](./CHANGELOG.md)

</div>

---

## Why?

Traditional CAPTCHAs prove you're human. But what about the opposite?

As AI agents become first-class web citizens — browsing, booking, purchasing, automating — some systems need to gate access to **agent-facing endpoints** without forcing every caller to enroll a key. Think agent-only APIs, AI-only platforms, or multi-agent authentication.

**imrobot** flips the CAPTCHA model: it generates deterministic challenge pipelines that are trivial for any LLM or programmatic agent to solve (< 1 second), but impractical for humans to work through manually.

### What this protocol does and doesn't prove

- ✅ Proves the caller can **execute a deterministic compute pipeline** (string transforms, bytewise ops, hashing) end-to-end without human interaction.
- ✅ Proves the verification request was **issued by a server holding the same HMAC secret** (no cross-site replay).
- ✅ Issues a **standards-compliant JWT** (RFC 7519, HS256) that downstream services can verify with any JWT library.
- ⚠️ Does **not** cryptographically identify a specific bot — anyone who can run JS in a browser console can call `solveChallenge()` and pass.
- ⚠️ Does **not** replace cryptographic agent identity. For verified-bot identity, layer this with [Cloudflare's Web Bot Auth](https://developers.cloudflare.com/bots/concepts/bot/verified-bots/web-bot-auth/) (HTTP Message Signatures, RFC 9421), mTLS, or per-agent OAuth credentials.
- ⚠️ The `sha256_hash` operation is **misnamed for historical reasons** — it cascades FNV-1a 8 times into 64 hex characters; it is **not** RFC 6234 SHA-256. Use `fnv1a_cascade` in new code (same wire output).

The library's positioning is "zero-enrollment behavioural gate that survives serialization" — not "cryptographic proof of bot identity." Use the right tool for the job.

### Protocol versioning

The `version` field on the discovery document (`/.well-known/imrobot.json`) is the protocol version, not the package version. The current protocol version is `1.0`. Backwards-incompatible wire-format changes will bump the major.

## How it works

imrobot generates a pipeline of deterministic operations (string transforms, byte operations, hashing, and more) applied to a random seed. AI agents parse the structured challenge data, execute the pipeline, and submit the result. Humans would need to manually compute multi-step transformations — practically impossible without tools.

```
seed: "a7f3b2c1d4e5f609"
  1. reverse()
  2. caesar(7)
  3. xor_encode(42)
  4. fnv1a_hash()
  5. to_upper()
```

The challenge data is embedded in the DOM via `data-imrobot-challenge` attribute as structured JSON, making it trivially parseable by any agent.

## Install

```bash
npm install imrobot
```

## Quick Demo

A complete working example: protect an Express.js route so only verified AI agents can access it.

**1. Set up the server**

```typescript
// server.ts
import express from 'express'
import { createAgentRouter, requireAgent, ChallengeReplayGuard } from 'imrobot/server'

const app = express()
app.use(express.json())

// Mount challenge + verify endpoints under /imrobot
const agentRouter = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!, // e.g. "my-32-char-secret-key-goes-here"
  rateLimit: { windowMs: 60_000, maxRequests: 30 },
  // Rejects any second verification of the same challenge — recommended in production.
  // Without this, captured {challenge, answer} payloads can be replayed until challenge TTL.
  replayGuard: new ChallengeReplayGuard(),
})
app.get('/imrobot/challenge', agentRouter.challenge)
app.post('/imrobot/verify', agentRouter.verify)

// Protect a route — only agents with a valid proof token can enter
const agentOnly = requireAgent({ secret: process.env.IMROBOT_SECRET! })

app.get('/api/agent-data', agentOnly, (req, res) => {
  res.json({ secret: 'only bots see this', agent: req.agentProof })
})

app.listen(3000, () => console.log('Server on :3000'))
```

**2. Agent solves the challenge (copy-paste runnable)**

```typescript
// agent.ts — run this from any TypeScript/JavaScript environment
import { solveChallenge } from 'imrobot/core'

const BASE = 'http://localhost:3000'

// Step 1: fetch a signed challenge from the server
const { challenge } = await fetch(`${BASE}/imrobot/challenge`).then(r => r.json())

// Step 2: solve the pipeline deterministically (< 1ms)
const answer = solveChallenge(challenge)

// Step 3: submit the answer and receive a proof token (JWT)
const { token } = await fetch(`${BASE}/imrobot/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ challenge, answer }),
}).then(r => r.json())

console.log('Got proof token:', token)
// eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Step 4: call the protected endpoint
const data = await fetch(`${BASE}/api/agent-data`, {
  headers: { 'X-Agent-Proof': token },
}).then(r => r.json())

console.log(data)
// { secret: 'only bots see this', agent: { challengeId: 'ch_...', difficulty: 'medium', ... } }
```

**What happens end-to-end:**

```
Agent                          Server
  |                               |
  |-- GET /imrobot/challenge ---→ |  generates HMAC-signed challenge
  |← { challenge }  ------------ |  { id, seed, pipeline, signature, expiresAt }
  |                               |
  |  solveChallenge(challenge)    |  (local, < 1ms)
  |  answer = "3F9A..."           |
  |                               |
  |-- POST /imrobot/verify -----→ |  verifies HMAC, answer, expiry, replay guard
  |← { token: "eyJ..." } ------- |  issues HS256 JWT (X-Agent-Proof)
  |                               |
  |-- GET /api/agent-data ------→ |  requireAgent middleware validates JWT
  |← { secret: "..." } --------- |  route handler runs
```

**Try it in 30 seconds with the CLI:**

```bash
npx imrobot solve --difficulty medium
# Solved in 0.4ms → answer: "3F9A8C..."

npx imrobot benchmark --count 1000
# 1000 challenges solved, avg 0.31ms, p99 0.8ms
```

## Quick start

### React

```tsx
import { ImRobot } from 'imrobot/react'

function App() {
  return (
    <ImRobot
      difficulty="medium"
      theme="light"
      onVerified={(token) => {
        console.log('Robot verified!', token)
      }}
    />
  )
}
```

### Vue

```vue
<script setup>
import { ImRobot } from 'imrobot/vue'

function handleVerified(token) {
  console.log('Robot verified!', token)
}
</script>

<template>
  <ImRobot difficulty="medium" theme="light" @verified="handleVerified" />
</template>
```

### Svelte

```svelte
<script>
  import ImRobot from 'imrobot/svelte'
</script>

<ImRobot
  difficulty="medium"
  theme="light"
  onVerified={(token) => console.log('Robot verified!', token)}
/>
```

### Web Component (Angular, vanilla JS, anything)

```html
<script type="module">
  import { register } from 'imrobot/web-component'
  register() // registers <imrobot-widget>
</script>

<imrobot-widget difficulty="medium" theme="light"></imrobot-widget>

<script>
  document.querySelector('imrobot-widget').addEventListener('imrobot-verified', (e) => {
    console.log('Robot verified!', e.detail)
  })
</script>
```

### Core API (headless)

```ts
import { generateChallenge, solveChallenge, verifyAnswer } from 'imrobot/core'

const challenge = generateChallenge({ difficulty: 'medium' })
const answer = solveChallenge(challenge)
const isValid = verifyAnswer(challenge, answer) // true
```

### Server SDK (HMAC-signed verification)

For production use, the server SDK provides tamper-proof, stateless challenge verification using HMAC-SHA256. No database required — the cryptographic signature ensures integrity.

```ts
import { createVerifier } from 'imrobot/server'

const verifier = createVerifier({
  secret: process.env.IMROBOT_SECRET!, // min 16 chars
  difficulty: 'medium',
})

// API route: generate a signed challenge
app.get('/api/challenge', async (req, res) => {
  const challenge = await verifier.generate()
  res.json(challenge) // includes HMAC signature
})

// API route: verify agent's answer (stateless)
app.post('/api/verify', async (req, res) => {
  const { challenge, answer } = req.body
  const result = await verifier.verify(challenge, answer)
  // result: { valid: true, elapsed: 42, suspicious: false }
  // or:     { valid: false, reason: 'wrong_answer' | 'expired' | 'invalid_hmac' | 'tampered' | 'replay' }
  res.json(result)
})
```

The server verifier checks in order: HMAC signature validity (challenge and pipeline not tampered), expiration (challenge not expired), answer correctness (pipeline re-executed), and replay detection (duplicate challenge IDs are rejected when a replay guard is configured). A different secret on a different server will reject the challenge — preventing cross-site replay attacks.

### Middleware & Proof-of-Agent tokens

Protect your API endpoints with framework-agnostic middleware. Verified agents receive a **standards-compliant JWT** (RFC 7519, `alg: HS256`) that they pass via `X-Agent-Proof` header on subsequent requests. The token decodes cleanly with any JWT library (`jose`, `jsonwebtoken`, `jwt-decode`, ...).

Token shape:

```json
// Header
{ "alg": "HS256", "typ": "JWT", "kid": "k-2026-04" }

// Payload (claims in seconds-since-epoch per RFC 7519 §4.1.4)
{
  "iss": "imrobot",
  "sub": "agent_123",
  "iat": 1711540860,
  "nbf": 1711540860,
  "exp": 1711544460,
  "jti": "imr_abcd1234",
  "imr": {
    "challenge_id": "ch_abc",
    "difficulty": "hard",
    "solve_time_ms": 42,
    "suspicious": false,
    "version": 2,
    "turnstile_verified": true
  }
}
```

```ts
import { requireAgent, createAgentRouter } from 'imrobot/server'

// Mount challenge/verify endpoints with rate limiting
const router = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!,
  rateLimit: { windowMs: 60_000, maxRequests: 30 },
})
app.get('/imrobot/challenge', router.challenge)
app.post('/imrobot/verify', router.verify)

// Protect routes — only verified agents can access
const agentOnly = requireAgent({
  secret: process.env.IMROBOT_SECRET!,
  rateLimit: { windowMs: 60_000, maxRequests: 30 },
})
app.get('/api/data', agentOnly, (req, res) => {
  res.json({ agent: req.agentProof })
})
```

#### `trustProxy` option

Both `requireAgent` and `createAgentRouter` accept a `trustProxy` option that controls how client IPs are resolved for rate limiting. When running behind a reverse proxy (nginx, Cloudflare, etc.), set `trustProxy: true` to read the real client IP from `X-Forwarded-For` / `X-Real-IP` headers instead of `req.ip`.

```ts
import { requireAgent, createAgentRouter } from 'imrobot/server'

// Behind a trusted reverse proxy
const agentOnly = requireAgent({
  secret: process.env.IMROBOT_SECRET!,
  trustProxy: true, // reads X-Forwarded-For for accurate IP-based rate limiting
  rateLimit: { windowMs: 60_000, maxRequests: 30 },
})

const router = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!,
  trustProxy: true,
})
```

> **Warning:** Only enable `trustProxy` when your server is behind a trusted proxy. Enabling it on a public-facing server allows clients to spoof their IP and bypass rate limiting.

#### Combined handler

Alternatively, use the combined `.handler` property to route both GET and POST requests to a single path:

```ts
import { createAgentRouter } from 'imrobot/server'

const router = createAgentRouter({ secret: process.env.IMROBOT_SECRET! })

// Routes GET → /challenge and POST → /verify under one path
app.use('/imrobot', router.handler)
```

The handler automatically routes based on HTTP method:
- **GET** → challenge endpoint (returns a signed challenge)
- **POST** → verify endpoint (verifies answer, returns proof token)
- **Other methods** → 405 Method Not Allowed

### Rate limiting

Both `createAgentRouter` and `requireAgent` support built-in **sliding-window** rate limiting to protect against brute-force attacks and request flooding. The rate limiter is in-memory, zero-dependency, and avoids the 2× boundary burst that fixed-window counters allow.

```ts
import { createAgentRouter } from 'imrobot/server'

const router = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!,
  rateLimit: {
    windowMs: 60_000, // 1-minute sliding window
    maxRequests: 30, // max 30 requests per window per IP
    onLimitReached: (key) => console.warn(`Rate limited: ${key}`),
  },
})
```

When a client exceeds the limit, they receive a `429 Too Many Requests` response with standard headers. `X-RateLimit-Reset` is in **seconds since epoch** (matching the GitHub / IETF convention), and `Retry-After` is in seconds (RFC 6585):

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 30
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1711540860
Retry-After: 45
```

The `RateLimiter` class can also be used standalone:

```ts
import { RateLimiter } from 'imrobot/server'

const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 })

if (!limiter.isAllowed(clientIp)) {
  // Handle rate limit exceeded
}

const status = limiter.getStatus(clientIp)
// { remaining: 7, resetAt: 1711540860000 }
```

| Option           | Type            | Default | Description                              |
| ---------------- | --------------- | ------- | ---------------------------------------- |
| `windowMs`       | `number`        | `60000` | Sliding window duration in ms            |
| `maxRequests`    | `number`        | `30`    | Max requests per window per key          |
| `onLimitReached` | `(key) => void` | —       | Callback when a client exceeds the limit |

Expired entries are automatically cleaned up to prevent memory leaks in long-running servers.

### Cloudflare Turnstile integration

`createAgentRouter` optionally integrates with [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) — a privacy-preserving CAPTCHA alternative — as an extra human-verification layer alongside the imrobot proof-of-work challenge.

When configured, the `/verify` endpoint reads the `cf-turnstile-response` header, validates the token against Cloudflare's siteverify API, and stamps the result (`turnstile_verified: true/false`) into the issued proof token. Zero external dependencies — uses Node 18+ native `fetch`.

```ts
import { createAgentRouter } from 'imrobot/server'

const router = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!,
  turnstile: {
    // Load from env — never hardcode. Must be ≥16 non-whitespace characters.
    secretKey: process.env.TURNSTILE_SECRET_KEY!,
    tokenHeader: 'cf-turnstile-response', // default, matches Cloudflare widget output
    required: false,                       // default — non-breaking, won't block existing clients
    timeoutMs: 5000,                       // siteverify timeout (default 5s; 0 disables)
  },
})
```

The siteverify call uses an `AbortController` with a configurable `timeoutMs` so a slow Cloudflare response can never hang your verify endpoint. On timeout the result is `{ success: false, errorCodes: ['timeout'] }` and the request is treated like any other Turnstile failure (per your `required` setting).

On the client side, include the Turnstile widget and pass its token as a request header:

```html
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY" data-callback="onTurnstileSuccess"></div>

<script>
  function onTurnstileSuccess(token) {
    // Pass token when submitting the imrobot verify request
    fetch('/imrobot/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-turnstile-response': token,
      },
      body: JSON.stringify({ challenge, answer }),
    })
  }
</script>
```

The standalone `TurnstileVerifier` class and `verifyTurnstileToken` function are also exported for use outside of `createAgentRouter`:

```ts
import { TurnstileVerifier, verifyTurnstileToken } from 'imrobot/server'

// Class-based
const verifier = new TurnstileVerifier({
  secretKey: process.env.TURNSTILE_SECRET_KEY!,
})
const result = await verifier.verify(cfToken, clientIp)
// { success: true, hostname: 'example.com', challenge_ts: '...', errorCodes: [] }

// Standalone function
const result = await verifyTurnstileToken(secretKey, cfToken, clientIp)
```

**Behaviour by `required` flag:**

| `required` | Token absent | Token invalid | Token valid |
|---|---|---|---|
| `false` (default) | token issued, no `turnstile_verified` flag | token issued, `turnstile_verified: false` | token issued, `turnstile_verified: true` |
| `true` | `400 TURNSTILE_TOKEN_REQUIRED` | `400 TURNSTILE_VERIFICATION_FAILED` | token issued, `turnstile_verified: true` |

Set `required: false` initially for a non-breaking rollout — you can enforce it once all clients send the header.

> **Security note:** The secret key must always be loaded from `process.env.TURNSTILE_SECRET_KEY`. Never hardcode it.

### Key rotation (`kid`) and clock skew

Both `requireAgent` and `createAgentRouter` accept a `keyId` (embedded as `kid` in the JWT header) and a `previousSecrets` array so you can rotate signing secrets without invalidating outstanding tokens:

```ts
const router = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!,         // active key
  keyId: 'k-2026-04',                          // identifies the active key
  previousSecrets: [
    { keyId: 'k-2026-01', secret: process.env.IMROBOT_SECRET_PREV! },
  ],
  clockSkewSec: 5,                             // tolerate ±5s drift on iat/nbf/exp (default 5, max 300)
})
```

- New tokens are signed with `secret` and stamped with `kid: keyId`.
- Verification looks up the secret by the token's `kid`. If `kid` is unknown the request is rejected with `403`.
- Tokens issued before you started setting `keyId` (no `kid` header) verify against the active `secret`.

Roll a key by deploying with the new `secret`/`keyId` while moving the previous one into `previousSecrets`. Once your max token TTL has elapsed, you can drop the old entry.

### Web Bot Auth (verify cryptographically-signed agents)

The industry is converging on [Web Bot Auth](https://datatracker.ietf.org/doc/draft-meunier-web-bot-auth-architecture/) (an IETF effort backed by Cloudflare, Google, AWS, Vercel, Shopify, and OpenAI) — agents sign their requests with an Ed25519 key ([RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/rfc/rfc9421)) and publish the public key at a `.well-known/http-message-signatures-directory`. imrobot can verify those signatures directly, so you can recognise a trusted signed agent (OpenAI Operator, Cloudflare signed agents, etc.) instead of challenging it.

```ts
import { WebBotAuthVerifier } from 'imrobot/server'

const verifier = new WebBotAuthVerifier({
  directoryUrl: 'https://my-agent.example/.well-known/http-message-signatures-directory',
})

// `req` only needs { method, url, headers } — Express, Koa, raw Node, etc.
const result = await verifier.verify(req)
if (result.verified) {
  // Trusted signed agent — skip the imrobot challenge entirely
  console.log('Signed agent verified, keyid:', result.keyid)
}
```

The verifier reconstructs the signature base from the covered components (`@method`, `@authority`, `@path`, `@query`, and any header field), fetches the key directory (cached, default 5 min), and verifies the Ed25519 signature with Web Crypto — zero external dependencies. On failure, `result.reason` is one of `no_signature`, `malformed`, `unsupported_alg`, `tag_mismatch`, `not_yet_valid`, `expired`, `unknown_key`, `directory_error`, or `bad_signature`.

A standalone `verifyWebBotAuthSignature(req, config)` is also exported.

#### As a layer on `createAgentRouter`

Web Bot Auth can run alongside the challenge flow. When configured, the `/verify` endpoint checks for a signature and stamps `web_bot_auth_verified` into the issued proof token (mirroring the Turnstile integration):

```ts
const router = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!,
  webBotAuth: {
    directoryUrl: 'https://my-agent.example/.well-known/http-message-signatures-directory',
    required: false, // default — record the result but don't block unsigned callers
  },
})
```

| `required` | Signature absent | Signature invalid | Signature valid |
|---|---|---|---|
| `false` (default) | token issued, no flag | token issued, `web_bot_auth_verified: false` | token issued, `web_bot_auth_verified: true` |
| `true` | `400 WEB_BOT_AUTH_REQUIRED` | `400 WEB_BOT_AUTH_VERIFICATION_FAILED` | token issued, `web_bot_auth_verified: true` |

### Invisible verification (zero-UI)

For agents that need to verify themselves programmatically without any UI:

```ts
import { invisibleVerify } from 'imrobot/core'

const result = await invisibleVerify({
  challengeUrl: 'https://api.example.com/imrobot/challenge',
  verifyUrl: 'https://api.example.com/imrobot/verify',
  agentId: 'my-bot-v1',
  maxRetries: 3,
})

if (result.success) {
  // Use result.proofToken in X-Agent-Proof header
  fetch('/api/protected', {
    headers: { 'X-Agent-Proof': result.proofToken! },
  })
}
```

### CLI

Built-in CLI for testing, benchmarking, and inspecting challenges:

```bash
npx imrobot challenge --difficulty hard
npx imrobot solve --difficulty medium
npx imrobot benchmark --count 1000
npx imrobot info
```

### Agent discovery (`.well-known/imrobot.json`)

Inspired by the [A2A Agent Card](https://google.github.io/A2A/) pattern, imrobot supports a discovery endpoint that lets AI agents automatically find and interact with your imrobot-protected service.

```ts
import { createDiscoveryHandler, createAgentRouter, requireAgent } from 'imrobot/server'

// Mount the discovery endpoint
const discovery = createDiscoveryHandler({
  challengePath: '/imrobot',
  name: 'My Agent API',
  description: 'Agent-verified data service',
})
app.get('/.well-known/imrobot.json', discovery)

// Mount challenge/verify as usual
const router = createAgentRouter({ secret: process.env.IMROBOT_SECRET! })
app.get('/imrobot/challenge', router.challenge)
app.post('/imrobot/verify', router.verify)
```

Agents fetch `/.well-known/imrobot.json` and receive a structured document describing the protocol, endpoint paths, supported difficulty levels, and step-by-step instructions for completing verification:

```json
{
  "protocol": "imrobot",
  "version": "1.0",
  "endpoints": {
    "challenge": "/imrobot/challenge",
    "verify": "/imrobot/verify",
    "proofHeader": "X-Agent-Proof"
  },
  "difficulties": ["easy", "medium", "hard"],
  "instructions": "1. GET the challenge endpoint..."
}
```

For framework-agnostic usage (Hono, Koa, Fastify, etc.), use `buildDiscoveryDocument()` directly:

```ts
import { buildDiscoveryDocument } from 'imrobot/server'

const doc = buildDiscoveryDocument({ challengePath: '/imrobot' })
// Serve `doc` as JSON at /.well-known/imrobot.json
```

`createDiscoveryHandler` sets sensible defaults so third-party agents can fetch the document from any origin and cache it:

```
Content-Type: application/json; charset=utf-8
Cache-Control: public, max-age=3600
Access-Control-Allow-Origin: *
Vary: Origin
```

Override either with `cacheControl` / `corsOrigin`. Pass `null` to omit:

```ts
createDiscoveryHandler({
  cacheControl: 'no-store',                  // disable caching
  corsOrigin: 'https://agents.example.com',  // restrict CORS
})
```

## Screenshot protection

The challenge text is **blurred by default** and only revealed when the user hovers over it. This defeats screenshot-based attacks (screen capture tools, CDP screenshots, PrintScreen) since the captured image shows only blurred content.

An additional JavaScript shield detects screenshot shortcuts (PrintScreen, Cmd+Shift+3/4/5, Ctrl+Shift+S) and window blur/visibility changes, applying an extra blur layer that overrides even the hover state.

Combined with the hidden nonce (not displayed visually) and TTL expiry, this makes screenshot+OCR workflows ineffective — even if the blur were bypassed, the nonce is missing from the visual output.

> **Note:** AI agents are unaffected — they read challenge data from the DOM, not from the screen.

### Using the shield in vanilla JS

The screenshot shield is exported for use outside the bundled components:

```js
import { setupScreenshotShield } from 'imrobot'

const cleanup = setupScreenshotShield((shielded) => {
  // shielded: true when a screenshot attempt is detected
  // automatically resets to false after 1.2s
})

// Call cleanup() to remove event listeners
```

## How agents interact with it

AI agents read the challenge data directly from the DOM via the `data-imrobot-challenge` attribute — they never need to "see" the visual text, so blur has no effect on them.

1. **Read the challenge** from `data-imrobot-challenge` attribute (JSON)
2. **Execute the pipeline** — each operation is a deterministic transform
3. **Submit the answer** via the input field or programmatically

```js
// Agent reads challenge from DOM (unaffected by blur)
const el = document.querySelector('[data-imrobot-challenge]')
const challenge = JSON.parse(el.dataset.imrobotChallenge)

// Agent solves it (or implement the pipeline yourself)
import { solveChallenge } from 'imrobot/core'
const answer = solveChallenge(challenge)

// Agent fills in the answer and clicks verify
const input = el.querySelector('input')
input.value = answer
input.dispatchEvent(new Event('input', { bubbles: true }))
el.querySelector('button').click()
```

## Natural-language challenge formatting

By default, challenges display operations in programmatic syntax (`reverse()`, `caesar(7)`). For deployments where you want to make regex-based scraping of the display text harder, use the natural-language formatting functions:

```ts
import { formatOperationNL, formatPipelineNL } from 'imrobot/core'

const challenge = generateChallenge({ difficulty: 'hard' })

// Each call produces randomised phrasing:
console.log(formatPipelineNL(challenge.visibleSeed, challenge.pipeline))
// "Begin with the text: "a7f3..."
//  Step 1: Flip the string backwards
//  Then 2: Shift every letter 7 positions in the alphabet
//  Next 3: Bitwise-XOR every character with the value 42
//  ..."
```

Every operation has 3–4 distinct phrasings that are randomly selected on each call, so the display text varies unpredictably. Agents must parse the JSON `pipeline` (unaffected), while regex scraping of the visual text becomes unreliable.

> **Tip:** The original programmatic functions `formatOperation` / `formatPipeline` remain unchanged — use them when you need a stable, deterministic format.

## Operations reference

### String operations

| Operation            | Description             | Example                  |
| -------------------- | ----------------------- | ------------------------ |
| `reverse()`          | Reverse the string      | `"abc"` → `"cba"`        |
| `to_upper()`         | Convert to uppercase    | `"abc"` → `"ABC"`        |
| `to_lower()`         | Convert to lowercase    | `"ABC"` → `"abc"`        |
| `base64_encode()`    | Base64 encode           | `"hello"` → `"aGVsbG8="` |
| `rot13()`            | ROT13 cipher            | `"hello"` → `"uryyb"`    |
| `hex_encode()`       | Hex encode each char    | `"AB"` → `"4142"`        |
| `sort_chars()`       | Sort characters         | `"dcba"` → `"abcd"`      |
| `char_code_sum()`    | Sum of char codes       | `"AB"` → `"131"`         |
| `substring(s, e)`    | Extract substring       | `"abcdef"` → `"cde"`     |
| `repeat(n)`          | Repeat string n times   | `"ab"` → `"ababab"`      |
| `replace(s, r)`      | Replace all occurrences | `"aab"` → `"xxb"`        |
| `pad_start(len, ch)` | Pad start to length     | `"abc"` → `"000abc"`     |
| `vowel_count()`      | Count vowels            | `"hello"` → `"2"`        |
| `consonant_extract()`| Extract consonants only | `"hello"` → `"hll"`      |
| `run_length_encode()` | Run-length encode      | `"aaabb"` → `"3a2b"`     |
| `atbash()`           | Atbash cipher (a↔z)    | `"abc"` → `"zyx"`        |

### Byte & cipher operations

| Operation            | Description                           | Example                         |
| -------------------- | ------------------------------------- | ------------------------------- |
| `caesar(shift)`      | Caesar cipher with configurable shift | `"abc"` + shift 1 → `"bcd"`     |
| `xor_encode(key)`    | XOR each byte with key                | `"AB"` + key 1 → `"@C"`         |
| `count_chars(char)`  | Count occurrences of a char           | `"aababc"` + char `"a"` → `"3"` |
| `slice_alternate()`  | Keep every other character            | `"abcdef"` → `"ace"`            |
| `fnv1a_hash()`       | FNV-1a hash of the string             | `"test"` → `"bc2c0be9"`         |
| `length()`           | String length as string               | `"hello"` → `"5"`               |
| `fnv1a_cascade()`    | Cascaded FNV-1a, 8 rounds → 64 hex chars | deterministic hex output     |
| `sha256_hash()`      | **Misnomer — alias of `fnv1a_cascade()`.** Kept for wire-format compatibility. NOT real SHA-256. | identical output to `fnv1a_cascade` |
| `byte_xor(key[])`    | XOR each byte with key array (cycling) | byte-level encryption          |
| `hash_chain(rounds)` | Iterated FNV-1a hash                  | cascaded hashing                |
| `nibble_swap()`      | Swap high/low nibbles per byte        | `0xAB` → `0xBA`                 |
| `bit_rotate(bits)`   | Rotate bits left within byte          | bitwise rotation                |

> **About `sha256_hash`:** The op name is preserved for wire-format compatibility with already-issued challenges, but the implementation has always been FNV-1a cascaded 8 times — not RFC 6234 SHA-256. Use `fnv1a_cascade` in new code; both names produce identical output.

## Configuration

| Prop         | Type                              | Default        | Description                                                      |
| ------------ | --------------------------------- | -------------- | ---------------------------------------------------------------- |
| `difficulty` | `'easy' \| 'medium' \| 'hard'`    | `'medium'`     | Number and complexity of operations                              |
| `theme`      | `'light' \| 'dark'`               | `'light'`      | Color theme                                                      |
| `size`       | `'compact' \| 'standard'`         | `'standard'`   | Widget size — `compact` for smaller footprint (320px). Supported by all four adapters (React, Vue, Svelte, Web Component). |
| `ttl`        | `number`                          | per-difficulty | Challenge time-to-live in ms (easy: 30s, medium: 20s, hard: 15s) |
| `onVerified` | `(token) => void`                 | —              | Callback on successful verification                              |
| `onError`    | `(error) => void`                 | —              | Callback on failed verification                                  |

### Difficulty levels

- **easy**: 2-3 simple operations (reverse, case, sort, length, slice_alternate, vowel_count, atbash)
- **medium**: 3-5 operations including encoding, extraction, caesar, char counting, consonant_extract, run_length_encode
- **hard**: 5-7 operations including XOR encoding, hashing, replacement, padding, SHA-256, byte XOR, hash chains, nibble swap, and bit rotate

## Server verification

For production deployments, use the server SDK (`imrobot/server`) instead of client-side-only verification. The server SDK uses HMAC-SHA256 to sign challenges, providing tamper-proof, stateless, replay-resistant verification with zero database overhead.

```ts
import { createVerifier } from 'imrobot/server'

const verifier = createVerifier({
  secret: process.env.IMROBOT_SECRET!, // HMAC secret (min 16 chars)
  difficulty: 'hard',
  ttl: 10_000, // optional: override default TTL
})

// Generate → send to client → client solves → verify answer
const challenge = await verifier.generate()
const result = await verifier.verify(challenge, agentAnswer)
```

#### Replay protection

To prevent the same challenge from being verified more than once, pass a `ChallengeReplayGuard` instance to `createVerifier()`:

```ts
import { createVerifier, ChallengeReplayGuard } from 'imrobot/server'

const replayGuard = new ChallengeReplayGuard({
  maxAge: 5 * 60 * 1000,     // track IDs for 5 minutes
  cleanupInterval: 60_000,   // purge expired entries every minute
})

const verifier = createVerifier({
  secret: process.env.IMROBOT_SECRET!,
  difficulty: 'medium',
  replayGuard, // enables replay detection
})

// First verify() succeeds; second verify() with the same challenge
// returns { valid: false, reason: 'replay' }
```

The replay guard is in-memory with automatic expiry cleanup and `unref()`'d timers, so it won't keep the process alive. Call `replayGuard.destroy()` on shutdown to clear the cleanup interval.

#### Redis replay guard (multi-instance deployments)

For production deployments running multiple server instances, use `RedisReplayStore` instead of the default in-memory guard. It uses Redis `SET NX` with TTL for atomic, race-condition-safe replay detection that persists across restarts and works across all instances.

Install `ioredis` (optional peer dependency):

```bash
npm install ioredis
```

```ts
import Redis from 'ioredis'
import { createVerifier, RedisReplayStore } from 'imrobot/server'

const redis = new Redis({ host: 'localhost', port: 6379 })

const replayGuard = new RedisReplayStore(redis, {
  ttlMs: 5 * 60 * 1000,       // how long IDs stay in Redis (5 min)
  keyPrefix: 'imrobot:replay:', // optional namespace prefix
})

// Verification is now async — use markUsedAsync directly, or plug in as a
// custom middleware step before calling verifier.verify()
const allowed = await replayGuard.markUsedAsync(challengeId)
if (!allowed) {
  return res.status(403).json({ error: 'Replay attack detected' })
}

// Shut down: close the Redis connection (not the store — it holds no resources)
process.on('SIGTERM', () => redis.quit())
```

The `RedisReplayStore` exposes async methods (`markUsedAsync`, `isUsedAsync`, `deleteAsync`, `resetAsync`) to match Redis's inherently asynchronous I/O model. `destroy()` is a no-op — lifecycle of the Redis connection is owned by the caller.

### ChallengeAnalytics

`ChallengeAnalytics` (exported from `imrobot/server`) is a lightweight, in-memory metrics tracker for monitoring challenge activity — generation rates, verification rates, solve-time percentiles, and failure-reason distributions. Zero external dependencies, memory-bounded (sliding window of configurable size).

```ts
import { ChallengeAnalytics } from 'imrobot/server'

const analytics = new ChallengeAnalytics({
  maxSamples: 1000,          // solve-time samples kept per difficulty (default: 1000)
  trackFailureReasons: true, // track per-reason failure counts (default: true)
})

// Record events as they happen
analytics.recordGenerated('medium')
analytics.recordVerified('medium', 142, false) // 142ms, not suspicious
analytics.recordFailed('hard', 'wrong_answer')

// Get a full snapshot
const stats = analytics.getStats()
console.log(stats.summary.verificationRate)        // 0.5 (50%)
console.log(stats.byDifficulty.medium.avgSolveTimeMs) // 142
console.log(stats.byDifficulty.hard.failureReasons)   // { wrong_answer: 1 }

// Export for dashboards / structured logging
console.log(JSON.stringify(analytics.toJSON(), null, 2))

// Periodic rotation — reset all counters
analytics.reset()
```

`getStats()` returns an `AnalyticsSnapshot` with:
- **`summary`** — aggregate totals: `totalGenerated`, `totalVerified`, `totalFailed`, `totalExpired`, `totalSuspicious`, `verificationRate`, `avgSolveTimeMs`, `uptimeMs`
- **`byDifficulty`** — per-difficulty `DifficultyStats` with min/max/p95 solve times and per-reason failure counts
- **`collectedAt`** — Unix timestamp of the snapshot

### VerifyResult

The `verify()` method returns a `VerifyResult`:

```ts
interface VerifyResult {
  valid: boolean
  reason?: 'expired' | 'invalid_hmac' | 'wrong_answer' | 'tampered' | 'replay'
  elapsed?: number // ms since challenge was created
  suspicious?: boolean // true if response was unusually slow
}
```

## Token

On successful verification, `onVerified` receives an `ImRobotToken`:

```ts
interface ImRobotToken {
  challengeId: string // Unique challenge identifier
  answer: string // The correct answer
  timestamp: number // Verification timestamp
  elapsed: number // Time taken to solve (ms)
  suspicious: boolean // true if elapsed > 5s (possible human relay)
  signature: string // Verification signature
}
```

## Adaptive difficulty

The adaptive difficulty engine auto-adjusts challenge difficulty per agent based on behavioral patterns — inspired by Arkose Labs (FunCaptcha) progressive difficulty and reCAPTCHA v3 risk scoring.

```ts
import { AdaptiveDifficulty } from 'imrobot/core'

const adaptive = new AdaptiveDifficulty({
  initialDifficulty: 'medium',
  escalateAfterFailures: 2,  // escalate after 2 consecutive failures
  relaxAfterSuccesses: 5,    // relax after 5 consecutive successes
})

// Record outcomes as agents solve challenges
adaptive.recordAttempt('agent_123', { success: true, solveTimeMs: 42 })

// Get recommended difficulty for next challenge
const diff = adaptive.getDifficulty('agent_123') // 'medium' | 'easy' | 'hard'

// Get risk assessment (0-1 score with breakdown)
const risk = adaptive.getRiskAssessment('agent_123')
// { score: 0.15, level: 'low', factors: { failureRate, abnormalTiming, rapidAttempts, inconsistentTiming } }

// Get just the numeric score (shorthand)
const score = adaptive.getRiskScore('agent_123') // 0.15
```

The risk score weighs four factors: failure rate (35%), abnormal timing (25%), rapid-fire attempts (25%), and inconsistent solve times (15%). Risk levels: `low` | `medium` | `high` | `critical`.

## AI image challenges (experimental)

Foundation for AI-generated image verification challenges. Pre-generate pools of images with known ground truth, then serve them as additional challenge layers.

```ts
import { ImageChallengePool } from 'imrobot/core'

// Option 1: Static provider (pre-generated images, no API needed)
const pool = new ImageChallengePool({
  provider: {
    type: 'static',
    images: [
      { imageUrl: '/img/kitchen-3-apples.png', type: 'object_count', question: 'How many red apples?', answer: '3' },
      { imageUrl: '/img/park-bench.png', type: 'spatial_reasoning', question: 'What is to the left of the bench?', answer: 'tree' },
    ],
  },
})

// Option 2: Custom provider (bring your own AI image generator)
const pool2 = new ImageChallengePool({
  provider: {
    type: 'custom',
    generate: async (prompt) => {
      const result = await myImageGenerator(prompt)
      return { imageUrl: result.url }
    },
  },
  poolSize: 100,
  challengeTypes: ['object_count', 'spatial_reasoning', 'color_identification'],
  rotationIntervalMs: 3_600_000, // rotate pool every hour
})

await pool.initialize()
const challenge = pool.getChallenge()
const isCorrect = pool.verifyAnswer(challenge.id, userAnswer)
```

Six challenge types are supported: `object_count`, `spatial_reasoning`, `color_identification`, `scene_description`, `text_recognition`, and `odd_one_out`. Each type includes built-in prompt templates that generate prompts with known ground truth.

> **Warning:** The `openai` and `stability` providers are not yet implemented and will throw at runtime. Use `custom` or `static` providers instead.

## OpenTelemetry metrics

`ChallengeOTelExporter` (exported from `imrobot/server`) bridges the in-memory `ChallengeAnalytics` tracker to any OpenTelemetry-compatible backend — Datadog, Grafana, Prometheus, or any OTLP endpoint.

Install the optional peer dependencies:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-metrics @opentelemetry/exporter-metrics-otlp-http
```

```ts
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { ChallengeAnalytics, ChallengeOTelExporter } from 'imrobot/server'

const analytics = new ChallengeAnalytics()

const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: 'http://localhost:4318/v1/metrics' }),
      exportIntervalMillis: 30_000,
    }),
  ],
})

const otelExporter = new ChallengeOTelExporter(analytics, meterProvider, {
  scopeName: 'imrobot',
  exportIntervalMs: 15_000,
})

otelExporter.start()

// Wire analytics into your verifier
const verifier = createVerifier({ secret: process.env.IMROBOT_SECRET!, analytics })

// On shutdown
process.on('SIGTERM', () => otelExporter.stop())
```

### Exported metrics

| Metric | Type | Attributes | Description |
|---|---|---|---|
| `imrobot.challenge.generated` | Counter | `difficulty` | Challenges generated |
| `imrobot.challenge.solved` | Counter | `difficulty` | Successfully verified challenges |
| `imrobot.challenge.failed` | Counter | `difficulty` | Failed verification attempts |
| `imrobot.challenge.solve_time_ms` | Histogram | `difficulty` | P95 solve time in ms |
| `imrobot.challenge.active` | ObservableGauge | — | Generated minus verified/failed |
| `imrobot.challenge.verification_rate` | ObservableGauge | — | Verified / total attempts (0.0–1.0) |

`@opentelemetry/api` is an optional peer dependency — the exporter uses the interface types only and does not hard-import the SDK.

## MCP server (Model Context Protocol)

imrobot ships a native MCP server that lets AI agents auto-discover and complete verification challenges without any custom integration code. Agents call the tools directly; no HTTP endpoints required.

```ts
import { createMCPServer } from 'imrobot/mcp'

// Start a stdio MCP server (use in Claude Desktop, Cursor, etc.)
createMCPServer({ defaultDifficulty: 'medium' }).start()
```

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "imrobot": {
      "command": "node",
      "args": ["-e", "import('imrobot/mcp').then(m => m.createMCPServer().start())"]
    }
  }
}
```

### Available MCP tools

| Tool | Description |
|---|---|
| `generate-challenge` | Generate a new verification challenge |
| `solve-challenge` | Auto-solve a challenge (returns answer + proof token) |
| `verify-answer` | Check if a computed answer is correct |
| `create-token` | Create a proof token after solving |
| `get-discovery-document` | Fetch the imrobot discovery document |

### Programmatic usage (no stdio)

```ts
import { createMCPServer } from 'imrobot/mcp'

const server = createMCPServer()

// Generate + auto-solve in one step
const challengeResp = await server.handleMessage(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'generate-challenge', arguments: { difficulty: 'easy' } }
}))

const { result } = JSON.parse(challengeResp)
const { challenge } = JSON.parse(result.content[0].text)

const solveResp = await server.handleMessage(JSON.stringify({
  jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: { name: 'solve-challenge', arguments: { challenge } }
}))

const { result: solveResult } = JSON.parse(solveResp)
const { token } = JSON.parse(solveResult.content[0].text)
// Use token.challengeId + token.signature for X-Agent-Proof header
```

The MCP server has zero runtime dependencies — it implements JSON-RPC 2.0 directly and calls the same core API that agents use.

## Ecosystem

imrobot is designed to integrate with the broader AI agent ecosystem:

| Integration | Description |
|---|---|
| **Cloudflare Turnstile** | Layer human-verification alongside the proof-of-work challenge. `turnstile_verified` is stamped into the issued JWT. |
| **Web Bot Auth (IETF)** | Verify Ed25519-signed agents (OpenAI Operator, Cloudflare signed bots) directly. Skip the challenge for trusted known agents. |
| **Pollinations.ai** *(coming)* | Use the free, no-auth Pollinations.ai image generation API to power the `ImageChallengePool` custom provider — zero API keys, zero cost. Generates on-demand image challenges with deterministic ground truth. |
| **A2A Agent Card** | `/.well-known/imrobot.json` follows the A2A Agent Card pattern so discovery-enabled agents find your protected endpoints automatically. |
| **Any JWT library** | Proof tokens are standard HS256 JWTs — verify with `jose`, `jsonwebtoken`, Python `PyJWT`, Go `golang-jwt`, or any RFC 7519-compliant library. |


## Blog posts & articles

- [Why I built a CAPTCHA that only bots can solve](https://dev.to/leo_pechnicki/why-i-built-a-captcha-that-only-bots-can-solve-30np) — Dev.to article introducing imrobot: the motivation, design decisions, and how it works under the hood


## FAQ — How does imrobot compare to Turnstile / ALTCHA / reCAPTCHA?

imrobot solves the **opposite** problem from traditional CAPTCHA systems.

| | imrobot | Cloudflare Turnstile | ALTCHA | reCAPTCHA / hCaptcha | Friendly Captcha |
|---|---|---|---|---|---|
| **Goal** | Verify the visitor **is a bot / AI agent** | Verify the visitor is **human** | Verify the visitor is **human** | Verify the visitor is **human** | Verify the visitor is **human** |
| **Who should pass?** | AI agents, bots, automated scripts | Humans only | Humans only | Humans only | Humans only |
| **Who should fail?** | Humans (hard to solve manually) | Bots | Bots | Bots | Bots |
| **Challenge type** | Deterministic pipeline (string transforms, hashing) | Browser fingerprint + JS proof-of-work | Server-side SHA-256 PoW | Image/audio recognition | SHA-256 PoW |
| **AI-solvable?** | Yes, by design (< 1 second for any LLM) | Not applicable | Yes, unintentionally | Yes (AI vision can solve) | Yes, unintentionally |
| **Use case** | Agent-only APIs, multi-agent auth, AI platforms | Public web forms | Public web forms | Public web forms | Public web forms |
| **Privacy** | Zero tracking, no fingerprinting | Privacy-preserving | Open-source, self-hosted | Google/third-party tracking | No tracking |
| **Self-hosted** | Yes (zero dependencies) | No (Cloudflare CDN) | Yes | No | Yes |
| **Open source** | Yes (MIT) | No | Yes (MIT) | No | Yes |

### When to use imrobot

Use imrobot when you want to **grant access to AI agents** and **deny access to humans**:

- Agent-only data APIs (price feeds, knowledge graphs, structured data exports)
- Multi-agent authentication (prove your caller is a legitimate AI client)
- AI platform gating (only LLM-powered clients may access a route)
- Testing / CI pipelines that simulate agent access

### When to use Turnstile / reCAPTCHA / ALTCHA

Use those when you want the opposite: protect your service from bots and allow only human users.

> **Can I use both?** Yes — some services authenticate agents via imrobot and gate human-facing forms with Turnstile on the same backend.

## FAQ — How does imrobot compare to HATCHA (Monday.com)?

[HATCHA](https://hatcha.monday.com) is Monday.com's reverse-CAPTCHA — the closest direct competitor to imrobot. Both solve the same problem (proving a caller is a bot, not a human) but take different approaches.

| | imrobot | HATCHA (Monday.com) |
|---|---|---|
| **Framework support** | React, Vue, Svelte, Web Component, headless core | Web Component only |
| **Token format** | Standards-compliant JWT (RFC 7519, HS256) — verify with any JWT library | Proprietary token format |
| **Challenge type** | Deterministic compute pipeline (string transforms, hashing, bitwise ops) | Reverse image recognition |
| **Image challenges** | Optional AI image layer (`ImageChallengePool`) | Always-on |
| **Zero dependencies** | Yes — 0 runtime deps | No |
| **Self-hosted** | Yes — deploy anywhere, no CDN lock-in | No — requires Monday.com CDN |
| **Open source** | Yes (MIT) | No |
| **Replay protection** | Built-in `ChallengeReplayGuard` (in-memory) + `RedisReplayStore` (multi-instance) | Unknown |
| **Adaptive difficulty** | Yes — per-agent risk scoring with 4 weighted factors | Unknown |
| **CLI tool** | Yes — `npx imrobot challenge\|solve\|verify\|benchmark` | No |
| **MCP integration** | Yes — `imrobot/mcp` for AI agent tooling | No |
| **Rate limiting** | Built-in sliding window rate limiter, per-IP, standard headers | Unknown |
| **Discovery endpoint** | Yes — `/.well-known/imrobot.json` (A2A-inspired Agent Card) | No |

**Key difference:** imrobot is framework-agnostic, self-hostable, and issues standard JWTs. HATCHA is a managed SaaS product with a single web-component integration. If you need zero CDN dependencies, multi-framework support, or JWT tokens that any downstream service can verify without calling Monday.com's servers, imrobot is the right choice.

## Contributing

Contributions are welcome! Feel free to open issues for bug reports or feature requests, or submit pull requests.

```bash
git clone https://github.com/leopechnicki/im_robot.git
cd im_robot
npm install
npm test
```

## License

MIT
