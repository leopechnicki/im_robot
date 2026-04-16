<script>
  import { generateChallenge, verifyAnswer, createToken } from '../core/index'
  import { formatPipeline } from 'imrobot/core'
  import { getStyles, ROBOT_SVG } from '../styles'
  import { setupScreenshotShield } from 'imrobot'
  import { onMount, onDestroy } from 'svelte'

  export let difficulty = 'medium'
  export let theme = 'light'
  export let ttl = 0
  export let onVerified = (_token) => {}
  export let onError = (_error) => {}

  let challenge = generateChallenge({ difficulty, ...(ttl > 0 ? { ttl } : {}) })
  let answer = ''
  let status = 'idle'
  let startTime = Date.now()
  let remainingSeconds = Math.ceil(challenge.ttl / 1000)
  let countdownTimer = null
  let shielded = false
  let cleanupShield = null

  $: css = getStyles(theme)
  $: display = formatPipeline(challenge.visibleSeed, challenge.pipeline)
  $: challengeJson = JSON.stringify(challenge)
  $: totalSec = challenge.ttl / 1000
  $: pct = (remainingSeconds / totalSec) * 100

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

  onMount(() => {
    startCountdown()
    cleanupShield = setupScreenshotShield((v) => { shielded = v })
  })
  onDestroy(() => {
    stopCountdown()
    if (cleanupShield) cleanupShield()
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
