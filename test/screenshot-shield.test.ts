import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupScreenshotShield } from '../src/screenshot-shield'

describe('setupScreenshotShield', () => {
  let cleanup: () => void

  afterEach(() => {
    if (cleanup) cleanup()
    vi.restoreAllMocks()
  })

  it('returns a cleanup function', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)
    expect(typeof cleanup).toBe('function')
  })

  it('activates on PrintScreen key', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'PrintScreen', bubbles: true }),
    )

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('activates on Cmd+Shift+3 (macOS screenshot)', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '3',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('activates on Cmd+Shift+4 (macOS screenshot)', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '4',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('activates on Cmd+Shift+5 (macOS screenshot)', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '5',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('activates on Ctrl+Shift+S', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('activates on window blur', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    window.dispatchEvent(new Event('blur'))

    expect(callback).toHaveBeenCalledWith(true)
  })

  it('deactivates after timeout', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'PrintScreen', bubbles: true }),
    )

    expect(callback).toHaveBeenCalledWith(true)

    vi.advanceTimersByTime(1200)

    expect(callback).toHaveBeenCalledWith(false)
    vi.useRealTimers()
  })

  it('does not activate on regular keys', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', bubbles: true }),
    )

    expect(callback).not.toHaveBeenCalled()
  })

  it('removes event listeners on cleanup', () => {
    const callback = vi.fn()
    cleanup = setupScreenshotShield(callback)
    cleanup()

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'PrintScreen', bubbles: true }),
    )

    expect(callback).not.toHaveBeenCalled()
  })
})
