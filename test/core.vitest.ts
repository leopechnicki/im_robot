/**
 * Comprehensive test suite for imrobot core functionality
 * Vitest-compatible version
 * Run with: npm run test
 */

import { describe, it, expect } from 'vitest'
import {
  executeOperation,
  executePipeline,
  formatOperation,
  formatPipeline,
} from '../src/core/operations'
import { fnv1a } from '../src/core/hash'
import { generateChallenge, verifyAnswer, createToken, SUSPICIOUS_THRESHOLD_MS } from '../src/core/challenge'
import { solveChallenge } from '../src/core/solver'

// ─── Operations Tests ───────────────────────────────────────────────────────

describe('Operations', () => {
  describe('reverse', () => {
    it('should reverse a string', () => {
      expect(executeOperation('hello', { op: 'reverse' })).toBe('olleh')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'reverse' })).toBe('')
    })

    it('should handle single character', () => {
      expect(executeOperation('a', { op: 'reverse' })).toBe('a')
    })

    it('should reverse numbers', () => {
      expect(executeOperation('12345', { op: 'reverse' })).toBe('54321')
    })
  })

  describe('base64_encode', () => {
    it('should encode to base64', () => {
      expect(executeOperation('hello', { op: 'base64_encode' })).toBe('aGVsbG8=')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'base64_encode' })).toBe('')
    })
  })

  describe('to_upper', () => {
    it('should convert to uppercase', () => {
      expect(executeOperation('hello', { op: 'to_upper' })).toBe('HELLO')
    })

    it('should handle mixed case', () => {
      expect(executeOperation('HeLLo', { op: 'to_upper' })).toBe('HELLO')
    })

    it('should not affect numbers', () => {
      expect(executeOperation('123', { op: 'to_upper' })).toBe('123')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'to_upper' })).toBe('')
    })
  })

  describe('to_lower', () => {
    it('should convert to lowercase', () => {
      expect(executeOperation('HELLO', { op: 'to_lower' })).toBe('hello')
    })

    it('should handle mixed case', () => {
      expect(executeOperation('HeLLo', { op: 'to_lower' })).toBe('hello')
    })

    it('should not affect numbers', () => {
      expect(executeOperation('123', { op: 'to_lower' })).toBe('123')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'to_lower' })).toBe('')
    })
  })

  describe('rot13', () => {
    it('should apply ROT13 to lowercase', () => {
      expect(executeOperation('hello', { op: 'rot13' })).toBe('uryyb')
    })

    it('should apply ROT13 to uppercase', () => {
      expect(executeOperation('HELLO', { op: 'rot13' })).toBe('URYYB')
    })

    it('should apply ROT13 correctly', () => {
      expect(executeOperation('abc', { op: 'rot13' })).toBe('nop')
    })

    it('should not affect numbers', () => {
      expect(executeOperation('123!@#', { op: 'rot13' })).toBe('123!@#')
    })

    it('should be reversible (apply twice)', () => {
      const original = 'hello'
      const once = executeOperation(original, { op: 'rot13' })
      const twice = executeOperation(once, { op: 'rot13' })
      expect(twice).toBe(original)
    })
  })

  describe('hex_encode', () => {
    it('should encode to hex', () => {
      expect(executeOperation('AB', { op: 'hex_encode' })).toBe('4142')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'hex_encode' })).toBe('')
    })
  })

  describe('sort_chars', () => {
    it('should sort characters', () => {
      expect(executeOperation('dcba', { op: 'sort_chars' })).toBe('abcd')
    })

    it('should handle repeated characters', () => {
      expect(executeOperation('hello', { op: 'sort_chars' })).toBe('ehllo')
    })

    it('should handle single character', () => {
      expect(executeOperation('a', { op: 'sort_chars' })).toBe('a')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'sort_chars' })).toBe('')
    })
  })

  describe('char_code_sum', () => {
    it('should sum character codes', () => {
      // 'A' = 65, 'B' = 66, 'C' = 67 => 198
      expect(executeOperation('ABC', { op: 'char_code_sum' })).toBe('198')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'char_code_sum' })).toBe('0')
    })
  })

  describe('substring', () => {
    it('should extract substring', () => {
      expect(executeOperation('hello', { op: 'substring', start: 1, end: 4 })).toBe('ell')
    })

    it('should handle full range', () => {
      expect(executeOperation('hello', { op: 'substring', start: 0, end: 5 })).toBe('hello')
    })

    it('should handle empty result', () => {
      expect(executeOperation('hello', { op: 'substring', start: 2, end: 2 })).toBe('')
    })
  })

  describe('repeat', () => {
    it('should repeat string', () => {
      expect(executeOperation('ab', { op: 'repeat', times: 3 })).toBe('ababab')
    })

    it('should handle single repeat', () => {
      expect(executeOperation('x', { op: 'repeat', times: 1 })).toBe('x')
    })

    it('should handle empty string', () => {
      expect(executeOperation('', { op: 'repeat', times: 5 })).toBe('')
    })
  })

  describe('replace', () => {
    it('should replace all occurrences', () => {
      expect(executeOperation('hello', { op: 'replace', search: 'l', replacement: 'L' })).toBe('heLLo')
    })

    it('should handle no matches', () => {
      expect(executeOperation('hello', { op: 'replace', search: 'x', replacement: 'y' })).toBe('hello')
    })

    it('should replace entire string', () => {
      expect(executeOperation('hello', { op: 'replace', search: 'hello', replacement: 'world' })).toBe('world')
    })
  })

  describe('pad_start', () => {
    it('should pad with zeros', () => {
      expect(executeOperation('5', { op: 'pad_start', length: 3, fill: '0' })).toBe('005')
    })

    it('should pad with custom fill', () => {
      expect(executeOperation('hello', { op: 'pad_start', length: 10, fill: '*' })).toBe('*****hello')
    })

    it('should not pad if already long enough', () => {
      expect(executeOperation('hello', { op: 'pad_start', length: 3, fill: '*' })).toBe('hello')
    })
  })

  describe('edge cases', () => {
    it('should handle unicode characters', () => {
      const emoji = '🚀'
      const reversed = executeOperation(emoji + 'hello', { op: 'reverse' })
      expect(reversed.length).toBeGreaterThan(0)
    })

    it('should handle special characters', () => {
      const special = '!@#$%^&*()'
      const upper = executeOperation(special, { op: 'to_upper' })
      expect(upper).toBe(special)

      const reversed = executeOperation(special, { op: 'reverse' })
      expect(reversed).toBe(')(*&^%$#@!')
    })
  })

  describe('pipeline execution', () => {
    it('should execute pipeline in order', () => {
      const seed = 'hello'
      const pipeline = [
        { op: 'to_upper' },
        { op: 'reverse' },
      ]
      const result = executePipeline(seed, pipeline)
      expect(result).toBe('OLLEH')
    })

    it('should handle complex pipeline', () => {
      const seed = 'abc'
      const pipeline = [
        { op: 'repeat', times: 2 },
        { op: 'to_upper' },
        { op: 'reverse' },
      ]
      // abc -> abcabc -> ABCABC -> CBACBA
      const result = executePipeline(seed, pipeline)
      expect(result).toBe('CBACBA')
    })
  })

  describe('formatting', () => {
    it('formatOperation should format reverse', () => {
      expect(formatOperation({ op: 'reverse' })).toBe('reverse()')
    })

    it('formatOperation should format with parameters', () => {
      expect(formatOperation({ op: 'substring', start: 1, end: 5 })).toBe('substring(1, 5)')
    })

    it('formatPipeline should include seed and operations', () => {
      const seed = 'test'
      const pipeline = [{ op: 'reverse' }, { op: 'to_upper' }]
      const formatted = formatPipeline(seed, pipeline)
      expect(formatted).toContain('seed: "test"')
      expect(formatted).toContain('reverse()')
      expect(formatted).toContain('to_upper()')
    })
  })
})

