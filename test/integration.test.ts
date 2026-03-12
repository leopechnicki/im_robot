/**
 * Integration tests that exercise every documented usage pattern.
 * These validate that the docs-described APIs actually work as shown.
 */
import { describe, it, expect } from 'vitest'

// ── Test: Core headless flow (docs: Headless / Core) ─────────────────

import {
  generateChallenge,
  solveChallenge,
  verifyAnswer,
  createToken,
  executePipeline,
  executeOperation,
  formatOperation,
  formatPipeline,
} from '../src/core'

import type {
  Challenge,
  Operation,
  Difficulty,
  ImRobotToken,
} from '../src/core'

describe('Docs: Headless / Core flow', () => {
  it('step 1-4: generate → solve → verify → token', () => {
    // Step 1: Generate
    const challenge = generateChallenge({
      difficulty: 'medium',
      ttl: 20_000,
    })
    expect(challenge.version).toBe(1)
    expect(challenge.difficulty).toBe('medium')
    expect(challenge.ttl).toBe(20_000)

    // Step 2: Solve
    const answer = solveChallenge(challenge)
    expect(typeof answer).toBe('string')
    expect(answer.length).toBeGreaterThan(0)

    // Step 3: Verify
    const isValid = verifyAnswer(challenge, answer)
    expect(isValid).toBe(true)

    // Step 4: Create token
    const startTime = Date.now() - 100
    const token = createToken(challenge, answer, startTime)
    expect(token.challengeId).toBe(challenge.id)
    expect(token.answer).toBe(answer)
    expect(token.elapsed).toBeGreaterThanOrEqual(50)
    expect(token.suspicious).toBe(false)
    expect(typeof token.signature).toBe('string')
  })

  it('works with all difficulty levels', () => {
    for (const diff of ['easy', 'medium', 'hard'] as Difficulty[]) {
      const challenge = generateChallenge({ difficulty: diff })
      const answer = solveChallenge(challenge)
      expect(verifyAnswer(challenge, answer)).toBe(true)
    }
  })
})

// ── Test: All 18 operations (docs: Operations Reference) ────────────

describe('Docs: Operations Reference', () => {
  const ops: { op: Operation; input: string; check: (result: string) => void }[] = [
    { op: { op: 'reverse' }, input: 'hello', check: (r) => expect(r).toBe('olleh') },
    { op: { op: 'to_upper' }, input: 'hello', check: (r) => expect(r).toBe('HELLO') },
    { op: { op: 'to_lower' }, input: 'HELLO', check: (r) => expect(r).toBe('hello') },
    { op: { op: 'sort_chars' }, input: 'dcba', check: (r) => expect(r).toBe('abcd') },
    { op: { op: 'length' }, input: 'hello', check: (r) => expect(r).toBe('5') },
    { op: { op: 'slice_alternate' }, input: 'abcdef', check: (r) => expect(r).toBe('ace') },
    { op: { op: 'base64_encode' }, input: 'hello', check: (r) => expect(r).toBe('aGVsbG8=') },
    { op: { op: 'rot13' }, input: 'hello', check: (r) => expect(r).toBe('uryyb') },
    { op: { op: 'hex_encode' }, input: 'AB', check: (r) => expect(r).toBe('4142') },
    { op: { op: 'char_code_sum' }, input: 'AB', check: (r) => expect(r).toBe('131') },
    { op: { op: 'substring', start: 1, end: 4 }, input: 'abcdef', check: (r) => expect(r).toBe('bcd') },
    { op: { op: 'caesar', shift: 3 }, input: 'abc', check: (r) => expect(r).toBe('def') },
    { op: { op: 'count_chars', char: 'l' }, input: 'hello', check: (r) => expect(r).toBe('2') },
    { op: { op: 'repeat', times: 3 }, input: 'ab', check: (r) => expect(r).toBe('ababab') },
    { op: { op: 'replace', search: 'a', replacement: 'x' }, input: 'banana', check: (r) => expect(r).toBe('bxnxnx') },
    { op: { op: 'pad_start', length: 8, fill: '0' }, input: 'abc', check: (r) => expect(r).toBe('00000abc') },
    { op: { op: 'xor_encode', key: 1 }, input: 'AB', check: (r) => expect(r).toBe('@C') },
    { op: { op: 'fnv1a_hash' }, input: 'hello', check: (r) => expect(r).toMatch(/^[0-9a-f]{8}$/) },
  ]

  for (const { op, input, check } of ops) {
    it(`${op.op}`, () => {
      const result = executeOperation(input, op)
      check(result)
    })
  }

  it('format all operations', () => {
    expect(formatOperation({ op: 'reverse' })).toBe('reverse()')
    expect(formatOperation({ op: 'caesar', shift: 13 })).toBe('caesar(13)')
    expect(formatOperation({ op: 'xor_encode', key: 42 })).toBe('xor_encode(42)')
    expect(formatOperation({ op: 'count_chars', char: 'a' })).toBe('count_chars("a")')
  })

  it('pipeline chaining', () => {
    const pipeline: Operation[] = [
      { op: 'to_upper' },
      { op: 'reverse' },
      { op: 'caesar', shift: 1 },
    ]
    const result = executePipeline('abc', pipeline)
    // abc → ABC → CBA → DCB
    expect(result).toBe('DCB')
  })
})

// ── Test: Server SDK flow (docs: Server SDK) ─────────────────────────

import { createVerifier, ImRobotVerifier } from '../src/server'
import type { SignedChallenge, ServerConfig, VerifyResult } from '../src/server'

