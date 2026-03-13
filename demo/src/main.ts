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
