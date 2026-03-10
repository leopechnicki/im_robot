import { describe, it, expect } from 'vitest'
import {
  executeOperation,
  executePipeline,
  formatOperation,
  formatPipeline,
} from '../src/core/operations'
import {
  generateChallenge,
  verifyAnswer,
  createToken,
} from '../src/core/challenge'
import { solveChallenge } from '../src/core/solver'
import { fnv1a } from '../src/core/hash'
import { SUSPICIOUS_THRESHOLD_MS } from '../src/core/types'
import type { Operation } from '../src/core/types'

describe('fnv1a', () => {
  it('produces consistent hashes', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'))
  })

  it('produces different hashes for different inputs', () => {
    expect(fnv1a('hello')).not.toBe(fnv1a('world'))
  })

  it('returns 8-char hex string', () => {
    expect(fnv1a('test')).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('operations', () => {
  it('reverse', () => {
    expect(executeOperation('abcdef', { op: 'reverse' })).toBe('fedcba')
  })

  it('to_upper', () => {
    expect(executeOperation('hello', { op: 'to_upper' })).toBe('HELLO')
  })

  it('to_lower', () => {
    expect(executeOperation('HELLO', { op: 'to_lower' })).toBe('hello')
  })

  it('rot13', () => {
    expect(executeOperation('hello', { op: 'rot13' })).toBe('uryyb')
    expect(executeOperation('uryyb', { op: 'rot13' })).toBe('hello')
  })

  it('hex_encode', () => {
    expect(executeOperation('AB', { op: 'hex_encode' })).toBe('4142')
  })

  it('sort_chars', () => {
    expect(executeOperation('dcba', { op: 'sort_chars' })).toBe('abcd')
  })

  it('char_code_sum', () => {
    // 'AB' = 65 + 66 = 131
    expect(executeOperation('AB', { op: 'char_code_sum' })).toBe('131')
  })

  it('base64_encode', () => {
    expect(executeOperation('hello', { op: 'base64_encode' })).toBe('aGVsbG8=')
  })

  it('substring', () => {
    expect(
      executeOperation('abcdefgh', { op: 'substring', start: 2, end: 5 }),
    ).toBe('cde')
  })

  it('repeat', () => {
    expect(executeOperation('ab', { op: 'repeat', times: 3 })).toBe('ababab')
  })

  it('replace', () => {
    expect(
      executeOperation('aabaa', { op: 'replace', search: 'a', replacement: 'x' }),
    ).toBe('xxbxx')
  })

  it('pad_start', () => {
    expect(
      executeOperation('abc', { op: 'pad_start', length: 6, fill: '0' }),
    ).toBe('000abc')
  })
})

describe('executePipeline', () => {
  it('chains operations correctly', () => {
    const pipeline: Operation[] = [
      { op: 'to_upper' },
      { op: 'reverse' },
    ]
    expect(executePipeline('hello', pipeline)).toBe('OLLEH')
  })

  it('handles empty pipeline', () => {
    expect(executePipeline('hello', [])).toBe('hello')
  })
})

describe('formatOperation', () => {
  it('formats simple operations', () => {
    expect(formatOperation({ op: 'reverse' })).toBe('reverse()')
    expect(formatOperation({ op: 'to_upper' })).toBe('to_upper()')
  })

  it('formats parameterized operations', () => {
    expect(formatOperation({ op: 'substring', start: 2, end: 5 })).toBe(
      'substring(2, 5)',
    )
    expect(formatOperation({ op: 'repeat', times: 3 })).toBe('repeat(3)')
  })
})

describe('formatPipeline', () => {
  it('formats full pipeline', () => {
    const result = formatPipeline('abc123', [
      { op: 'reverse' },
      { op: 'to_upper' },
    ])
    expect(result).toContain('seed: "abc123"')
    expect(result).toContain('1. reverse()')
    expect(result).toContain('2. to_upper()')
  })
})

describe('generateChallenge', () => {
  it('generates a valid challenge with nonce', () => {
    const challenge = generateChallenge()
    expect(challenge.version).toBe(1)
    expect(challenge.id).toMatch(/^[0-9a-f]{16}$/)
    expect(challenge.visibleSeed).toMatch(/^[0-9a-f]{16}$/)
    expect(challenge.nonce).toMatch(/^[0-9a-f]+$/)
    // seed = visibleSeed + nonce
    expect(challenge.seed).toBe(challenge.visibleSeed + challenge.nonce)
    expect(challenge.pipeline.length).toBeGreaterThanOrEqual(2)
    expect(challenge.verification).toMatch(/^[0-9a-f]{8}$/)
  })

  it('nonce length scales with difficulty', () => {
    const easy = generateChallenge({ difficulty: 'easy' })
    const medium = generateChallenge({ difficulty: 'medium' })
    const hard = generateChallenge({ difficulty: 'hard' })
    expect(easy.nonce.length).toBe(4)
    expect(medium.nonce.length).toBe(6)
    expect(hard.nonce.length).toBe(8)
  })

  it('uses short default TTLs per difficulty', () => {
    const easy = generateChallenge({ difficulty: 'easy' })
    const medium = generateChallenge({ difficulty: 'medium' })
    const hard = generateChallenge({ difficulty: 'hard' })
    expect(easy.ttl).toBe(30_000)
    expect(medium.ttl).toBe(20_000)
    expect(hard.ttl).toBe(15_000)
  })

  it('respects difficulty setting', () => {
    const easy = generateChallenge({ difficulty: 'easy' })
    expect(easy.difficulty).toBe('easy')
    expect(easy.pipeline.length).toBeGreaterThanOrEqual(2)
    expect(easy.pipeline.length).toBeLessThanOrEqual(3)

    const hard = generateChallenge({ difficulty: 'hard' })
    expect(hard.difficulty).toBe('hard')
    expect(hard.pipeline.length).toBeGreaterThanOrEqual(5)
    expect(hard.pipeline.length).toBeLessThanOrEqual(7)
  })

  it('respects custom ttl setting', () => {
    const challenge = generateChallenge({ ttl: 60_000 })
    expect(challenge.ttl).toBe(60_000)
  })

  it('solving with only visibleSeed gives wrong answer', () => {
    // Retry a few times because some operations (e.g. char_code_sum) can
    // collapse different inputs to the same output.
    let found = false
    for (let i = 0; i < 50; i++) {
      const challenge = generateChallenge()
      const wrongAnswer = executePipeline(challenge.visibleSeed, challenge.pipeline)
      const correctAnswer = solveChallenge(challenge)
      if (wrongAnswer !== correctAnswer) {
        expect(verifyAnswer(challenge, wrongAnswer)).toBe(false)
        expect(verifyAnswer(challenge, correctAnswer)).toBe(true)
        found = true
        break
      }
    }
    expect(found).toBe(true)
  })
})

describe('verifyAnswer', () => {
  it('accepts correct answer', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    expect(verifyAnswer(challenge, answer)).toBe(true)
  })

  it('rejects wrong answer', () => {
    const challenge = generateChallenge()
    expect(verifyAnswer(challenge, 'wrong-answer')).toBe(false)
  })

  it('rejects expired challenge', () => {
    const challenge = generateChallenge({ ttl: 1 })
    const answer = solveChallenge(challenge)
    // Manually expire
    challenge.timestamp = Date.now() - 1000
    expect(verifyAnswer(challenge, answer)).toBe(false)
  })
})

describe('solveChallenge', () => {
  it('solves any generated challenge', () => {
    for (let i = 0; i < 20; i++) {
      const challenge = generateChallenge({
        difficulty: (['easy', 'medium', 'hard'] as const)[i % 3],
      })
      const answer = solveChallenge(challenge)
      expect(verifyAnswer(challenge, answer)).toBe(true)
    }
  })
})

describe('createToken', () => {
  it('creates a valid token', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const startTime = Date.now() - 500
    const token = createToken(challenge, answer, startTime)

    expect(token.challengeId).toBe(challenge.id)
    expect(token.answer).toBe(answer)
    expect(token.elapsed).toBeGreaterThanOrEqual(400)
    expect(token.signature).toMatch(/^[0-9a-f]{8}$/)
  })

  it('flags fast submissions as not suspicious', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const startTime = Date.now() - 100
    const token = createToken(challenge, answer, startTime)
    expect(token.suspicious).toBe(false)
  })

  it('flags slow submissions as suspicious', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const startTime = Date.now() - (SUSPICIOUS_THRESHOLD_MS + 1000)
    const token = createToken(challenge, answer, startTime)
    expect(token.suspicious).toBe(true)
  })
})
