import { describe, it, expect, vi, afterEach } from 'vitest'
import { executeOperation } from '../src/core/operations'
import { verifyAnswer, assertServerSideOnly, generateChallenge } from '../src/core/challenge'
import { solveChallenge } from '../src/core/solver'

// ── sha256_hash deprecation warning ──────────────────────────────────────────

describe('sha256_hash deprecation warning', () => {
  afterEach(() => {
    // Reset the module-level flag between tests by re-importing fresh.
    // We spy on console.warn to capture the one-time warning.
    vi.restoreAllMocks()
  })

  it('emits a console.warn on first use of sha256_hash operation', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Execute the operation for the first time in this test run
    executeOperation('hello', { op: 'sha256_hash' })

    // The warning must have been emitted
    expect(warnSpy).toHaveBeenCalledOnce()
    const warnArg = warnSpy.mock.calls[0][0] as string
    expect(warnArg).toContain('[im_robot]')
    expect(warnArg).toContain('sha256_hash')
    expect(warnArg).toContain('deprecated')
  })

  it('still produces correct output after the deprecation warning', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = executeOperation('test', { op: 'sha256_hash' })
    // syncHash256 produces 64-char hex (8 x 8-char FNV-1a results)
    expect(result).toHaveLength(64)
    expect(result).toMatch(/^[0-9a-f]+$/)
  })
})

// ── assertServerSideOnly guard ────────────────────────────────────────────────

describe('assertServerSideOnly', () => {
  it('throws an error when called in a Node.js environment', () => {
    // In the test runner (Node.js), this should throw
    expect(() => assertServerSideOnly()).toThrow('[im_robot]')
    expect(() => assertServerSideOnly()).toThrow('verifyAnswer()')
  })

  it('includes the custom context in the error message when provided', () => {
    expect(() => assertServerSideOnly('myRoute()')).toThrow('myRoute()')
  })

  it('error message references imrobot/server and ImRobotVerifier', () => {
    expect(() => assertServerSideOnly()).toThrow('ImRobotVerifier')
    expect(() => assertServerSideOnly()).toThrow('imrobot/server')
  })
})

// ── verifyAnswer still works correctly on the client side ────────────────────

describe('verifyAnswer (client-side correctness)', () => {
  it('returns true for a correct answer', () => {
    const challenge = generateChallenge({ difficulty: 'easy' })
    const answer = solveChallenge(challenge)
    expect(verifyAnswer(challenge, answer)).toBe(true)
  })

  it('returns false for a wrong answer', () => {
    const challenge = generateChallenge({ difficulty: 'easy' })
    expect(verifyAnswer(challenge, 'completely_wrong')).toBe(false)
  })

  it('returns false for an expired challenge', () => {
    const challenge = generateChallenge({ difficulty: 'easy', ttl: 1 })
    // Wait 5ms so it expires
    const expired = { ...challenge, timestamp: Date.now() - 1000 }
    const answer = solveChallenge(challenge)
    expect(verifyAnswer(expired, answer)).toBe(false)
  })
})
