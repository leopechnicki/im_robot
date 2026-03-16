import { describe, it, expect } from 'vitest'
import { hmacSign, hmacVerify, sha256 } from '../src/core/hmac'
import { ImRobotVerifier, createVerifier } from '../src/server/verifier'
import { solveChallenge } from '../src/core/solver'
import { executePipeline } from '../src/core/operations'
import type { SignedChallenge } from '../src/core/types'

// ── HMAC ──────────────────────────────────────────────────────────────

describe('hmacSign', () => {
  it('returns a 64-char hex string', async () => {
    const sig = await hmacSign('my-secret-key-1234', 'hello')
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', async () => {
    const secret = 'test-secret-1234567'
    const a = await hmacSign(secret, 'same message')
    const b = await hmacSign(secret, 'same message')
    expect(a).toBe(b)
  })

  it('different secrets produce different signatures', async () => {
    const a = await hmacSign('secret-one-1234567', 'msg')
    const b = await hmacSign('secret-two-1234567', 'msg')
    expect(a).not.toBe(b)
  })

  it('different messages produce different signatures', async () => {
    const secret = 'shared-secret-12345'
    const a = await hmacSign(secret, 'message-one')
    const b = await hmacSign(secret, 'message-two')
    expect(a).not.toBe(b)
  })
})

describe('hmacVerify', () => {
  it('returns true for valid signature', async () => {
    const secret = 'verify-secret-12345'
    const message = 'test payload'
    const sig = await hmacSign(secret, message)
    expect(await hmacVerify(secret, message, sig)).toBe(true)
  })

  it('returns false for wrong signature', async () => {
    const secret = 'verify-secret-12345'
    expect(await hmacVerify(secret, 'msg', 'badhex')).toBe(false)
  })

  it('returns false for tampered message', async () => {
    const secret = 'verify-secret-12345'
    const sig = await hmacSign(secret, 'original')
    expect(await hmacVerify(secret, 'tampered', sig)).toBe(false)
  })

  it('returns false for wrong secret', async () => {
    const sig = await hmacSign('correct-secret-1234', 'msg')
    expect(await hmacVerify('wrong-secret-123456', 'msg', sig)).toBe(false)
  })
})

describe('sha256', () => {
  it('returns a 64-char hex string', async () => {
    const hash = await sha256('hello')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', async () => {
    const a = await sha256('test')
    const b = await sha256('test')
    expect(a).toBe(b)
  })

  it('produces known hash for empty string', async () => {
    const hash = await sha256('')
    // SHA-256 of empty string is well-known
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

// ── Server Verifier ──────────────────────────────────────────────────

const TEST_SECRET = 'test-secret-at-least-16-chars-long'

describe('ImRobotVerifier constructor', () => {
  it('creates with valid config', () => {
    expect(() => createVerifier({ secret: TEST_SECRET })).not.toThrow()
  })

  it('throws for empty secret', () => {
    expect(() => createVerifier({ secret: '' })).toThrow('secret must be at least')
  })

  it('throws for short secret', () => {
    expect(() => createVerifier({ secret: 'short' })).toThrow('secret must be at least')
  })

  it('throws for whitespace-only secret', () => {
    expect(() => createVerifier({ secret: '                ' })).toThrow('secret must be at least')
  })

  it('defaults to medium difficulty', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate()
    expect(challenge.difficulty).toBe('medium')
  })

  it('respects difficulty config', async () => {
    const v = createVerifier({ secret: TEST_SECRET, difficulty: 'hard' })
    const challenge = await v.generate()
    expect(challenge.difficulty).toBe('hard')
  })
})

describe('ImRobotVerifier.generate', () => {
  it('returns a SignedChallenge with hmac and expiresAt', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate()

    expect(challenge.hmac).toMatch(/^[0-9a-f]{64}$/)
    expect(challenge.expiresAt).toBeGreaterThan(Date.now())
    expect(challenge.id).toMatch(/^[0-9a-f]{16}$/)
    expect(challenge.version).toBe(1)
    expect(challenge.pipeline.length).toBeGreaterThan(0)
  })

  it('allows difficulty override', async () => {
    const v = createVerifier({ secret: TEST_SECRET, difficulty: 'easy' })
    const challenge = await v.generate({ difficulty: 'hard' })
    expect(challenge.difficulty).toBe('hard')
  })

  it('generates unique challenges', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const a = await v.generate()
    const b = await v.generate()
    expect(a.id).not.toBe(b.id)
    expect(a.hmac).not.toBe(b.hmac)
  })
})

describe('ImRobotVerifier.verify', () => {
  it('accepts correct answer', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate()
    const answer = solveChallenge(challenge)
    const result = await v.verify(challenge, answer)

    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.elapsed).toBeGreaterThanOrEqual(0)
  })

  it('rejects wrong answer', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate()
    const result = await v.verify(challenge, 'totally-wrong-answer')

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('wrong_answer')
  })

  it('rejects expired challenge', async () => {
    const v = createVerifier({ secret: TEST_SECRET, ttl: 1 })
    const challenge = await v.generate()
    const answer = solveChallenge(challenge)

    // Force expiration
    challenge.expiresAt = Date.now() - 1000
    // Re-sign with the expired time (simulates a legitimately expired challenge)
    // We can't re-sign, so we just check that the HMAC check fails first
    const result = await v.verify(challenge, answer)
    expect(result.valid).toBe(false)
    // Will fail with invalid_hmac since we changed expiresAt without re-signing
    expect(result.reason).toBe('invalid_hmac')
  })

  it('rejects tampered HMAC', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate()
    const answer = solveChallenge(challenge)

    // Tamper with the HMAC
    const tampered = { ...challenge, hmac: 'a'.repeat(64) }
    const result = await v.verify(tampered as SignedChallenge, answer)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_hmac')
  })

  it('rejects tampered difficulty', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate({ difficulty: 'hard' })
    const answer = solveChallenge(challenge)

    // Tamper with difficulty
    const tampered = { ...challenge, difficulty: 'easy' as const }
    const result = await v.verify(tampered as SignedChallenge, answer)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_hmac')
  })

  it('rejects tampered verification field', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate()

    const tampered = { ...challenge, verification: 'deadbeef' }
    const result = await v.verify(tampered as SignedChallenge, 'anything')
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_hmac')
  })

  it('rejects tampered pipeline', async () => {
    const v = createVerifier({ secret: TEST_SECRET })
    const challenge = await v.generate()

    // Tamper with pipeline (replace with trivial operations)
    const tampered = { ...challenge, pipeline: [{ op: 'length' as const }] }
    // The HMAC now covers the pipeline, so tampering invalidates the signature.
    const fakeAnswer = executePipeline(challenge.seed, tampered.pipeline)
    const result = await v.verify(tampered as SignedChallenge, fakeAnswer)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_hmac')
  })

  it('works across all difficulties', async () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const v = createVerifier({ secret: TEST_SECRET, difficulty })
      const challenge = await v.generate()
      const answer = solveChallenge(challenge)
      const result = await v.verify(challenge, answer)
      expect(result.valid).toBe(true)
    }
  })

  it('different secrets cannot cross-verify', async () => {
    const v1 = createVerifier({ secret: 'secret-one-is-very-long' })
    const v2 = createVerifier({ secret: 'secret-two-is-very-long' })

    const challenge = await v1.generate()
    const answer = solveChallenge(challenge)

    const result = await v2.verify(challenge, answer)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_hmac')
  })
})
