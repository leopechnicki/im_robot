<div align="center">

# 🤖 imrobot

**Reverse-CAPTCHA for AI agents — verify bots, not humans.**

[![npm version](https://img.shields.io/npm/v/imrobot.svg?style=flat-square&color=3b82f6)](https://www.npmjs.com/package/imrobot)
[![npm downloads](https://img.shields.io/npm/dw/imrobot.svg?style=flat-square&color=10b981)](https://www.npmjs.com/package/imrobot)
[![license](https://img.shields.io/npm/l/imrobot.svg?style=flat-square&color=6366f1)](https://github.com/leopechnicki/im_robot/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-100%25-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/leopechnicki/im_robot)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-22c55e?style=flat-square)](https://www.npmjs.com/package/imrobot)

[Live Demo](https://imrobot.vercel.app) · [npm](https://www.npmjs.com/package/imrobot) · [Dev.to Article](https://dev.to/leo_pechnicki/why-i-built-a-captcha-that-only-bots-can-solve-30np)

</div>

---

## Why?

Traditional CAPTCHAs prove you're human. But what about the opposite?

As AI agents become first-class web citizens — browsing, booking, purchasing, automating — some systems need to verify their visitors are **legitimate AI agents**, not humans trying to bypass agent-only access. Think agent-facing APIs, AI-only platforms, or multi-agent authentication.

**imrobot** flips the CAPTCHA model: it generates deterministic challenge pipelines that are trivial for any LLM or programmatic agent to solve (< 1 second), but impractical for humans to work through manually.

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
  document.querySelector('imrobot-widget')
    .addEventListener('imrobot-verified', (e) => {
      console.log('Robot verified!', e.detail)
    })
</script>
```

### Core API (headless)

```ts
import {
  generateChallenge,
  solveChallenge,
  verifyAnswer,
} from 'imrobot/core'

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
  // or:     { valid: false, reason: 'wrong_answer' | 'expired' | 'invalid_hmac' | 'tampered' }
  res.json(result)
})
```

The server verifier checks in order: HMAC signature validity (challenge and pipeline not tampered), expiration (challenge not expired), and answer correctness (pipeline re-executed). A different secret on a different server will reject the challenge — preventing cross-site replay attacks.

### Middleware & Proof-of-Agent tokens

Protect your API endpoints with framework-agnostic middleware. Verified agents receive a JWT-like Proof-of-Agent token (HMAC-SHA256 signed) that they pass via `X-Agent-Proof` header on subsequent requests.

```ts
import { requireAgent, createAgentRouter } from 'imrobot/server'

// Mount challenge/verify endpoints
const router = createAgentRouter({ secret: process.env.IMROBOT_SECRET! })
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

| Operation | Description | Example |
|-----------|-------------|---------|
| `reverse()` | Reverse the string | `"abc"` → `"cba"` |
| `to_upper()` | Convert to uppercase | `"abc"` → `"ABC"` |
| `to_lower()` | Convert to lowercase | `"ABC"` → `"abc"` |
| `base64_encode()` | Base64 encode | `"hello"` → `"aGVsbG8="` |
| `rot13()` | ROT13 cipher | `"hello"` → `"uryyb"` |
| `hex_encode()` | Hex encode each char | `"AB"` → `"4142"` |
| `sort_chars()` | Sort characters | `"dcba"` → `"abcd"` |
| `char_code_sum()` | Sum of char codes | `"AB"` → `"131"` |
| `substring(s, e)` | Extract substring | `"abcdef"` → `"cde"` |
| `repeat(n)` | Repeat string n times | `"ab"` → `"ababab"` |
| `replace(s, r)` | Replace all occurrences | `"aab"` → `"xxb"` |
| `pad_start(len, ch)` | Pad start to length | `"abc"` → `"000abc"` |

### Byte & cipher operations

| Operation | Description | Example |
|-----------|-------------|---------|
| `caesar(shift)` | Caesar cipher with configurable shift | `"abc"` + shift 1 → `"bcd"` |
| `xor_encode(key)` | XOR each byte with key | `"AB"` + key 1 → `"@C"` |
| `count_chars(char)` | Count occurrences of a char | `"aababc"` + char `"a"` → `"3"` |
| `slice_alternate()` | Keep every other character | `"abcdef"` → `"ace"` |
| `fnv1a_hash()` | FNV-1a hash of the string | `"test"` → `"bc2c0be9"` |
| `length()` | String length as string | `"hello"` → `"5"` |
| `sha256_hash()` | SHA-256 hash (sync FNV-based) | deterministic hex output |
| `byte_xor(key[])` | XOR each byte with key array | byte-level encryption |
| `hash_chain(rounds)` | Iterated FNV-1a hash | cascaded hashing |
| `nibble_swap()` | Swap high/low nibbles per byte | `0xAB` → `0xBA` |
| `bit_rotate(bits)` | Rotate bits left within byte | bitwise rotation |

## Configuration

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `difficulty` | `'easy' \| 'medium' \| 'hard'` | `'medium'` | Number and complexity of operations |
| `theme` | `'light' \| 'dark'` | `'light'` | Color theme |
| `ttl` | `number` | per-difficulty | Challenge time-to-live in ms (easy: 30s, medium: 20s, hard: 15s) |
| `onVerified` | `(token) => void` | — | Callback on successful verification |
| `onError` | `(error) => void` | — | Callback on failed verification |

### Difficulty levels

- **easy**: 2-3 simple operations (reverse, case, sort, length, slice_alternate)
- **medium**: 3-5 operations including encoding, extraction, caesar, and char counting
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

### VerifyResult

The `verify()` method returns a `VerifyResult`:

```ts
interface VerifyResult {
  valid: boolean
  reason?: 'expired' | 'invalid_hmac' | 'wrong_answer' | 'tampered'
  elapsed?: number    // ms since challenge was created
  suspicious?: boolean // true if response was unusually slow
}
```

## Token

On successful verification, `onVerified` receives an `ImRobotToken`:

```ts
interface ImRobotToken {
  challengeId: string  // Unique challenge identifier
  answer: string       // The correct answer
  timestamp: number    // Verification timestamp
  elapsed: number      // Time taken to solve (ms)
  suspicious: boolean  // true if elapsed > 5s (possible human relay)
  signature: string    // Verification signature
}
```

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