// ─── Hash Tests ─────────────────────────────────────────────────────────────

describe('Hash', () => {
  it('should produce consistent hash for same input', () => {
    const hash1 = fnv1a('test')
    const hash2 = fnv1a('test')
    expect(hash1).toBe(hash2)
  })

  it('should produce different hash for different input', () => {
    const hash1 = fnv1a('test1')
    const hash2 = fnv1a('test2')
    expect(hash1).not.toBe(hash2)
  })

  it('should return 8-char hex string', () => {
    const hash = fnv1a('anything')
    expect(hash).toHaveLength(8)
    expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true)
  })

  it('should handle empty string', () => {
    const hash = fnv1a('')
    expect(hash).toHaveLength(8)
    expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true)
  })

  it('should handle long strings', () => {
    const longStr = 'x'.repeat(10000)
    const hash = fnv1a(longStr)
    expect(hash).toHaveLength(8)
    expect(/^[0-9a-f]{8}$/.test(hash)).toBe(true)
  })
})

// ─── Challenge Generation Tests ───────────────────────────────────────────

describe('Challenge Generation', () => {
  it('should generate valid challenge structure', () => {
    const challenge = generateChallenge()
    expect(challenge.version).toBe(1)
    expect(challenge.id).toBeDefined()
    expect(challenge.timestamp).toBeDefined()
    expect(challenge.ttl).toBeDefined()
    expect(['easy', 'medium', 'hard']).toContain(challenge.difficulty)
    expect(challenge.seed).toBeDefined()
    expect(challenge.visibleSeed).toBeDefined()
    expect(challenge.nonce).toBeDefined()
    expect(Array.isArray(challenge.pipeline)).toBe(true)
    expect(challenge.verification).toBeDefined()
  })

  it('should have seed = visibleSeed + nonce', () => {
    const challenge = generateChallenge()
    expect(challenge.seed).toBe(challenge.visibleSeed + challenge.nonce)
  })

  it('should have 8-char hex verification', () => {
    const challenge = generateChallenge()
    expect(challenge.verification).toHaveLength(8)
    expect(/^[0-9a-f]{8}$/.test(challenge.verification)).toBe(true)
  })

  describe('difficulty levels', () => {
    it('easy should have 2-3 operations', () => {
      for (let i = 0; i < 10; i++) {
        const challenge = generateChallenge({ difficulty: 'easy' })
        expect(challenge.pipeline.length).toBeGreaterThanOrEqual(2)
        expect(challenge.pipeline.length).toBeLessThanOrEqual(3)
      }
    })

    it('medium should have 3-5 operations', () => {
      for (let i = 0; i < 10; i++) {
        const challenge = generateChallenge({ difficulty: 'medium' })
        expect(challenge.pipeline.length).toBeGreaterThanOrEqual(3)
        expect(challenge.pipeline.length).toBeLessThanOrEqual(5)
      }
    })

    it('hard should have 5-7 operations', () => {
      for (let i = 0; i < 10; i++) {
        const challenge = generateChallenge({ difficulty: 'hard' })
        expect(challenge.pipeline.length).toBeGreaterThanOrEqual(5)
        expect(challenge.pipeline.length).toBeLessThanOrEqual(7)
      }
    })
  })

  describe('nonce lengths', () => {
    it('easy should have 4-char nonce', () => {
      const challenge = generateChallenge({ difficulty: 'easy' })
      expect(challenge.nonce).toHaveLength(4)
    })

    it('medium should have 6-char nonce', () => {
      const challenge = generateChallenge({ difficulty: 'medium' })
      expect(challenge.nonce).toHaveLength(6)
    })

    it('hard should have 8-char nonce', () => {
      const challenge = generateChallenge({ difficulty: 'hard' })
      expect(challenge.nonce).toHaveLength(8)
    })
  })

  describe('TTL defaults', () => {
    it('easy should have 30000ms TTL', () => {
      const challenge = generateChallenge({ difficulty: 'easy' })
      expect(challenge.ttl).toBe(30_000)
    })

    it('medium should have 20000ms TTL', () => {
      const challenge = generateChallenge({ difficulty: 'medium' })
      expect(challenge.ttl).toBe(20_000)
    })

    it('hard should have 15000ms TTL', () => {
      const challenge = generateChallenge({ difficulty: 'hard' })
      expect(challenge.ttl).toBe(15_000)
    })

    it('should respect custom TTL', () => {
      const customTtl = 60_000
      const challenge = generateChallenge({ difficulty: 'medium', ttl: customTtl })
      expect(challenge.ttl).toBe(customTtl)
    })
  })

  it('should generate unique challenge IDs', () => {
    const ids = new Set()
    for (let i = 0; i < 100; i++) {
      const challenge = generateChallenge()
      ids.add(challenge.id)
    }
    expect(ids.size).toBe(100)
  })
})

