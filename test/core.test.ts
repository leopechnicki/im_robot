import { describe, it, expect } from 'vitest'
import {
  executeOperation,
  executePipeline,
  formatOperation,
  formatPipeline,
  formatOperationNL,
  formatPipelineNL,
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

  // --- New operations ---

  it('xor_encode', () => {
    const result = executeOperation('AB', { op: 'xor_encode', key: 1 })
    // 'A' = 65, 65 ^ 1 = 64 = '@'; 'B' = 66, 66 ^ 1 = 67 = 'C'
    expect(result).toBe('@C')
  })

  it('xor_encode is reversible', () => {
    const input = 'hello world'
    const key = 42
    const encoded = executeOperation(input, { op: 'xor_encode', key })
    const decoded = executeOperation(encoded, { op: 'xor_encode', key })
    expect(decoded).toBe(input)
  })

  it('count_chars', () => {
    expect(executeOperation('aabcaa', { op: 'count_chars', char: 'a' })).toBe('4')
    expect(executeOperation('hello', { op: 'count_chars', char: 'z' })).toBe('0')
    expect(executeOperation('', { op: 'count_chars', char: 'a' })).toBe('0')
  })

  it('caesar with positive shift', () => {
    expect(executeOperation('abc', { op: 'caesar', shift: 3 })).toBe('def')
    expect(executeOperation('xyz', { op: 'caesar', shift: 3 })).toBe('abc')
    expect(executeOperation('ABC', { op: 'caesar', shift: 1 })).toBe('BCD')
  })

  it('caesar with negative shift', () => {
    expect(executeOperation('def', { op: 'caesar', shift: -3 })).toBe('abc')
    expect(executeOperation('abc', { op: 'caesar', shift: -3 })).toBe('xyz')
  })

  it('caesar preserves non-alpha chars', () => {
    expect(executeOperation('a1b!c', { op: 'caesar', shift: 1 })).toBe('b1c!d')
  })

  it('slice_alternate', () => {
    expect(executeOperation('abcdef', { op: 'slice_alternate' })).toBe('ace')
    expect(executeOperation('a', { op: 'slice_alternate' })).toBe('a')
    expect(executeOperation('', { op: 'slice_alternate' })).toBe('')
  })

  it('fnv1a_hash', () => {
    const result = executeOperation('hello', { op: 'fnv1a_hash' })
    expect(result).toMatch(/^[0-9a-f]{8}$/)
    // Deterministic
    expect(executeOperation('hello', { op: 'fnv1a_hash' })).toBe(result)
  })

  it('length', () => {
    expect(executeOperation('hello', { op: 'length' })).toBe('5')
    expect(executeOperation('', { op: 'length' })).toBe('0')
    expect(executeOperation('abc', { op: 'length' })).toBe('3')
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

  it('formats new operations', () => {
    expect(formatOperation({ op: 'xor_encode', key: 42 })).toBe('xor_encode(42)')
    expect(formatOperation({ op: 'count_chars', char: 'a' })).toBe('count_chars("a")')
    expect(formatOperation({ op: 'caesar', shift: 13 })).toBe('caesar(13)')
    expect(formatOperation({ op: 'slice_alternate' })).toBe('slice_alternate()')
    expect(formatOperation({ op: 'fnv1a_hash' })).toBe('fnv1a_hash()')
    expect(formatOperation({ op: 'length' })).toBe('length()')
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

describe('formatOperationNL', () => {
  it('returns a non-empty string for every operation type', () => {
    const ops: Operation[] = [
      { op: 'reverse' },
      { op: 'base64_encode' },
      { op: 'to_upper' },
      { op: 'to_lower' },
      { op: 'rot13' },
      { op: 'hex_encode' },
      { op: 'sort_chars' },
      { op: 'char_code_sum' },
      { op: 'substring', start: 0, end: 5 },
      { op: 'repeat', times: 3 },
      { op: 'replace', search: 'a', replacement: 'b' },
      { op: 'pad_start', length: 10, fill: '0' },
      { op: 'xor_encode', key: 42 },
      { op: 'count_chars', char: 'a' },
      { op: 'caesar', shift: 3 },
      { op: 'slice_alternate' },
      { op: 'fnv1a_hash' },
      { op: 'length' },
      { op: 'sha256_hash' },
      { op: 'byte_xor', key: [1, 2, 3] },
      { op: 'hash_chain', rounds: 3 },
      { op: 'nibble_swap' },
      { op: 'bit_rotate', bits: 3 },
    ]
    for (const op of ops) {
      const result = formatOperationNL(op)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(5)
    }
  })

  it('produces different phrasings for the same operation (randomised)', () => {
    // Run 20 times and expect at least 2 distinct phrasings
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) {
      results.add(formatOperationNL({ op: 'reverse' }))
    }
    expect(results.size).toBeGreaterThanOrEqual(2)
  })

  it('does not return programmatic format strings', () => {
    // NL format should never look like "reverse()" or "to_upper()"
    for (let i = 0; i < 30; i++) {
      const nl = formatOperationNL({ op: 'reverse' })
      expect(nl).not.toBe('reverse()')
    }
  })

  it('includes parameters in the description', () => {
    const nl = formatOperationNL({ op: 'caesar', shift: 7 })
    expect(nl).toContain('7')

    const nl2 = formatOperationNL({ op: 'substring', start: 2, end: 8 })
    expect(nl2).toContain('2')
    expect(nl2).toContain('8')

    const nl3 = formatOperationNL({ op: 'byte_xor', key: [10, 20] })
    expect(nl3).toContain('10')
    expect(nl3).toContain('20')
  })
})

describe('formatPipelineNL', () => {
  it('includes the seed and all steps', () => {
    const result = formatPipelineNL('abc123', [
      { op: 'reverse' },
      { op: 'to_upper' },
    ])
    expect(result).toContain('abc123')
    // Should have step numbers
    expect(result).toContain('1:')
    expect(result).toContain('2:')
  })

  it('produces different output on repeated calls', () => {
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) {
      results.add(
        formatPipelineNL('seed', [
          { op: 'reverse' },
          { op: 'to_upper' },
          { op: 'hex_encode' },
        ]),
      )
    }
    expect(results.size).toBeGreaterThanOrEqual(2)
  })

  it('never matches the programmatic formatPipeline output', () => {
    const pipeline: Operation[] = [{ op: 'reverse' }, { op: 'to_upper' }]
    const programmatic = formatPipeline('seed', pipeline)
    let matchCount = 0
    for (let i = 0; i < 30; i++) {
      if (formatPipelineNL('seed', pipeline) === programmatic) matchCount++
    }
    expect(matchCount).toBe(0)
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
