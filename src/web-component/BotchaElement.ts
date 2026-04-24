import type { Challenge, ImRobotToken, Difficulty } from '../core/types'
import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { formatPipeline } from '../core/operations'
import { getStyles, ROBOT_SVG, type WidgetSize } from '../styles'
import { setupScreenshotShield } from '../screenshot-shield'

/**
 * Custom element implementing the imrobot widget.
 *
 * Internally uses a "render-once + diff" strategy: the skeleton is painted
 * exactly once on connect, listeners are attached once, and state changes
 * mutate cached nodes in place. This preserves input focus, lets the input's
 * value follow the user's typing (no caret-jumping), and avoids the listener
 * churn of an `innerHTML = ...` approach.
 */
export class ImRobotElement extends HTMLElement {
  static get observedAttributes() {
    return ['difficulty', 'theme', 'ttl', 'size']
  }

  private shadow: ShadowRoot
  private challenge!: Challenge
  private answer = ''
  private status: 'idle' | 'verified' | 'failed' = 'idle'
  private startTime = Date.now()
  private countdownTimer: ReturnType<typeof setInterval> | null = null
  private remainingSeconds = 0
  private cleanupShield: (() => void) | null = null
  private shielded = false

  /** Cached references to the dynamic nodes painted by `paintSkeleton()`. */
  private nodes: {
    style: HTMLStyleElement
    container: HTMLDivElement
    challengeArea: HTMLDivElement
    challengeText: Text
    timerBlock: HTMLDivElement
    timerFill: HTMLDivElement
    timerText: HTMLSpanElement
    inputRow: HTMLDivElement
    input: HTMLInputElement
    submitBtn: HTMLButtonElement
    statusVerified: HTMLSpanElement
    statusFailed: HTMLSpanElement
    retryBtn: HTMLButtonElement
  } | null = null

  constructor() {
    super()
    this.shadow = this.attachShadow({ mode: 'open' })
  }

  get difficulty(): Difficulty {
    return (this.getAttribute('difficulty') as Difficulty) || 'medium'
  }

  get theme(): 'light' | 'dark' {
    return (this.getAttribute('theme') as 'light' | 'dark') || 'light'
  }

  get ttl(): number {
    return Number(this.getAttribute('ttl')) || 0 // 0 = use default per-difficulty
  }

  get size(): WidgetSize {
    const v = this.getAttribute('size') as WidgetSize | null
    return v === 'compact' ? 'compact' : 'standard'
  }

  connectedCallback() {
    this.challenge = generateChallenge({
      difficulty: this.difficulty,
      ...(this.ttl > 0 ? { ttl: this.ttl } : {}),
    })
    this.startTime = Date.now()
    this.paintSkeleton()
    this.startCountdown()
    this.updateUI()

    this.cleanupShield = setupScreenshotShield((shielded) => {
      this.shielded = shielded
      this.nodes?.challengeArea.classList.toggle('imrobot-challenge--shielded', shielded)
    })
  }

  disconnectedCallback() {
    this.stopCountdown()
    if (this.cleanupShield) {
      this.cleanupShield()
      this.cleanupShield = null
    }
    this.nodes = null
  }

  attributeChangedCallback(name: string) {
    if (!this.isConnected || !this.nodes) return
    if (name === 'theme' || name === 'size') {
      this.nodes.style.textContent = getStyles(this.theme, this.size)
      return
    }
    if (name === 'difficulty' || name === 'ttl') {
      // A new difficulty/TTL means a fresh challenge; reset state.
      this.handleRetry()
    }
  }

  private startCountdown() {
    this.stopCountdown()
    this.remainingSeconds = Math.ceil(this.challenge.ttl / 1000)
    this.countdownTimer = setInterval(() => {
      const elapsed = Date.now() - this.challenge.timestamp
      this.remainingSeconds = Math.max(0, Math.ceil((this.challenge.ttl - elapsed) / 1000))
      if (this.remainingSeconds <= 0) {
        this.handleExpired()
      } else {
        this.updateTimerDisplay()
      }
    }, 1000)
  }

