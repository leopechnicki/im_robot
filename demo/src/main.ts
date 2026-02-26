import { ImRobotElement, register } from 'imrobot/web-component'
import { solveChallenge, type Challenge, type ImRobotToken } from 'imrobot/core'

// ── Register web component ──────────────────────────────────────────
register()

// ── Theme toggle ────────────────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle')!
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
let dark = prefersDark

function applyTheme() {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
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

  // Animate typing into the shadow DOM input, then use the public API to verify
  const input = widget.shadowRoot?.querySelector('.imrobot-input') as HTMLInputElement | null

  if (input) {
    let i = 0
    input.value = ''
    const typeInterval = setInterval(() => {
      if (i < answer.length) {
        input.value += answer[i]
        i++
      } else {
        clearInterval(typeInterval)
        // Use the public API to submit — avoids shadow DOM event issues
        setTimeout(() => widget.submitAnswer(answer), 150)
      }
    }, 25)
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