// ─── Solver Tests ───────────────────────────────────────────────────────────

describe('Solver', () => {
  it('should solve easy challenges', () => {
    const challenge = generateChallenge({ difficulty: 'easy' })
    const answer = solveChallenge(challenge)
    expect(typeof answer).toBe('string')
    expect(answer.length).toBeGreaterThan(0)
  })

  it('should solve medium challenges', () => {
    const challenge = generateChallenge({ difficulty: 'medium' })
    const answer = solveChallenge(challenge)
    expect(typeof answer).toBe('string')
    expect(answer.length).toBeGreaterThan(0)
  })

  it('should solve hard challenges', () => {
    const challenge = generateChallenge({ difficulty: 'hard' })
    const answer = solveChallenge(challenge)
    expect(typeof answer).toBe('string')
    expect(answer.length).toBeGreaterThan(0)
  })

  it('should solve 20+ random challenges', () => {
    for (let i = 0; i < 20; i++) {
      const challenge = generateChallenge()
      const answer = solveChallenge(challenge)
      expect(typeof answer).toBe('string')
      expect(answer.length).toBeGreaterThan(0)
    }
  })
})

// ─── Verification Tests ──────────────────────────────────────────────────────

describe('Verification', () => {
  it('should accept correct answer', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    expect(verifyAnswer(challenge, answer)).toBe(true)
  })

  it('should reject wrong answer', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const wrongAnswer = answer + 'x'
    expect(verifyAnswer(challenge, wrongAnswer)).toBe(false)
  })

  it('should reject expired challenge', () => {
    const challenge = generateChallenge({ ttl: 100 })
    const answer = solveChallenge(challenge)
    challenge.timestamp = Date.now() - 200
    expect(verifyAnswer(challenge, answer)).toBe(false)
  })

  it('security: only visibleSeed produces wrong answer', () => {
    const challenge = generateChallenge()
    const correctAnswer = solveChallenge(challenge)
    const wrongAnswer = executePipeline(challenge.visibleSeed, challenge.pipeline)
    expect(wrongAnswer).not.toBe(correctAnswer)
  })
})

