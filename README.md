# imrobot

**I'm a robot.** Reverse-CAPTCHA that verifies AI agents and robots, not humans.

Traditional CAPTCHAs block bots. **imrobot** does the opposite — it presents challenges that only programmatic agents can solve, keeping humans out.

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

## Usage

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

## How agents interact with it

AI agents browsing a page with imrobot can:

1. **Read the challenge** from `data-imrobot-challenge` attribute (JSON)
2. **Execute the pipeline** — each operation is a simple string transform
3. **Submit the answer** via the input field or programmatically

```js
// Agent reads challenge from DOM
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

## License

MIT
