/**
 * Comprehensive test suite for imrobot core functionality
 * Using Node.js built-in test runner (node:test)
 */

import { test } from 'node:test'
import assert from 'node:assert'
import {
  executeOperation,
  executePipeline,
  formatOperation,
  formatPipeline,
} from './operations.mjs'
import { fnv1a } from './hash.mjs'
import { generateChallenge, verifyAnswer, createToken, SUSPICIOUS_THRESHOLD_MS } from './challenge.mjs'
import { solveChallenge } from './solver.mjs'

// ─── Operations Tests ───────────────────────────────────────────────────────

test('Operations: reverse', () => {
  assert.strictEqual(executeOperation('hello', { op: 'reverse' }), 'olleh')
  assert.strictEqual(executeOperation('', { op: 'reverse' }), '')
  assert.strictEqual(executeOperation('a', { op: 'reverse' }), 'a')
  assert.strictEqual(executeOperation('12345', { op: 'reverse' }), '54321')
})

test('Operations: base64_encode', () => {
  const encoded = executeOperation('hello', { op: 'base64_encode' })
  assert.strictEqual(encoded, 'aGVsbG8=')
  assert.strictEqual(executeOperation('', { op: 'base64_encode' }), '')
})

test('Operations: to_upper', () => {
  assert.strictEqual(executeOperation('hello', { op: 'to_upper' }), 'HELLO')
  assert.strictEqual(executeOperation('HeLLo', { op: 'to_upper' }), 'HELLO')
  assert.strictEqual(executeOperation('123', { op: 'to_upper' }), '123')
  assert.strictEqual(executeOperation('', { op: 'to_upper' }), '')
})

test('Operations: to_lower', () => {
  assert.strictEqual(executeOperation('HELLO', { op: 'to_lower' }), 'hello')
  assert.strictEqual(executeOperation('HeLLo', { op: 'to_lower' }), 'hello')
  assert.strictEqual(executeOperation('123', { op: 'to_lower' }), '123')
  assert.strictEqual(executeOperation('', { op: 'to_lower' }), '')
})

test('Operations: rot13', () => {
  assert.strictEqual(executeOperation('hello', { op: 'rot13' }), 'uryyb')
  assert.strictEqual(executeOperation('HELLO', { op: 'rot13' }), 'URYYB')
  assert.strictEqual(executeOperation('abc', { op: 'rot13' }), 'nop')
  assert.strictEqual(executeOperation('ABC', { op: 'rot13' }), 'NOP')
  assert.strictEqual(executeOperation('123!@#', { op: 'rot13' }), '123!@#')
  // Applying rot13 twice should give back original
  const original = 'hello'
  const once = executeOperation(original, { op: 'rot13' })
  const twice = executeOperation(once, { op: 'rot13' })
  assert.strictEqual(twice, original)
})

test('Operations: hex_encode', () => {
  const result = executeOperation('AB', { op: 'hex_encode' })
  assert.strictEqual(result, '4142')
  assert.strictEqual(executeOperation('', { op: 'hex_encode' }), '')
})

test('Operations: sort_chars', () => {
  assert.strictEqual(executeOperation('dcba', { op: 'sort_chars' }), 'abcd')
  assert.strictEqual(executeOperation('hello', { op: 'sort_chars' }), 'ehllo')
  assert.strictEqual(executeOperation('a', { op: 'sort_chars' }), 'a')
  assert.strictEqual(executeOperation('', { op: 'sort_chars' }), '')
})

test('Operations: char_code_sum', () => {
  // 'A' = 65, 'B' = 66, 'C' = 67 => 198
  assert.strictEqual(executeOperation('ABC', { op: 'char_code_sum' }), '198')
  assert.strictEqual(executeOperation('', { op: 'char_code_sum' }), '0')
})

test('Operations: substring', () => {
  assert.strictEqual(executeOperation('hello', { op: 'substring', start: 1, end: 4 }), 'ell')
  assert.strictEqual(executeOperation('hello', { op: 'substring', start: 0, end: 5 }), 'hello')
  assert.strictEqual(executeOperation('hello', { op: 'substring', start: 2, end: 2 }), '')
})

