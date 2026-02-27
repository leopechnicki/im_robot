export type ShieldCallback = (shielded: boolean) => void

const SHIELD_DURATION_MS = 1200

export function setupScreenshotShield(callback: ShieldCallback): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null

  function activate() {
    callback(true)
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => { callback(false); timeout = null }, SHIELD_DURATION_MS)
  }

  function onKey(e: KeyboardEvent) {
    if (
      e.key === 'PrintScreen' ||
      (e.metaKey && e.shiftKey && '345'.includes(e.key)) ||
      (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's')
    ) activate()
  }

  function onHidden() { if (document.visibilityState === 'hidden') activate() }
  function onBlur() { activate() }

  document.addEventListener('keydown', onKey, true)
  document.addEventListener('keyup', onKey, true)
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('blur', onBlur)

  return () => {
    document.removeEventListener('keydown', onKey, true)
    document.removeEventListener('keyup', onKey, true)
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('blur', onBlur)
    if (timeout) clearTimeout(timeout)
  }
}
