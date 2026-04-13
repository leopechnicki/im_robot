import { ImRobotElement, register } from 'imrobot/web-component'
import { solveChallenge, type Challenge, type ImRobotToken } from 'imrobot/core'

// ── Register web component ──────────────────────────────────────────
register()

// ── Theme toggle ────────────────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle')!
// Default dark — cyberpunk aesthetic. Light theme is opt-in via toggle.
const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches
let dark = !prefersLight

function applyTheme() {
  if (dark) {
    document.documentElement.removeAttribute('data-theme')  // dark is default in CSS
  } else {
    document.documentElement.setAttribute('data-theme', 'light')
  }
  themeBtn.textContent = dark ? '☀️' : '🌙'
  // Update widget theme
  const widget = document.querySelector('imrobot-widget')
  if (widget) widget.setAttribute('theme', dark ? 'dark' : 'light')
}
applyTheme()
themeBtn.addEventListener('click', () => { dark = !dark; applyTheme() })

// ── Mount widget ────────────────────────────────────────────────────
const mount = document.getElementById('widget-mount')!
const tokenDisplay = document.getElementById('token-display')!

function mountWidget(difficulty: string) {
  mount.innerHTML = ''
  tokenDisplay.style.display = 'none'
  tokenDisplay.textContent = ''

  const widget = document.createElement('imrobot-widget') as ImRobotElement
  widget.setAttribute('difficulty', difficulty)
  widget.setAttribute('theme', dark ? 'dark' : 'light')
  mount.appendChild(widget)

  widget.addEventListener('imrobot-verified', ((e: CustomEvent<ImRobotToken>) => {
    tokenDisplay.style.display = 'block'
    tokenDisplay.textContent = JSON.stringify(e.detail, null, 2)
  }) as EventListener)
}

mountWidget('medium')

// ── Difficulty selector ─────────────────────────────────────────────
document.querySelectorAll('[data-diff]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-diff]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    mountWidget((btn as HTMLElement).dataset.diff!)
  })
})

// ── Auto-solve button ───────────────────────────────────────────────
document.getElementById('auto-solve')!.addEventListener('click', () => {
  const widget = document.querySelector('imrobot-widget') as ImRobotElement | null
  if (!widget) return

  const challenge = widget.getChallenge()
  const answer = solveChallenge(challenge)

  // Show typing animation in the shadow DOM input, then submit immediately
  // Must submit quickly — short TTLs mean the challenge can expire during long animations
  const input = widget.shadowRoot?.querySelector('.imrobot-input') as HTMLInputElement | null

  if (input) {
    const charsPerFrame = Math.max(1, Math.ceil(answer.length / 15))
    let i = 0
    input.value = ''
    const typeInterval = setInterval(() => {
      if (i < answer.length) {
        const end = Math.min(i + charsPerFrame, answer.length)
        input.value = answer.substring(0, end)
        i = end
      } else {
        clearInterval(typeInterval)
        // Submit immediately — challenge may expire soon
        widget.submitAnswer(answer)
      }
    }, 20)
  } else {
    // No input visible (already verified?), submit directly
    widget.submitAnswer(answer)
  }
})

// ── Code tabs ───────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    document.querySelectorAll('.code-panel').forEach(p => p.classList.remove('active'))
    tab.classList.add('active')
    const panel = document.getElementById(`panel-${(tab as HTMLElement).dataset.tab}`)
    panel?.classList.add('active')
  })
})

// ── Copy install command ────────────────────────────────────────────
document.getElementById('install-bar')!.addEventListener('click', () => {
  navigator.clipboard.writeText('npm install imrobot')
  const bar = document.getElementById('install-bar')!
  const icon = bar.querySelector('.copy-icon')!
  icon.textContent = '✅'
  setTimeout(() => { icon.textContent = '📋' }, 1500)
})