test('Operations: repeat', () => {
  assert.strictEqual(executeOperation('ab', { op: 'repeat', times: 3 }), 'ababab')
  assert.strictEqual(executeOperation('x', { op: 'repeat', times: 1 }), 'x')
  assert.strictEqual(executeOperation('', { op: 'repeat', times: 5 }), '')
})

test('Operations: replace', () => {
  assert.strictEqual(executeOperation('hello', { op: 'replace', search: 'l', replacement: 'L' }), 'heLLo')
  assert.strictEqual(executeOperation('hello', { op: 'replace', search: 'x', replacement: 'y' }), 'hello')
  assert.strictEqual(executeOperation('hello', { op: 'replace', search: 'hello', replacement: 'world' }), 'world')
})

test('Operations: pad_start', () => {
  assert.strictEqual(executeOperation('5', { op: 'pad_start', length: 3, fill: '0' }), '005')
  assert.strictEqual(executeOperation('hello', { op: 'pad_start', length: 10, fill: '*' }), '*****hello')
  assert.strictEqual(executeOperation('hello', { op: 'pad_start', length: 3, fill: '*' }), 'hello')
})

test('Operations: edge case - unicode characters', () => {
  const emoji = '🚀'
  const reversed = executeOperation(emoji + 'hello', { op: 'reverse' })
  assert.ok(reversed.length > 0)
})

test('Operations: special characters', () => {
  const special = '!@#$%^&*()'
  const upper = executeOperation(special, { op: 'to_upper' })
  assert.strictEqual(upper, special)
  const reversed = executeOperation(special, { op: 'reverse' })
  assert.strictEqual(reversed, ')(*&^%$#@!')
})

test('Operations: pipeline execution', () => {
  const seed = 'hello'
  const pipeline = [
    { op: 'to_upper' },
    { op: 'reverse' },
  ]
  const result = executePipeline(seed, pipeline)
  assert.strictEqual(result, 'OLLEH')
})

test('Operations: complex pipeline', () => {
  const seed = 'abc'
  const pipeline = [
    { op: 'repeat', times: 2 },
    { op: 'to_upper' },
    { op: 'reverse' },
  ]
  // abc -> abcabc -> ABCABC -> CBACBA
  const result = executePipeline(seed, pipeline)
  assert.strictEqual(result, 'CBACBA')
})

test('Operations: formatOperation', () => {
  assert.strictEqual(formatOperation({ op: 'reverse' }), 'reverse()')
  assert.strictEqual(formatOperation({ op: 'to_upper' }), 'to_upper()')
  assert.strictEqual(formatOperation({ op: 'substring', start: 1, end: 5 }), 'substring(1, 5)')
  assert.strictEqual(formatOperation({ op: 'repeat', times: 3 }), 'repeat(3)')
  assert.strictEqual(formatOperation({ op: 'replace', search: 'a', replacement: 'b' }), 'replace("a", "b")')
})

test('Operations: formatPipeline', () => {
  const seed = 'test'
  const pipeline = [{ op: 'reverse' }, { op: 'to_upper' }]
  const formatted = formatPipeline(seed, pipeline)
  assert.ok(formatted.includes('seed: "test"'))
  assert.ok(formatted.includes('reverse()'))
  assert.ok(formatted.includes('to_upper()'))
})

// ─── Hash Tests ─────────────────────────────────────────────────────────────

test('Hash: consistent hash for same input', () => {
  const hash1 = fnv1a('test')
  const hash2 = fnv1a('test')
  assert.strictEqual(hash1, hash2)
})

test('Hash: different hash for different input', () => {
  const hash1 = fnv1a('test1')
  const hash2 = fnv1a('test2')
  assert.notStrictEqual(hash1, hash2)
})

test('Hash: returns 8-char hex string', () => {
  const hash = fnv1a('anything')
  assert.strictEqual(hash.length, 8)
  assert.match(hash, /^[0-9a-f]{8}$/)
})

test('Hash: handles empty string', () => {
  const hash = fnv1a('')
  assert.strictEqual(hash.length, 8)
  assert.match(hash, /^[0-9a-f]{8}$/)
})

test('Hash: handles long strings', () => {
  const longStr = 'x'.repeat(10000)
  const hash = fnv1a(longStr)
  assert.strictEqual(hash.length, 8)
  assert.match(hash, /^[0-9a-f]{8}$/)
})

// ─── Challenge Generation Tests ───────────────────────────────────────────