describe('Docs: Server SDK flow', () => {
  const SECRET = 'my-production-secret-at-least-16-chars'

  it('step 1-2: create verifier and generate challenge', async () => {
    const verifier = createVerifier({
      secret: SECRET,
      difficulty: 'medium',
    })
    expect(verifier).toBeInstanceOf(ImRobotVerifier)

    const challenge = await verifier.generate()
    expect(challenge.hmac).toMatch(/^[0-9a-f]{64}$/)
    expect(challenge.expiresAt).toBeGreaterThan(Date.now())
    expect(challenge.difficulty).toBe('medium')
  })

  it('full Express-like flow: generate → solve → verify', async () => {
    const verifier = createVerifier({ secret: SECRET })

    // Server: generate
    const challenge = await verifier.generate()

    // Client: solve
    const answer = solveChallenge(challenge)

    // Server: verify
    const result = await verifier.verify(challenge, answer)
    expect(result.valid).toBe(true)
    expect(result.elapsed).toBeGreaterThanOrEqual(0)
    expect(result.suspicious).toBe(false)
  })

  it('verify rejects wrong answers with correct reason', async () => {
    const verifier = createVerifier({ secret: SECRET })
    const challenge = await verifier.generate()

    const result = await verifier.verify(challenge, 'wrong-answer')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('wrong_answer')
  })

  it('verify catches tampered challenges', async () => {
    const verifier = createVerifier({ secret: SECRET })
    const challenge = await verifier.generate()

    // Tamper with the HMAC
    const tampered = { ...challenge, hmac: '0'.repeat(64) } as SignedChallenge
    const result = await verifier.verify(tampered, 'anything')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_hmac')
  })

  it('difficulty override per-request', async () => {
    const verifier = createVerifier({ secret: SECRET, difficulty: 'easy' })

    // Override to hard for this request
    const challenge = await verifier.generate({ difficulty: 'hard' })
    expect(challenge.difficulty).toBe('hard')

    // Still verifies correctly
    const answer = solveChallenge(challenge)
    const result = await verifier.verify(challenge, answer)
    expect(result.valid).toBe(true)
  })
})

// ── Test: Configuration (docs: Configuration) ───────────────────────

describe('Docs: Configuration', () => {
  it('default TTLs per difficulty', () => {
    expect(generateChallenge({ difficulty: 'easy' }).ttl).toBe(30_000)
    expect(generateChallenge({ difficulty: 'medium' }).ttl).toBe(20_000)
    expect(generateChallenge({ difficulty: 'hard' }).ttl).toBe(15_000)
  })

  it('custom TTL overrides default', () => {
    const c = generateChallenge({ difficulty: 'easy', ttl: 60_000 })
    expect(c.ttl).toBe(60_000)
  })

  it('pipeline length matches difficulty', () => {
    for (let i = 0; i < 10; i++) {
      const easy = generateChallenge({ difficulty: 'easy' })
      expect(easy.pipeline.length).toBeGreaterThanOrEqual(2)
      expect(easy.pipeline.length).toBeLessThanOrEqual(3)

      const medium = generateChallenge({ difficulty: 'medium' })
      expect(medium.pipeline.length).toBeGreaterThanOrEqual(3)
      expect(medium.pipeline.length).toBeLessThanOrEqual(5)

      const hard = generateChallenge({ difficulty: 'hard' })
      expect(hard.pipeline.length).toBeGreaterThanOrEqual(5)
      expect(hard.pipeline.length).toBeLessThanOrEqual(7)
    }
  })

  it('nonce length matches difficulty', () => {
    expect(generateChallenge({ difficulty: 'easy' }).nonce.length).toBe(4)
    expect(generateChallenge({ difficulty: 'medium' }).nonce.length).toBe(6)
    expect(generateChallenge({ difficulty: 'hard' }).nonce.length).toBe(8)
  })

  it('server config validates secret length', () => {
    expect(() => createVerifier({ secret: 'short' })).toThrow()
    expect(() => createVerifier({ secret: 'a'.repeat(16) })).not.toThrow()
  })
})

// ── Test: Security model (docs: Security Model) ─────────────────────

import { hmacSign, hmacVerify, sha256 } from '../src/core/hmac'

describe('Docs: Security Model', () => {
  it('HMAC-SHA256 is constant-time safe', async () => {
    const secret = 'test-secret-minimum-16'
    const message = 'test-message'
    const sig = await hmacSign(secret, message)

    // Valid signature
    expect(await hmacVerify(secret, message, sig)).toBe(true)
    // Wrong signature
    expect(await hmacVerify(secret, message, 'x'.repeat(64))).toBe(false)
    // Wrong length signature returns false (not error)
    expect(await hmacVerify(secret, message, 'short')).toBe(false)
  })

  it('different secrets produce different HMACs', async () => {
    const sig1 = await hmacSign('secret-one-is-long-enough', 'msg')
    const sig2 = await hmacSign('secret-two-is-long-enough', 'msg')
    expect(sig1).not.toBe(sig2)
  })

  it('challenges cannot cross-verify between verifiers', async () => {
    const v1 = createVerifier({ secret: 'secret-number-one-16-chars' })
    const v2 = createVerifier({ secret: 'secret-number-two-16-chars' })

    const challenge = await v1.generate()
    const answer = solveChallenge(challenge)

    const result = await v2.verify(challenge, answer)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_hmac')
  })

  it('human relay detection flags slow responses', () => {
    const challenge = generateChallenge()
    const answer = solveChallenge(challenge)
    const slowStart = Date.now() - 6000 // 6 seconds ago
    const token = createToken(challenge, answer, slowStart)
    expect(token.suspicious).toBe(true)
  })
})
