import { describe, it, expect } from 'vitest'
import { generateChallenge } from '../src/core/challenge'

describe('challenge op selection — deprecation guard', () => {
  it('never generates the deprecated sha256_hash op at any difficulty', () => {
    const difficulties = ['easy', 'medium', 'hard'] as const
    for (const difficulty of difficulties) {
      for (let i = 0; i < 50; i++) {
        const challenge = generateChallenge({ difficulty })
        for (const op of challenge.pipeline) {
          expect(op.op, `difficulty=${difficulty} iteration=${i}`).not.toBe('sha256_hash')
        }
      }
    }
  })
})