  private stopCountdown() {
    if (this.countdownTimer !== null) {
      clearInterval(this.countdownTimer)
      this.countdownTimer = null
    }
  }

  private handleExpired() {
    this.stopCountdown()
    this.challenge = generateChallenge({
      difficulty: this.difficulty,
      ...(this.ttl > 0 ? { ttl: this.ttl } : {}),
    })
    this.answer = ''
    this.status = 'idle'
    this.startTime = Date.now()
    this.startCountdown()
    this.updateUI()
  }

  private updateTimerDisplay() {
    if (!this.nodes) return
    const totalSec = this.challenge.ttl / 1000
    const pct = (this.remainingSeconds / totalSec) * 100
    this.nodes.timerFill.style.width = `${pct}%`
    this.nodes.timerText.textContent = `${this.remainingSeconds}s`
    this.nodes.timerFill.classList.toggle('imrobot-timer-fill--warn', pct <= 25)
  }

  private handleVerify() {
    const trimmed = this.answer.trim()
    if (!trimmed) return

    if (verifyAnswer(this.challenge, trimmed)) {
      this.status = 'verified'
      this.stopCountdown()
      const token = createToken(this.challenge, trimmed, this.startTime)
      this.dispatchEvent(
        new CustomEvent<ImRobotToken>('imrobot-verified', {
          bubbles: true,
          composed: true,
          detail: token,
        }),
      )
    } else {
      this.status = 'failed'
      this.dispatchEvent(
        new CustomEvent('imrobot-error', {
          bubbles: true,
          composed: true,
          detail: { message: 'Verification failed' },
        }),
      )
    }
    this.updateUI()
  }

  /**
   * Public API: programmatically submit an answer.
   * AI agents and the auto-solve demo use this method.
   */
  public submitAnswer(answer: string) {
    this.answer = answer
    if (this.nodes) this.nodes.input.value = answer
    this.handleVerify()
  }

  /** Expose the current challenge for programmatic access */
  public getChallenge(): Challenge {
    return this.challenge
  }

  private handleRetry() {
    this.challenge = generateChallenge({
      difficulty: this.difficulty,
      ...(this.ttl > 0 ? { ttl: this.ttl } : {}),
    })
    this.answer = ''
    this.status = 'idle'
    this.startTime = Date.now()
    if (this.nodes) this.nodes.input.value = ''
    this.startCountdown()
    this.updateUI()
  }

