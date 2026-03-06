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

imrobot generates a pipeline of deterministic string operations (reverse, base64, rot13, hex encode, etc.) applied to a random seed. AI agents parse the structured challenge data, execute the pipeline, and submit the result. Humans would need to manually compute multi-step string transformations — practically impossible without tools.<div align="center">

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

imrobot generates a pipeline of deterministic string operations (reverse, base64, rot13, hex encode, etc.) applied to a random seed. AI agents parse the structured challenge data, execute the pipeline, and submit the result. Humans would need to manually compute multi-step string transformations — practically impossible without tools.

```
seed: "a7f3b2c1d4e5f609"
  1. reverse()
  2. to_upper()
  3. base64_encode()
  4. substring(0, 12)
  5. rot13()
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
2. **Execute the pipeline** — each operation is a simple string transform
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

## Operations reference

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

## Configuration

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `difficulty` | `'easy' \| 'medium' \| 'hard'` | `'medium'` | Number and complexity of operations |
| `theme` | `'light' \| 'dark'` | `'light'` | Color theme |
| `ttl` | `number` | `300000` | Challenge time-to-live in ms |
| `onVerified` | `(token) => void` | — | Callback on successful verification |
| `onError` | `(error) => void` | — | Callback on failed verification |

### Difficulty levels

- **easy**: 2-3 simple operations (reverse, case, sort)
- **medium**: 3-5 operations including encoding and extraction
- **hard**: 5-7 operations including replacement and padding

## Token

On successful verification, `onVerified` receives an `ImRobotToken`:

```ts
interface ImRobotToken {
  challengeId: string  // Unique challenge identifier
  answer: string       // The correct answer
  timestamp: number    // Verification timestamp
  elapsed: number      // Time taken to solve (ms)
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
