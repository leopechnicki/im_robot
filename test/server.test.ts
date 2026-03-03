import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'

// We test the API by importing and exercising the route logic directly,
// since the server module starts listening on import.
// Instead, we replicate the core logic tests against the API contract.

import { generateChallenge, verifyAnswer, createToken } from '../src/core/challenge'
import { solveChallenge } from '../src/core/solver'
import type { Challenge } from '../src/core/types'

/**
 * Integration-style tests that validate the API contract:
 * 1. Generate challenge → solve → verify flow
 * 2. Invalid inputs
 * 3. Expired challenges
 */

describe('API contract: challenge → solve → verify flow', () => {
  it('full flow: generate, solve, verify', () => {
    // Step 1: Generate
    const challenge = generateChallenge({ difficulty: 'medium' })
    expect(challenge.id).toBeDefined()
    expect(challenge.seed).toBe(challenge.visibleSeed + challenge.nonce)
    expect(challenge.pipeline.length).toBeGreaterThanOrEqual(3)

    // Step 2: Solve
    const answer = solveChallenge(challenge)
    expect(typeof answer).toBe('string')
    expect(answer.length).toBeGreaterThan(0)

    // Step 3: Verify
    const valid = verifyAnswer(challenge, answer)
    expect(valid).toBe(true)

    // Step 4: Create token
    const token = createToken(challenge, answer, Date.now() - 200)
    expect(token.challengeId).toBe(challenge.id)
    expect(token.suspicious).toBe(false)
    expect(token.signature).toMatch(/^[0-9a-f]{8}$/)
  })

  it('rejects wrong answer', () => {
    const challenge = generateChallenge()
    expect(verifyAnswer(challenge, 'definitely-wrong')).toBe(false)
  })

  it('rejects expired challenge', () => {
    const challenge = generateChallenge({ ttl: 1 })
    const answer = solveChallenge(challenge)
    challenge.timestamp = Date.now() - 5000
    expect(verifyAnswer(challenge, answer)).toBe(false)
  })

  it('works across all difficulty levels', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const challenge = generateChallenge({ difficulty })
      const answer = solveChallenge(challenge)
      expect(verifyAnswer(challenge, answer)).toBe(true)
    }
  })

  it('challenge includes all required API response fields', () => {
    const challenge = generateChallenge()
    // These are the fields the API returns
    expect(challenge).toHaveProperty('version', 1)
    expect(challenge).toHaveProperty('id')
    expect(challenge).toHaveProperty('timestamp')
    expect(challenge).toHaveProperty('ttl')
    expect(challenge).toHaveProperty('difficulty')
    expect(challenge).toHaveProperty('seed')
    expect(challenge).toHaveProperty('visibleSeed')
    expect(challenge).toHaveProperty('nonce')
    expect(challenge).toHaveProperty('pipeline')
    expect(challenge).toHaveProperty('verification')
  })
})

describe('API contract: input validation', () => {
  it('difficulty defaults to medium when not specified', () => {
    const challenge = generateChallenge()
    expect(challenge.difficulty).toBe('medium')
  })

  it('custom ttl is respected', () => {
    const challenge = generateChallenge({ ttl: 99999 })
    expect(challenge.ttl).toBe(99999)
  })

  it('generates unique challenge IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(generateChallenge().id)
    }
    expect(ids.size).toBe(100)
  })
})
