<script>
  /**
   * Svelte 5 (runes) adapter for the imrobot widget.
   *
   * Uses `$props`, `$state`, `$derived`, and `$effect` so the component
   * works under Svelte 5's strict runes mode. Falls back to legacy mode
   * automatically when consumed from a Svelte 4 codebase via `svelte`'s
   * compatibility layer.
   */
  import { generateChallenge, verifyAnswer, createToken } from '../core/index'
  import { formatPipeline } from '../core/index'
  import { getStyles, ROBOT_SVG } from '../styles'
  import { setupScreenshotShield } from '../screenshot-shield'

  let {
    difficulty = 'medium',
    theme = 'light',
    size = 'standard',
    ttl = 0,
    onVerified = (_token) => {},
    onError = (_error) => {},
  } = $props()

  let challenge = $state(generateChallenge({ difficulty, ...(ttl > 0 ? { ttl } : {}) }))
  let answer = $state('')
  let status = $state('idle')
  let startTime = $state(Date.now())
  let remainingSeconds = $state(Math.ceil(challenge.ttl / 1000))
  let countdownTimer = $state(null)
  let shielded = $state(false)
  let cleanupShield = null

  let css = $derived(getStyles(theme, size))
  let display = $derived(formatPipeline(challenge.visibleSeed, challenge.pipeline))
  let challengeJson = $derived(JSON.stringify(challenge))
  let totalSec = $derived(challenge.ttl / 1000)
  let pct = $derived((remainingSeconds / totalSec) * 100)

  function refreshChallenge() {
    challenge = generateChallenge({ difficulty, ...(ttl > 0 ? { ttl } : {}) })
    answer = ''
    status = 'idle'
    startTime = Date.now()
    remainingSeconds = Math.ceil(challenge.ttl / 1000)
  }

  function startCountdown() {
    stopCountdown()
    countdownTimer = setInterval(() => {
      const elapsed = Date.now() - challenge.timestamp
      remainingSeconds = Math.max(0, Math.ceil((challenge.ttl - elapsed) / 1000))
      if (remainingSeconds <= 0) {
        refreshChallenge()
        startCountdown()
      }
    }, 1000)
  }

  function stopCountdown() {
    if (countdownTimer !== null) {
      clearInterval(countdownTimer)
      countdownTimer = null
    }
  }

  $effect(() => {
    startCountdown()
    cleanupShield = setupScreenshotShield((v) => { shielded = v })
    return () => {
      stopCountdown()
      if (cleanupShield) cleanupShield()
    }
  })

  function handleVerify() {
    const trimmed = answer.trim()
    if (!trimmed) return

    if (verifyAnswer(challenge, trimmed)) {
      status = 'verified'
      stopCountdown()
      const token = createToken(challenge, trimmed, startTime)
      onVerified(token)
    } else {
      status = 'failed'
      onError(new Error('Verification failed'))
    }
  }

  function handleRetry() {
    refreshChallenge()
    startCountdown()
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleVerify()
  }

  function preventEvent(e) {
    e.preventDefault()
  }
</script>

{@html `<style>${css}</style>`}

<div
  class="imrobot"
  data-imrobot-challenge={challengeJson}
  role="region"
  aria-label="ImRobot verification challenge"
>
  <div class="imrobot-header">
    <span class="imrobot-icon">{@html ROBOT_SVG}</span>
    <span>Prove you're a robot</span>
  </div>

  {#if status !== 'verified'}
    <div class="imrobot-timer">
      <span class="imrobot-timer-label">Time</span>
      <div class="imrobot-timer-bar">
        <div
          class="imrobot-timer-fill"
          class:imrobot-timer-fill--warn={pct <= 25}
          style="width:{pct}%"
        ></div>
      </div>
      <span class="imrobot-timer-text">{remainingSeconds}s</span>
    </div>
  {/if}

  <div
    class="imrobot-challenge"
    class:imrobot-challenge--shielded={shielded}
    aria-label="Challenge pipeline"
    on:contextmenu={preventEvent}
    on:copy={preventEvent}
    on:dragstart={preventEvent}
  >
    <span class="imrobot-shield-notice">Screenshot protected</span>
    {display}
  </div>

  {#if status !== 'verified'}
    <div class="imrobot-row">
      <input
        class="imrobot-input"
        type="text"
        bind:value={answer}
        on:keydown={handleKeydown}
        placeholder="Enter pipeline result..."
        aria-label="Challenge answer"
        autocomplete="off"
      />
      <button
        class="imrobot-btn"
        on:click={handleVerify}
        disabled={!answer.trim()}
      >
        Verify
      </button>
    </div>
  {/if}

  <div class="imrobot-footer">
    <div>
      {#if status === 'verified'}
        <span class="imrobot-status imrobot-status--verified">
          &#10003; Verified: You are a robot
        </span>
      {/if}
      {#if status === 'failed'}
        <span class="imrobot-status imrobot-status--failed">
          &#10007; Failed &mdash;
          <button
            on:click={handleRetry}
            style="background:none;border:none;color:inherit;text-decoration:underline;cursor:pointer;padding:0;font:inherit;"
          >
            try again
          </button>
        </span>
      {/if}
    </div>
    <span class="imrobot-brand">imrobot</span>
  </div>
</div>
