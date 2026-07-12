<div align="center">

# ðŸ¤– imrobot

**Reverse-CAPTCHA for AI agents â€” verify bots, not humans.**

[![npm version](https://img.shields.io/npm/v/imrobot.svg?style=flat-square&color=3b82f6)](https://www.npmjs.com/package/imrobot)
[![npm downloads](https://img.shields.io/npm/dw/imrobot.svg?style=flat-square&color=10b981)](https://www.npmjs.com/package/imrobot)
[![license](https://img.shields.io/npm/l/imrobot.svg?style=flat-square&color=6366f1)](https://github.com/leopechnicki/im_robot/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/leopechnicki/im_robot)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-22c55e?style=flat-square)](https://www.npmjs.com/package/imrobot)
[![coverage](https://img.shields.io/codecov/c/github/leopechnicki/im_robot?style=flat-square&color=f59e0b&logo=codecov&logoColor=white)](https://codecov.io/gh/leopechnicki/im_robot)
[![CI](https://img.shields.io/github/actions/workflow/status/leopechnicki/im_robot/ci.yml?branch=main&style=flat-square&label=CI&logo=github)](https://github.com/leopechnicki/im_robot/actions/workflows/ci.yml)

[Live Demo](https://imrobot.vercel.app) Â· [npm](https://www.npmjs.com/package/imrobot) Â· [Dev.to Article](https://dev.to/leo_pechnicki/why-i-built-a-captcha-that-only-bots-can-solve-30np)

</div>

---

## Why?

Traditional CAPTCHAs prove you're human. But what about the opposite?

As AI agents become first-class web citizens â€” browsing, booking, purchasing, automating â€” some systems need to verify their visitors are **legitimate AI agents**, not humans trying to bypass agent-only access. Think agent-facing APIs, AI-only platforms, or multi-agent authentication.

**imrobot** flips the CAPTCHA model: it generates deterministic challenge pipelines that are trivial for any LLM or programmatic agent to solve (< 1 second), but impractical for humans to work through manually.

## How it works

imrobot generates a pipeline of deterministic operations (string transforms, byte operations, hashing, and more) applied to a random seed. AI agents parse the structured challenge data, execute the pipeline, and submit the result. Humans would need to manually compute multi-step transformations â€” practically impossible without tools.

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

For production use, the server SDK provides tamper-proof, stateless challenge verification using HMAC-SHA256. No database required â€” the cryptographic signature ensures integrity.

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

The server verifier checks in order: HMAC signature validity (challenge and pipeline not tampered), expiration (challenge not expired), answer correctness (pipeline re-executed), and replay detection (duplicate challenge IDs are rejected when a replay guard is configured). A different secret on a different server will reject the challenge â€” preventing cross-site replay attacks.

### Middleware & Proof-of-Agent tokens

Protect your API endpoints with framework-agnostic middleware. Verified agents receive a JWT-like Proof-of-Agent token (HMAC-SHA256 signed) that they pass via `X-Agent-Proof` header on subsequent requests.

```ts
import { requireAgent, createAgentRouter } from 'imrobot/server'

// Mount challenge/verify endpoints with rate limiting
const router = createAgentRouter({
  secret: process.env.IMROBOT_SECRET!,
  rateLimit: { windowMs: 60_000, maxRequests: 30 },
})
app.get('/imrobot/challenge', router.challenge)
app.post('/imrobot/verify', router.verify)

// Protect routes â€” only verified agents can access
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

// Routes GET â†’ /challenge and POST â†’ /verify under one path
app.use('/imrobot', router.handler)
```

The handler automatically routes based on HTTP method:
- **GET** â†’ challenge endpoint (returns a signed challenge)
- **POST** â†’ verify endpoint (verifies answer, returns proof token)
- **Other methods** â†’ 405 Method Not Allowed

### Rate limiting

Both `createAgentRouter` and `requireAgent` support built-in rate limiting to protect against brute-force attacks and request flooding. The rate limiter is in-memory with zero external dependencies.

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

When a client exceeds the limit, they receive a `429 Too Many Requests` response with standard headers:

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
| `onLimitReached` | `(key) => void` | â€”       | Callback when a client exceeds the limit |

Expired entries are automatically cleaned up to prevent memory leaks in long-running servers.

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

# Probe any URL to check if it accepts AI agents via imrobot
npx imrobot test-agent https://example.com
npx imrobot test-agent example.com --json    # machine-readable output
```

`test-agent` looks for (in order of confidence):

1. `<origin>/.well-known/imrobot.json` — the strongest signal (protocol declared)
2. A `data-imrobot-challenge` attribute in the HTML (embedded challenge)
3. `<script>` tags referencing `imrobot`, or a `<meta name="imrobot">` tag

Exit codes: `0` = accepts agents (yes/likely), `1` = no signals found, `2` = network/usage error. Useful in CI scripts.

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

## Screenshot protection

The challenge text is **blurred by default** and only revealed when the user hovers over it. This defeats screenshot-based attacks (screen capture tools, CDP screenshots, PrintScreen) since the captured image shows only blurred content.

An additional JavaScript shield detects screenshot shortcuts (PrintScreen, Cmd+Shift+3/4/5, Ctrl+Shift+S) and window blur/visibility changes, applying an extra blur layer that overrides even the hover state.

Combined with the hidden nonce (not displayed visually) and TTL expiry, this makes screenshot+OCR workflows ineffective â€” even if the blur were bypassed, the nonce is missing from the visual output.

> **Note:** AI agents are unaffected â€” they read challenge data from the DOM, not from the screen.

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

AI agents read the challenge data directly from the DOM via the `data-imrobot-challenge` attribute â€” they never need to "see" the visual text, so blur has no effect on them.

1. **Read the challenge** from `data-imrobot-challenge` attribute (JSON)
2. **Execute the pipeline** â€” each operation is a deterministic transform
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

Every operation has 3â€“4 distinct phrasings that are randomly selected on each call, so the display text varies unpredictably. Agents must parse the JSON `pipeline` (unaffected), while regex scraping of the visual text becomes unreliable.

> **Tip:** The original programmatic functions `formatOperation` / `formatPipeline` remain unchanged â€” use them when you need a stable, deterministic format.

## Operations reference

### String operations

| Operation            | Description             | Example                  |
| -------------------- | ----------------------- | ------------------------ |
| `reverse()`          | Reverse the string      | `"abc"` â†’ `"cba"`        |
| `to_upper()`         | Convert to uppercase    | `"abc"` â†’ `"ABC"`        |
| `to_lower()`         | Convert to lowercase    | `"ABC"` â†’ `"abc"`        |
| `base64_encode()`    | Base64 encode           | `"hello"` â†’ `"aGVsbG8="` |
| `rot13()`            | ROT13 cipher            | `"hello"` â†’ `"uryyb"`    |
| `hex_encode()`       | Hex encode each char    | `"AB"` â†’ `"4142"`        |
| `sort_chars()`       | Sort characters         | `"dcba"` â†’ `"abcd"`      |
| `char_code_sum()`    | Sum of char codes       | `"AB"` â†’ `"131"`         |
| `substring(s, e)`    | Extract substring       | `"abcdef"` â†’ `"cde"`     |
| `repeat(n)`          | Repeat string n times   | `"ab"` â†’ `"ababab"`      |
| `replace(s, r)`      | Replace all occurrences | `"aab"` â†’ `"xxb"`        |
| `pad_start(len, ch)` | Pad start to length     | `"abc"` â†’ `"000abc"`     |
| `vowel_count()`      | Count vowels            | `"hello"` â†’ `"2"`        |
| `consonant_extract()`| Extract consonants only | `"hello"` â†’ `"hll"`      |
| `run_length_encode()` | Run-length encode      | `"aaabb"` â†’ `"3a2b"`     |
| `atbash()`           | Atbash cipher (aâ†”z)    | `"abc"` â†’ `"zyx"`        |

### Byte & cipher operations

| Operation            | Description                           | Example                         |
| -------------------- | ------------------------------------- | ------------------------------- |
| `caesar(shift)`      | Caesar cipher with configurable shift | `"abc"` + shift 1 â†’ `"bcd"`     |
| `xor_encode(key)`    | XOR each byte with key                | `"AB"` + key 1 â†’ `"@C"`         |
| `count_chars(char)`  | Count occurrences of a char           | `"aababc"` + char `"a"` â†’ `"3"` |
| `slice_alternate()`  | Keep every other character            | `"abcdef"` â†’ `"ace"`            |
| `fnv1a_hash()`       | FNV-1a hash of the string             | `"test"` â†’ `"bc2c0be9"`         |
| `length()`           | String length as string               | `"hello"` â†’ `"5"`               |
| `sha256_hash()`      | Cascaded FNV-1a hash (256-bit output) | deterministic 64-char hex       |
| `byte_xor(key[])`    | XOR each byte with key array          | byte-level encryption           |
| `hash_chain(rounds)` | Iterated FNV-1a hash                  | cascaded hashing                |
| `nibble_swap()`      | Swap high/low nibbles per byte        | `0xAB` â†’ `0xBA`                 |
| `bit_rotate(bits)`   | Rotate bits left within byte          | bitwise rotation                |

## Configuration

| Prop         | Type                              | Default        | Description                                                      |
| ------------ | --------------------------------- | -------------- | ---------------------------------------------------------------- |
| `difficulty` | `'easy' \| 'medium' \| 'hard'`    | `'medium'`     | Number and complexity of operations                              |
| `theme`      | `'light' \| 'dark'`               | `'light'`      | Color theme                                                      |
| `size`       | `'compact' \| 'standard'`         | `'standard'`   | Widget size â€” `compact` for smaller footprint (320px)            |
| `ttl`        | `number`                          | per-difficulty | Challenge time-to-live in ms (easy: 30s, medium: 20s, hard: 15s) |
| `onVerified` | `(token) => void`                 | â€”              | Callback on successful verification                              |
| `onError`    | `(error) => void`                 | â€”              | Callback on failed verification                                  |

### Difficulty levels

- **easy**: 2-3 simple operations (reverse, case, sort, length, slice_alternate, vowel_count, atbash)
- **medium**: 3-5 operations including encoding, extraction, caesar, char counting, consonant_extract, run_length_encode
- **hard**: 5-7 operations including XOR encoding, hashing, replacement, padding, cascaded FNV-1a (256-bit), byte XOR, hash chains, nibble swap, and bit rotate

## Server verification

For production deployments, use the server SDK (`imrobot/server`) instead of client-side-only verification. The server SDK uses HMAC-SHA256 to sign challenges, providing tamper-proof, stateless, replay-resistant verification with zero database overhead.

```ts
import { createVerifier } from 'imrobot/server'

const verifier = createVerifier({
  secret: process.env.IMROBOT_SECRET!, // HMAC secret (min 16 chars)
  difficulty: 'hard',
  ttl: 10_000, // optional: override default TTL
})

// Generate â†’ send to client â†’ client solves â†’ verify answer
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

### ChallengeAnalytics

`ChallengeAnalytics` (exported from `imrobot/server`) is a lightweight, in-memory metrics tracker for monitoring challenge activity â€” generation rates, verification rates, solve-time percentiles, and failure-reason distributions. Zero external dependencies, memory-bounded (sliding window of configurable size).

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

// Periodic rotation â€” reset all counters
analytics.reset()
```

`getStats()` returns an `AnalyticsSnapshot` with:
- **`summary`** â€” aggregate totals: `totalGenerated`, `totalVerified`, `totalFailed`, `totalExpired`, `totalSuspicious`, `verificationRate`, `avgSolveTimeMs`, `uptimeMs`
- **`byDifficulty`** â€” per-difficulty `DifficultyStats` with min/max/p95 solve times and per-reason failure counts
- **`collectedAt`** â€” Unix timestamp of the snapshot

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

The adaptive difficulty engine auto-adjusts challenge difficulty per agent based on behavioral patterns â€” inspired by Arkose Labs (FunCaptcha) progressive difficulty and reCAPTCHA v3 risk scoring.

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

> **Note:** Direct OpenAI/Stability AI API integration is planned. For now, use the `custom` or `static` provider.

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