// ── Agent prompt ───────────────────────────────────────────────────
const AGENT_PROMPT = `# Integrate imrobot — Reverse-CAPTCHA for AI Agents

## Goal
Add \`imrobot\` to this project. imrobot is a reverse-CAPTCHA that verifies visitors are AI agents/bots, not humans. It generates deterministic challenge pipelines that only programmatic agents can solve.

## Step 1 — Install

\`\`\`bash
npm install imrobot
\`\`\`

## Step 2 — Choose your integration

### Option A: React
\`\`\`tsx
import { ImRobot } from 'imrobot/react'

function App() {
  return (
    <ImRobot
      difficulty="medium"   // "easy" | "medium" | "hard"
      theme="light"         // "light" | "dark"
      onVerified={(token) => {
        // token: { challengeId, answer, timestamp, elapsed, suspicious, signature }
        console.log('Robot verified!', token)
      }}
    />
  )
}
\`\`\`

### Option B: Vue
\`\`\`vue
<script setup>
import { ImRobot } from 'imrobot/vue'
function handleVerified(token) {
  console.log('Robot verified!', token)
}
</script>
<template>
  <ImRobot difficulty="medium" theme="light" @verified="handleVerified" />
</template>
\`\`\`

### Option C: Svelte
\`\`\`svelte
<script>
  import ImRobot from 'imrobot/svelte'
</script>
<ImRobot difficulty="medium" theme="light" onVerified={(token) => console.log(token)} />
\`\`\`

### Option D: Web Component (any framework or vanilla)
\`\`\`html
<script type="module">
  import { register } from 'imrobot/web-component'
  register()
</script>
<imrobot-widget difficulty="medium" theme="light"></imrobot-widget>
<script>
  document.querySelector('imrobot-widget')
    .addEventListener('imrobot-verified', (e) => console.log(e.detail))
</script>
\`\`\`

### Option E: Headless / Core API (no UI)
\`\`\`ts
import { generateChallenge, solveChallenge, verifyAnswer } from 'imrobot/core'

const challenge = generateChallenge({ difficulty: 'medium' })
const answer = solveChallenge(challenge)
const isValid = verifyAnswer(challenge, answer) // true
\`\`\`

### Option F: Invisible verification (zero-UI, fully automatic)
\`\`\`ts
import { invisibleVerify } from 'imrobot/core'

const result = await invisibleVerify({
  challengeUrl: '/api/imrobot/challenge',
  verifyUrl: '/api/imrobot/verify',
  agentId: 'my-agent-v1',
  maxRetries: 3,
})
if (result.success) {
  // Use proof token: result.proofToken
}
\`\`\`

## Step 3 — Server-side verification (optional but recommended)

\`\`\`ts
import { createVerifier } from 'imrobot/server'

const verifier = createVerifier({
  secret: process.env.IMROBOT_SECRET!,  // HMAC secret, min 16 chars
  difficulty: 'medium',
})

// GET /api/challenge — generate a signed challenge
app.get('/api/challenge', async (req, res) => {
  const challenge = await verifier.generate()
  res.json(challenge)
})

// POST /api/verify — verify the agent's answer
app.post('/api/verify', async (req, res) => {
  const { challenge, answer } = req.body
  const result = await verifier.verify(challenge, answer)
  // { valid: true, elapsed: 42, suspicious: false }
  res.json(result)
})
\`\`\`

## Step 4 — Protect routes with middleware (optional)

\`\`\`ts
import { requireAgent, createAgentRouter } from 'imrobot/server'

// Mount challenge/verify endpoints
const router = createAgentRouter({ secret: process.env.IMROBOT_SECRET! })
app.get('/imrobot/challenge', router.challenge)
app.post('/imrobot/verify', router.verify)

// Protect agent-only routes
app.use('/api/agent-only', requireAgent({
  secret: process.env.IMROBOT_SECRET!,
  rateLimit: { windowMs: 60000, maxRequests: 100 },
}))
\`\`\`

## Key facts
- Package: \`imrobot\` on npm (v0.5.0)
- Zero runtime dependencies, ~14 KB core
- Exports: \`imrobot/core\`, \`imrobot/react\`, \`imrobot/vue\`, \`imrobot/svelte\`, \`imrobot/web-component\`, \`imrobot/server\`
- Challenge data lives in \`data-imrobot-challenge\` DOM attribute as JSON
- 23 operation types: reverse, base64, rot13, caesar, xor, sha256, fnv1a, bit_rotate, etc.
- TypeScript-first with full type exports
- CLI available: \`npx imrobot challenge\`, \`npx imrobot solve\`, \`npx imrobot benchmark\`
- Docs: https://imrobot.vercel.app/docs.html
- GitHub: https://github.com/leopechnicki/im_robot
`

// Populate prompt preview
const promptContent = document.getElementById('prompt-content')
if (promptContent) {
  promptContent.textContent = AGENT_PROMPT
}

// Toggle prompt preview
const promptToggle = document.getElementById('prompt-toggle')
if (promptToggle && promptContent) {
  promptToggle.addEventListener('click', () => {
    promptToggle.classList.toggle('open')
    promptContent.classList.toggle('open')
    // Toggle border-top on content area
    const bar = document.getElementById('agent-prompt-bar')
    bar?.classList.toggle('expanded')
  })
}

// Copy prompt button
const copyPromptBtn = document.getElementById('copy-prompt-btn')
if (copyPromptBtn) {
  copyPromptBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(AGENT_PROMPT)
    copyPromptBtn.textContent = 'Copied!'
    copyPromptBtn.classList.add('copied')
    setTimeout(() => {
      copyPromptBtn.textContent = 'Copy prompt'
      copyPromptBtn.classList.remove('copied')
    }, 2000)
  })
}
