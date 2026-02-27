import { defineComponent, ref, computed, h, onMounted, onUnmounted, type PropType } from 'vue'
import type { Challenge, ImRobotToken, Difficulty } from '../core/types'
import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { formatPipeline } from '../core/operations'
import { getStyles, ROBOT_SVG } from '../styles'
import { setupScreenshotShield } from '../screenshot-shield'

export const ImRobot = defineComponent({
  name: 'ImRobot',
  props: {
    difficulty: {
      type: String as PropType<Difficulty>,
      default: 'medium',
    },
    theme: {
      type: String as PropType<'light' | 'dark'>,
      default: 'light',
    },
    ttl: {
      type: Number,
      default: 0, // 0 = use default per-difficulty
    },
  },
  emits: ['verified', 'error'],
  setup(props, { emit }) {
    const challenge = ref<Challenge>(
      generateChallenge({
        difficulty: props.difficulty,
        ...(props.ttl > 0 ? { ttl: props.ttl } : {}),
      }),
    )
    const answer = ref('')
    const status = ref<'idle' | 'verified' | 'failed'>('idle')
    const startTime = ref(Date.now())
    const remainingSeconds = ref(Math.ceil(challenge.value.ttl / 1000))
    let countdownTimer: ReturnType<typeof setInterval> | null = null
    let cleanupShield: (() => void) | null = null
    const shielded = ref(false)

    const css = computed(() => getStyles(props.theme))
    const display = computed(() =>
      formatPipeline(challenge.value.visibleSeed, challenge.value.pipeline),
    )
    const challengeJson = computed(() => JSON.stringify(challenge.value))

    function refreshChallenge() {
      challenge.value = generateChallenge({
        difficulty: props.difficulty,
        ...(props.ttl > 0 ? { ttl: props.ttl } : {}),
      })
      answer.value = ''
      status.value = 'idle'
      startTime.value = Date.now()
      remainingSeconds.value = Math.ceil(challenge.value.ttl / 1000)
    }

    function startCountdown() {
      stopCountdown()
      countdownTimer = setInterval(() => {
        const elapsed = Date.now() - challenge.value.timestamp
        const remaining = Math.max(0, Math.ceil((challenge.value.ttl - elapsed) / 1000))
        remainingSeconds.value = remaining
        if (remaining <= 0) {
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

    onMounted(() => {
      startCountdown()
      cleanupShield = setupScreenshotShield((v) => { shielded.value = v })
    })
    onUnmounted(() => {
      stopCountdown()
      if (cleanupShield) cleanupShield()
    })

    function handleVerify() {
      const trimmed = answer.value.trim()
      if (!trimmed) return

      if (verifyAnswer(challenge.value, trimmed)) {
        status.value = 'verified'
        stopCountdown()
        const token = createToken(challenge.value, trimmed, startTime.value)
        emit('verified', token)
      } else {
        status.value = 'failed'
        emit('error', new Error('Verification failed'))
      }
    }

    function handleRetry() {
      refreshChallenge()
      startCountdown()
    }

    return () => {
      const totalSec = challenge.value.ttl / 1000
      const pct = (remainingSeconds.value / totalSec) * 100

      const children = [
        h('style', css.value),
        h(
          'div',
          {
            class: 'imrobot',
            'data-imrobot-challenge': challengeJson.value,
            role: 'region',
            'aria-label': 'ImRobot verification challenge',
          },
          [
            // Header
            h('div', { class: 'imrobot-header' }, [
              h('span', {
                class: 'imrobot-icon',
                innerHTML: ROBOT_SVG,
              }),
              h('span', "Prove you're a robot"),
            ]),

            // Countdown timer
            status.value !== 'verified' &&
              h('div', { class: 'imrobot-timer' }, [
                h('span', { class: 'imrobot-timer-label' }, 'Time'),
                h('div', { class: 'imrobot-timer-bar' }, [
                  h('div', {
                    class: `imrobot-timer-fill${pct <= 25 ? ' imrobot-timer-fill--warn' : ''}`,
                    style: { width: `${pct}%` },
                  }),
                ]),
                h('span', { class: 'imrobot-timer-text' }, `${remainingSeconds.value}s`),
              ]),

            // Challenge display
            h(
              'div',
              {
                class: `imrobot-challenge${shielded.value ? ' imrobot-challenge--shielded' : ''}`,
                'aria-label': 'Challenge pipeline',
                onContextmenu: (e: Event) => e.preventDefault(),
                onCopy: (e: Event) => e.preventDefault(),
                onDragstart: (e: Event) => e.preventDefault(),
              },
              [
                h('span', { class: 'imrobot-shield-notice' }, 'Screenshot protected'),
                display.value,
              ],
            ),

            // Input row
            status.value !== 'verified' &&
              h('div', { class: 'imrobot-row' }, [
                h('input', {
                  class: 'imrobot-input',
                  type: 'text',
                  value: answer.value,
                  onInput: (e: Event) => {
                    answer.value = (e.target as HTMLInputElement).value
                  },
                  onKeydown: (e: KeyboardEvent) => {
                    if (e.key === 'Enter') handleVerify()
                  },
                  placeholder: 'Enter pipeline result...',
                  'aria-label': 'Challenge answer',
                  autocomplete: 'off',
                }),
                h(
                  'button',
                  {
                    class: 'imrobot-btn',
                    onClick: handleVerify,
                    disabled: !answer.value.trim(),
                  },
                  'Verify',
                ),
              ]),

            // Footer
            h('div', { class: 'imrobot-footer' }, [
              h('div', [
                status.value === 'verified' &&
                  h(
                    'span',
                    { class: 'imrobot-status imrobot-status--verified' },
                    '\u2713 Verified: You are a robot',
                  ),
                status.value === 'failed' &&
                  h(
                    'span',
                    { class: 'imrobot-status imrobot-status--failed' },
                    [
                      '\u2717 Failed \u2014 ',
                      h(
                        'button',
                        {
                          onClick: handleRetry,
                          style: {
                            background: 'none',
                            border: 'none',
                            color: 'inherit',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            padding: '0',
                            font: 'inherit',
                          },
                        },
                        'try again',
                      ),
                    ],
                  ),
              ]),
              h('span', { class: 'imrobot-brand' }, 'imrobot'),
            ]),
          ],
        ),
      ]

      return h('div', children)
    }
  },
})
