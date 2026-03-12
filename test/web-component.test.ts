import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { ImRobotElement, register } from '../src/web-component/BotchaElement'
import { solveChallenge } from '../src/core/solver'
import type { Challenge } from '../src/core/types'

describe('Web Component ImRobotElement', () => {
  beforeAll(() => {
    register('imrobot-test-widget')
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  function createElement(attrs: Record<string, string> = {}): ImRobotElement {
    const el = document.createElement('imrobot-test-widget') as ImRobotElement
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value)
    }
    document.body.appendChild(el)
    return el
  }

  it('registers as a custom element', () => {
    expect(customElements.get('imrobot-test-widget')).toBe(ImRobotElement)
  })

  it('renders shadow DOM with challenge', () => {
    const el = createElement()
    const shadow = el.shadowRoot!
    expect(shadow).toBeTruthy()
    const region = shadow.querySelector('[role="region"]')
    expect(region).toBeTruthy()
  })

  it('embeds challenge JSON in data attribute', () => {
    const el = createElement()
    const shadow = el.shadowRoot!
    const challengeEl = shadow.querySelector('[data-imrobot-challenge]')
    expect(challengeEl).toBeTruthy()
    const challenge = JSON.parse(challengeEl!.getAttribute('data-imrobot-challenge')!)
    expect(challenge.version).toBe(1)
    expect(challenge.pipeline).toBeDefined()
  })

  it('displays header text', () => {
    const el = createElement()
    expect(el.shadowRoot!.textContent).toContain("Prove you're a robot")
  })

  it('renders input and verify button', () => {
    const el = createElement()
    const shadow = el.shadowRoot!
    expect(shadow.querySelector('.imrobot-input')).toBeTruthy()
    expect(shadow.querySelector('.imrobot-btn')).toBeTruthy()
  })

  it('getChallenge() returns the current challenge', () => {
    const el = createElement()
    const challenge = el.getChallenge()
    expect(challenge.version).toBe(1)
    expect(challenge.seed).toBeDefined()
    expect(challenge.pipeline).toBeDefined()
  })

  it('submitAnswer() with correct answer dispatches verified event', () => {
    const el = createElement()
    const handler = vi.fn()
    el.addEventListener('imrobot-verified', handler)

    const challenge = el.getChallenge()
    const answer = solveChallenge(challenge)
    el.submitAnswer(answer)

    expect(handler).toHaveBeenCalled()
    const event = handler.mock.calls[0][0] as CustomEvent
    expect(event.detail.challengeId).toBe(challenge.id)
  })

  it('submitAnswer() with wrong answer dispatches error event', () => {
    const el = createElement()
    const handler = vi.fn()
    el.addEventListener('imrobot-error', handler)

    el.submitAnswer('wrong-answer')

    expect(handler).toHaveBeenCalled()
  })

  it('respects difficulty attribute', () => {
    const el = createElement({ difficulty: 'hard' })
    const challenge = el.getChallenge()
    expect(challenge.difficulty).toBe('hard')
    expect(challenge.pipeline.length).toBeGreaterThanOrEqual(5)
  })

  it('respects theme attribute', () => {
    const el = createElement({ theme: 'dark' })
    const style = el.shadowRoot!.querySelector('style')
    expect(style).toBeTruthy()
    // Dark theme has specific colors
    expect(style!.textContent).toContain('#1a1a2e')
  })

  it('shows timer', () => {
    const el = createElement()
    const timer = el.shadowRoot!.querySelector('.imrobot-timer-text')
    expect(timer).toBeTruthy()
    expect(timer!.textContent).toMatch(/\d+s/)
  })

  it('shows verified state after correct submission', () => {
    const el = createElement()
    const challenge = el.getChallenge()
    const answer = solveChallenge(challenge)
    el.submitAnswer(answer)

    const status = el.shadowRoot!.querySelector('.imrobot-status--verified')
    expect(status).toBeTruthy()
    expect(status!.textContent).toContain('Verified')
  })
})
