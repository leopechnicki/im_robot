<script>
  import { generateChallenge, verifyAnswer, createToken } from 'imrobot/core'
  import { formatPipeline } from 'imrobot/core'
  import { getStyles, ROBOT_SVG } from 'imrobot/core'

  export let difficulty = 'medium'
  export let theme = 'light'
  export let ttl = 300000
  export let onVerified = (_token) => {}
  export let onError = (_error) => {}

  let challenge = generateChallenge({ difficulty, ttl })
  let answer = ''
  let status = 'idle'
  let startTime = Date.now()

  $: css = getStyles(theme)
  $: display = formatPipeline(challenge.seed, challenge.pipeline)
  $: challengeJson = JSON.stringify(challenge)

  function handleVerify() {
    const trimmed = answer.trim()
    if (!trimmed) return

    if (verifyAnswer(challenge, trimmed)) {
      status = 'verified'
      const token = createToken(challenge, trimmed, startTime)
      onVerified(token)
    } else {
      status = 'failed'
      onError(new Error('Verification failed'))
    }
  }

  function handleRetry() {
    challenge = generateChallenge({ difficulty, ttl })
    answer = ''
    status = 'idle'
    startTime = Date.now()
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleVerify()
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

  <div class="imrobot-challenge" aria-label="Challenge pipeline">
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