// ─── Token Creation Tests ────────────────────────────────────────────────────

describe('Token Creation', () => {
  it('should create token with correct structure', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const startTime = Date.now()
    const token = createToken(challenge, answer, startTime)

    expect(token.challengeId).toBe(challenge.id)
    expect(token.answer).toBe(answer)
    expect(token.timestamp).toBeGreaterThanOrEqual(startTime)
    expect(token.elapsed).toBeGreaterThanOrEqual(0)
    expect(typeof token.suspicious).toBe('boolean')
    expect(token.signature).toHaveLength(8)
    expect(/^[0-9a-f]{8}$/.test(token.signature)).toBe(true)
  })

  it('should not flag fast submissions as suspicious', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const startTime = Date.now()
    const token = createToken(challenge, answer, startTime)
    expect(token.suspicious).toBe(false)
  })

  it('should flag slow submissions as suspicious', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const startTime = Date.now() - 6000 // 6 seconds ago
    const token = createToken(challenge, answer, startTime)
    expect(token.suspicious).toBe(true)
  })
})

// ─── Integration Tests ──────────────────────────────────────────────────────

describe('Integration', () => {
  it('should complete full flow: generate, solve, verify', () => {
    const challenge = generateChallenge({ difficulty: 'medium' })
    const answer = solveChallenge(challenge)
    const verified = verifyAnswer(challenge, answer)
    expect(verified).toBe(true)
  })

  it('should complete full flow with token', () => {
    const challenge = generateChallenge()
    const startTime = Date.now()
    const answer = solveChallenge(challenge)
    const verified = verifyAnswer(challenge, answer)
    expect(verified).toBe(true)

    const token = createToken(challenge, answer, startTime)
    expect(token.challengeId).toBe(challenge.id)
    expect(token.answer).toBe(answer)
  })

  it('should solve multiple challenges of different difficulties', () => {
    const challenges = [
      generateChallenge({ difficulty: 'easy' }),
      generateChallenge({ difficulty: 'medium' }),
      generateChallenge({ difficulty: 'hard' }),
    ]

    for (const challenge of challenges) {
      const answer = solveChallenge(challenge)
      expect(verifyAnswer(challenge, answer)).toBe(true)
    }
  })
})
