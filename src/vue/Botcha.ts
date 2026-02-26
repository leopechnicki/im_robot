import { defineComponent, ref, computed, h, type PropType } from 'vue'
import type { Challenge, ImRobotToken, Difficulty } from '../core/types'
import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { formatPipeline } from '../core/operations'
import { getStyles, ROBOT_SVG } from '../styles'

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
      default: 300_000,
    },
  },
  emits: ['verified', 'error'],
  setup(props, { emit }) {
    const challenge = ref<Challenge>(
      generateChallenge({ difficulty: props.difficulty, ttl: props.ttl }),
    )
    const answer = ref('')
    const status = ref<'idle' | 'verified' | 'failed'>('idle')
    const startTime = ref(Date.now())

    const css = computed(() => getStyles(props.theme))
    const display = computed(() =>
      formatPipeline(challenge.value.seed, challenge.value.pipeline),
    )
    const challengeJson = computed(() => JSON.stringify(challenge.value))

    function handleVerify() {
      const trimmed = answer.value.trim()
      if (!trimmed) return

      if (verifyAnswer(challenge.value, trimmed)) {
        status.value = 'verified'
        const token = createToken(challenge.value, trimmed, startTime.value)
        emit('verified', token)
      } else {
        status.value = 'failed'
        emit('error', new Error('Verification failed'))
      }
    }

    function handleRetry() {
      challenge.value = generateChallenge({
        difficulty: props.difficulty,
        ttl: props.ttl,
      })
      answer.value = ''
      status.value = 'idle'
      startTime.value = Date.now()
    }

    return () => {
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

            // Challenge display
            h(
              'div',
              {
                class: 'imrobot-challenge',
                'aria-label': 'Challenge pipeline',
              },
              display.value,
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