  /**
   * Paint the static DOM scaffold once and cache references to the dynamic
   * nodes. Subsequent state changes update those nodes in place via
   * `updateUI()` and `updateTimerDisplay()`.
   */
  private paintSkeleton() {
    this.shadow.innerHTML = ''

    const style = document.createElement('style')
    style.textContent = getStyles(this.theme, this.size)
    this.shadow.appendChild(style)

    const container = document.createElement('div')
    container.className = 'imrobot'
    container.setAttribute('role', 'region')
    container.setAttribute('aria-label', 'ImRobot verification challenge')

    // Header
    const header = document.createElement('div')
    header.className = 'imrobot-header'
    const icon = document.createElement('span')
    icon.className = 'imrobot-icon'
    icon.innerHTML = ROBOT_SVG
    const title = document.createElement('span')
    title.textContent = "Prove you're a robot"
    header.append(icon, title)

    // Timer
    const timerBlock = document.createElement('div')
    timerBlock.className = 'imrobot-timer'
    const timerLabel = document.createElement('span')
    timerLabel.className = 'imrobot-timer-label'
    timerLabel.textContent = 'Time'
    const timerBar = document.createElement('div')
    timerBar.className = 'imrobot-timer-bar'
    const timerFill = document.createElement('div')
    timerFill.className = 'imrobot-timer-fill'
    timerBar.appendChild(timerFill)
    const timerText = document.createElement('span')
    timerText.className = 'imrobot-timer-text'
    timerBlock.append(timerLabel, timerBar, timerText)

    // Challenge area (text node mutated in place)
    const challengeArea = document.createElement('div')
    challengeArea.className = 'imrobot-challenge'
    challengeArea.setAttribute('aria-label', 'Challenge pipeline')
    const shieldNotice = document.createElement('span')
    shieldNotice.className = 'imrobot-shield-notice'
    shieldNotice.textContent = 'Screenshot protected'
    const challengeText = document.createTextNode('')
    challengeArea.append(shieldNotice, challengeText)

    // Anti-copy listeners (attach once, never removed)
    challengeArea.addEventListener('contextmenu', (e) => e.preventDefault())
    challengeArea.addEventListener('copy', (e) => e.preventDefault())
    challengeArea.addEventListener('dragstart', (e) => e.preventDefault())

    // Input row
    const inputRow = document.createElement('div')
    inputRow.className = 'imrobot-row'
    const input = document.createElement('input')
    input.className = 'imrobot-input'
    input.type = 'text'
    input.placeholder = 'Enter pipeline result...'
    input.setAttribute('aria-label', 'Challenge answer')
    input.autocomplete = 'off'
    input.addEventListener('input', (e) => {
      this.answer = (e.target as HTMLInputElement).value
      this.nodes?.submitBtn.toggleAttribute('disabled', !this.answer.trim())
    })
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.handleVerify()
    })
    const submitBtn = document.createElement('button')
    submitBtn.className = 'imrobot-btn'
    submitBtn.type = 'button'
    submitBtn.textContent = 'Verify'
    submitBtn.disabled = true
    submitBtn.addEventListener('click', () => this.handleVerify())
    inputRow.append(input, submitBtn)

    // Footer + status
    const footer = document.createElement('div')
    footer.className = 'imrobot-footer'
    const statusWrap = document.createElement('div')
    const statusVerified = document.createElement('span')
    statusVerified.className = 'imrobot-status imrobot-status--verified'
    statusVerified.innerHTML = '&#10003; Verified: You are a robot'
    statusVerified.hidden = true
    const statusFailed = document.createElement('span')
    statusFailed.className = 'imrobot-status imrobot-status--failed'
    statusFailed.hidden = true
    const failedLabel = document.createTextNode('✗ Failed — ')
    const retryBtn = document.createElement('button')
    retryBtn.type = 'button'
    retryBtn.textContent = 'try again'
    retryBtn.style.cssText =
      'background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;padding:0;font:inherit;'
    retryBtn.addEventListener('click', () => this.handleRetry())
    statusFailed.append(failedLabel, retryBtn)
    statusWrap.append(statusVerified, statusFailed)

    const brand = document.createElement('span')
    brand.className = 'imrobot-brand'
    brand.textContent = 'imrobot'
    footer.append(statusWrap, brand)

    container.append(header, timerBlock, challengeArea, inputRow, footer)
    this.shadow.appendChild(container)

    this.nodes = {
      style,
      container,
      challengeArea,
      challengeText,
      timerBlock,
      timerFill,
      timerText,
      inputRow,
      input,
      submitBtn,
      statusVerified,
      statusFailed,
      retryBtn,
    }
  }

  /**
   * Push the current `this.challenge` / `this.status` / `this.answer` state
   * into the cached DOM nodes without re-creating them. Preserves input focus.
   */
  private updateUI() {
    if (!this.nodes) return
    const n = this.nodes

    // Update challenge text + JSON data attribute
    n.challengeText.data = formatPipeline(this.challenge.visibleSeed, this.challenge.pipeline)
    n.container.setAttribute('data-imrobot-challenge', JSON.stringify(this.challenge))
    n.challengeArea.classList.toggle('imrobot-challenge--shielded', this.shielded)

    // Show/hide timer and input row based on verification state
    const isVerified = this.status === 'verified'
    n.timerBlock.hidden = isVerified
    n.inputRow.hidden = isVerified

    // Status messages
    n.statusVerified.hidden = this.status !== 'verified'
    n.statusFailed.hidden = this.status !== 'failed'

    // Sync input value only when state diverges (don't disrupt typing focus)
    if (n.input.value !== this.answer) n.input.value = this.answer
    n.submitBtn.disabled = !this.answer.trim()

    // Refresh timer display in case challenge was rotated
    this.updateTimerDisplay()
  }
}

export function register(tagName = 'imrobot-widget') {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, ImRobotElement)
  }
}
