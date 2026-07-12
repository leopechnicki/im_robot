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
    expect((status as HTMLElement).hidden).toBe(false)
  })

  // Regression: v0.7.2 — the .imrobot-status class set `display: flex`
  // with higher specificity than the browser's UA `[hidden] { display:none }`,
  // so both the "Verified" and "Failed" spans were painted on top of each
  // other before the user attempted verification. Fix: `.imrobot-status[hidden]
  // { display: none }` in styles.ts. These tests lock in that both spans are
  // *actually* invisible at idle, not just carrying a `hidden` attribute.
  it('hides both status messages at initial idle render (no attempt yet)', () => {
    const el = createElement()
    const shadow = el.shadowRoot!
    const verified = shadow.querySelector('.imrobot-status--verified') as HTMLElement
    const failed = shadow.querySelector('.imrobot-status--failed') as HTMLElement

    expect(verified).toBeTruthy()
    expect(failed).toBeTruthy()

    // Attribute-level hidden
    expect(verified.hidden).toBe(true)
    expect(failed.hidden).toBe(true)

    // The real regression check: computed style must be `none`, not `flex`.
    // Without the `.imrobot-status[hidden] { display: none }` rule the class
    // selector wins and both messages render visibly at once.
    expect(getComputedStyle(verified).display).toBe('none')
    expect(getComputedStyle(failed).display).toBe('none')
  })

  it('shows only the failed message after a wrong submission (not verified)', () => {
    const el = createElement()
    el.submitAnswer('wrong-answer')

    const shadow = el.shadowRoot!
    const verified = shadow.querySelector('.imrobot-status--verified') as HTMLElement
    const failed = shadow.querySelector('.imrobot-status--failed') as HTMLElement

    expect(verified.hidden).toBe(true)
    expect(failed.hidden).toBe(false)
    expect(getComputedStyle(verified).display).toBe('none')
    expect(getComputedStyle(failed).display).not.toBe('none')
  })

  it('shows only the verified message after a correct submission (not failed)', () => {
    const el = createElement()
    const challenge = el.getChallenge()
    const answer = solveChallenge(challenge)
    el.submitAnswer(answer)

    const shadow = el.shadowRoot!
    const verified = shadow.querySelector('.imrobot-status--verified') as HTMLElement
    const failed = shadow.querySelector('.imrobot-status--failed') as HTMLElement

    expect(verified.hidden).toBe(false)
    expect(failed.hidden).toBe(true)
    expect(getComputedStyle(verified).display).not.toBe('none')
    expect(getComputedStyle(failed).display).toBe('none')
  })

  it('preserves input focus across a failed verification (no full re-render)', () => {
    const el = createElement()
    const input = el.shadowRoot!.querySelector('.imrobot-input') as HTMLInputElement
    expect(input).toBeTruthy()

    // Type a wrong answer and focus the input
    input.value = 'wrong-answer'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
    expect(el.shadowRoot!.activeElement).toBe(input)

    // Submit — verification fails, status flips to 'failed'
    el.submitAnswer('wrong-answer')

    // The same input node must still be in the DOM (not re-created),
    // and focus must be preserved (this is the regression we fixed).
    const inputAfter = el.shadowRoot!.querySelector('.imrobot-input') as HTMLInputElement
    expect(inputAfter).toBe(input) // same node reference
    expect(el.shadowRoot!.activeElement).toBe(input)
  })

  it('does not duplicate event listeners across state transitions', () => {
    const el = createElement()
    const handler = vi.fn()
    el.addEventListener('imrobot-error', handler)

    // Submit twice — both should fire exactly once, not twice on the second call
    el.submitAnswer('wrong-1')
    el.submitAnswer('wrong-2')

    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('respects size attribute (compact)', () => {
    const el = createElement({ size: 'compact' })
    const style = el.shadowRoot!.querySelector('style')
    expect(style).toBeTruthy()
    // Compact mode injects the 320px max-width override
    expect(style!.textContent).toContain('max-width: 320px')
  })

  it('observes size attribute changes after connect', () => {
    const el = createElement()
    el.setAttribute('size', 'compact')
    const style = el.shadowRoot!.querySelector('style')
    expect(style!.textContent).toContain('max-width: 320px')
  })

  it('observes theme attribute changes without re-creating input', () => {
    const el = createElement()
    const inputBefore = el.shadowRoot!.querySelector('.imrobot-input')
    el.setAttribute('theme', 'dark')
    const inputAfter = el.shadowRoot!.querySelector('.imrobot-input')
    expect(inputAfter).toBe(inputBefore)
  })

  it('cleanup on disconnect clears listeners and timers', () => {
    const el = createElement()
    expect(el.shadowRoot!.querySelector('.imrobot')).toBeTruthy()
    el.remove()
    // After removal, getChallenge still works (snapshot of state) but no
    // background timer should keep the test runner alive.
    expect(el.getChallenge()).toBeDefined()
  })
})