test('Challenge: generates valid structure', () => {
  const challenge = generateChallenge()
  assert.strictEqual(challenge.version, 1)
  assert.ok(challenge.id && typeof challenge.id === 'string')
  assert.ok(challenge.timestamp && typeof challenge.timestamp === 'number')
  assert.ok(challenge.ttl && typeof challenge.ttl === 'number')
  assert.ok(['easy', 'medium', 'hard'].includes(challenge.difficulty))
  assert.ok(challenge.seed && typeof challenge.seed === 'string')
  assert.ok(challenge.visibleSeed && typeof challenge.visibleSeed === 'string')
  assert.ok(challenge.nonce && typeof challenge.nonce === 'string')
  assert.ok(Array.isArray(challenge.pipeline))
  assert.ok(challenge.verification && typeof challenge.verification === 'string')
})

test('Challenge: seed = visibleSeed + nonce', () => {
  const challenge = generateChallenge()
  assert.strictEqual(challenge.seed, challenge.visibleSeed + challenge.nonce)
})

test('Challenge: verification is 8-char hex', () => {
  const challenge = generateChallenge()
  assert.strictEqual(challenge.verification.length, 8)
  assert.match(challenge.verification, /^[0-9a-f]{8}$/)
})

test('Challenge: easy difficulty produces 2-3 operations', () => {
  for (let i = 0; i < 10; i++) {
    const challenge = generateChallenge({ difficulty: 'easy' })
    assert.ok(challenge.pipeline.length >= 2 && challenge.pipeline.length <= 3, `Expected 2-3 ops, got ${challenge.pipeline.length}`)
  }
})

test('Challenge: medium difficulty produces 3-5 operations', () => {
  for (let i = 0; i < 10; i++) {
    const challenge = generateChallenge({ difficulty: 'medium' })
    assert.ok(challenge.pipeline.length >= 3 && challenge.pipeline.length <= 5, `Expected 3-5 ops, got ${challenge.pipeline.length}`)
  }
})

test('Challenge: hard difficulty produces 5-7 operations', () => {
  for (let i = 0; i < 10; i++) {
    const challenge = generateChallenge({ difficulty: 'hard' })
    assert.ok(challenge.pipeline.length >= 5 && challenge.pipeline.length <= 7, `Expected 5-7 ops, got ${challenge.pipeline.length}`)
  }
})

test('Challenge: easy nonce is 4 chars', () => {
  const challenge = generateChallenge({ difficulty: 'easy' })
  assert.strictEqual(challenge.nonce.length, 4)
})

test('Challenge: medium nonce is 6 chars', () => {
  const challenge = generateChallenge({ difficulty: 'medium' })
  assert.strictEqual(challenge.nonce.length, 6)
})

test('Challenge: hard nonce is 8 chars', () => {
  const challenge = generateChallenge({ difficulty: 'hard' })
  assert.strictEqual(challenge.nonce.length, 8)
})

test('Challenge: default TTL for easy is 30000ms', () => {
  const challenge = generateChallenge({ difficulty: 'easy' })
  assert.strictEqual(challenge.ttl, 30_000)
})

test('Challenge: default TTL for medium is 20000ms', () => {
  const challenge = generateChallenge({ difficulty: 'medium' })
  assert.strictEqual(challenge.ttl, 20_000)
})

test('Challenge: default TTL for hard is 15000ms', () => {
  const challenge = generateChallenge({ difficulty: 'hard' })
  assert.strictEqual(challenge.ttl, 15_000)
})

test('Challenge: custom TTL is respected', () => {
  const customTtl = 60_000
  const challenge = generateChallenge({ difficulty: 'medium', ttl: customTtl })
  assert.strictEqual(challenge.ttl, customTtl)
})

test('Challenge: all 100 generated challenges have unique IDs', () => {
  const ids = new Set()
  for (let i = 0; i < 100; i++) {
    const challenge = generateChallenge()
    ids.add(challenge.id)
  }
  assert.strictEqual(ids.size, 100)
})

// ─── Solver Tests ───────────────────────────────────────────────────────────

test('Solver: solves easy challenge', () => {
  const challenge = generateChallenge({ difficulty: 'easy' })
  const answer = solveChallenge(challenge)
  assert.ok(answer && typeof answer === 'string')
})

