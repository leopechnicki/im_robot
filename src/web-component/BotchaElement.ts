import type { Challenge, ImRobotToken, Difficulty } from '../core/types'
import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { formatPipeline } from '../core/operations'
import { getStyles, ROBOT_SVG } from '../styles'

export class ImRobotElement extends HTMLElement {
  static get observedAttributes() {
    return ['difficulty', 'theme', 'ttl']
  }

  private shadow: ShadowRoot
  private challenge!: Challenge
  private answer = ''
  private status: 'idle' | 'verified' | 'failed' = 'idle'
  private startTime = Date.now()

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
    return Number(this.getAttribute('ttl')) || 300_000
  }

  connectedCallback() {
    this.challenge = generateChallenge({
      difficulty: this.difficulty,
      ttl: this.ttl,
    })
    this.startTime = Date.now()
    this.render()
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render()
  }

  private handleVerify() {
    const trimmed = this.answer.trim()
    if (!trimmed) return

    if (verifyAnswer(this.challenge, trimmed)) {
      this.status = 'verified'
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
    this.render()
  }

  /**
   * Public API: programmatically submit an answer.
   * AI agents and the auto-solve demo use this method.
   */
  public submitAnswer(answer: string) {
    this.answer = answer
    this.handleVerify()
  }

  /** Expose the current challenge for programmatic access */
  public getChallenge(): Challenge {
    return this.challenge
  }

  private handleRetry() {
    this.challenge = generateChallenge({
      difficulty: this.difficulty,
      ttl: this.ttl,
    })
    this.answer = ''
    this.status = 'idle'
    this.startTime = Date.now()
    this.render()
  }

  private render() {
    const display = formatPipeline(this.challenge.seed, this.challenge.pipeline)
    const challengeJson = JSON.stringify(this.challenge)

    this.shadow.innerHTML = `
      <style>${getStyles(this.theme)}</style>
      <div class="imrobot"
           data-imrobot-challenge='${challengeJson.replace(/'/g, '&#39;')}'
           role="region"
           aria-label="ImRobot verification challenge">
        <div class="imrobot-header">
          <span class="imrobot-icon">${ROBOT_SVG}</span>
          <span>Prove you're a robot</span>
        </div>
        <div class="imrobot-challenge" aria-label="Challenge pipeline">${this.escapeHtml(display)}</div>
        ${
          this.status !== 'verified'
            ? `<div class="imrobot-row">
                <input class="imrobot-input"
                       type="text"
                       value="${this.escapeHtml(this.answer)}"
                       placeholder="Enter pipeline result..."
                       aria-label="Challenge answer"
                       autocomplete="off" />
                <button class="imrobot-btn" ${!this.answer.trim() ? 'disabled' : ''}>Verify</button>
               </div>`
            : ''
        }
        <div class="imrobot-footer">
          <div>
            ${
              this.status === 'verified'
                ? '<span class="imrobot-status imrobot-status--verified">&#10003; Verified: You are a robot</span>'
                : ''
            }
            ${
              this.status === 'failed'
                ? '<span class="imrobot-status imrobot-status--failed">&#10007; Failed &mdash; <button class="retry-btn" style="background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;padding:0;font:inherit;">try again</button></span>'
                : ''
            }
          </div>
          <span class="imrobot-brand">imrobot</span>
        </div>
      </div>
    `

    // Bind events
    const input = this.shadow.querySelector('.imrobot-input') as HTMLInputElement
    if (input) {
      input.addEventListener('input', (e) => {
        this.answer = (e.target as HTMLInputElement).value
      })
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') this.handleVerify()
      })
    }

    const btn = this.shadow.querySelector('.imrobot-btn')
    if (btn) {
      btn.addEventListener('click', () => this.handleVerify())
    }

    const retryBtn = this.shadow.querySelector('.retry-btn')
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.handleRetry())
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
}

export function register(tagName = 'imrobot-widget') {
  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    customElements.define(tagName, ImRobotElement)
  }
}