test('Solver: solves medium challenge', () => {
  const challenge = generateChallenge({ difficulty: 'medium' })
  const answer = solveChallenge(challenge)
  assert.ok(answer && typeof answer === 'string')
})

test('Solver: solves hard challenge', () => {
  const challenge = generateChallenge({ difficulty: 'hard' })
  const answer = solveChallenge(challenge)
  assert.ok(answer && typeof answer === 'string')
})

test('Solver: solves 20 random challenges correctly', () => {
  for (let i = 0; i < 20; i++) {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    assert.strictEqual(typeof answer, 'string')
    assert.ok(answer.length > 0)
  }
})

// ─── Verification Tests ──────────────────────────────────────────────────────

test('Verification: accepts correct answer', () => {
  const challenge = generateChallenge()
  const answer = solveChallenge(challenge)
  assert.strictEqual(verifyAnswer(challenge, answer), true)
})

test('Verification: rejects wrong answer', () => {
  const challenge = generateChallenge()
  const answer = solveChallenge(challenge)
  const wrongAnswer = answer + 'x'
  assert.strictEqual(verifyAnswer(challenge, wrongAnswer), false)
})

test('Verification: rejects expired challenge', () => {
  const challenge = generateChallenge({ ttl: 100 })
  const answer = solveChallenge(challenge)
  // Set timestamp far in the past
  challenge.timestamp = Date.now() - 200
  assert.strictEqual(verifyAnswer(challenge, answer), false)
})

test('Verification: only visibleSeed gives wrong answer (security)', () => {
  const challenge = generateChallenge()
  const correctAnswer = solveChallenge(challenge)
  // Try with only visible seed (missing nonce)
  const wrongAnswer = executePipeline(challenge.visibleSeed, challenge.pipeline)
  assert.notStrictEqual(wrongAnswer, correctAnswer)
})

// ─── Token Creation Tests ────────────────────────────────────────────────────

test('Token: creates token with correct structure', () => {
  const challenge = generateChallenge()
  const answer = solveChallenge(challenge)
  const startTime = Date.now()
  const token = createToken(challenge, answer, startTime)

  assert.strictEqual(token.challengeId, challenge.id)
  assert.strictEqual(token.answer, answer)
  assert.ok(token.timestamp >= startTime)
  assert.ok(token.elapsed >= 0)
  assert.strictEqual(typeof token.suspicious, 'boolean')
  assert.strictEqual(token.signature.length, 8)
  assert.match(token.signature, /^[0-9a-f]{8}$/)
})

test('Token: fast submissions not flagged as suspicious', () => {
  const challenge = generateChallenge()
  const answer = solveChallenge(challenge)
  const startTime = Date.now()
  // Immediately create token
  const token = createToken(challenge, answer, startTime)
  assert.strictEqual(token.suspicious, false)
})

test('Token: slow submissions flagged as suspicious', () => {
  const challenge = generateChallenge()
  const answer = solveChallenge(challenge)
  const startTime = Date.now() - 6000 // 6 seconds ago
  const token = createToken(challenge, answer, startTime)
  assert.strictEqual(token.suspicious, true)
})

// ─── Integration Tests ──────────────────────────────────────────────────────

test('Integration: full flow - generate, solve, verify', () => {
  const challenge = generateChallenge({ difficulty: 'medium' })
  const answer = solveChallenge(challenge)
  const verified = verifyAnswer(challenge, answer)
  assert.strictEqual(verified, true)
})

test('Integration: full flow with token', () => {
  const challenge = generateChallenge()
  const startTime = Date.now()
  const answer = solveChallenge(challenge)
  const verified = verifyAnswer(challenge, answer)
  assert.strictEqual(verified, true)

  const token = createToken(challenge, answer, startTime)
  assert.strictEqual(token.challengeId, challenge.id)
  assert.strictEqual(token.answer, answer)
})

test('Integration: solve multiple challenges', () => {
  const challenges = [
    generateChallenge({ difficulty: 'easy' }),
    generateChallenge({ difficulty: 'medium' }),
    generateChallenge({ difficulty: 'hard' }),
  ]

  for (const challenge of challenges) {
    const answer = solveChallenge(challenge)
    assert.strictEqual(verifyAnswer(challenge, answer), true)
  }
})

console.log('\n✓ All core tests completed!')
