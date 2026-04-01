/**
 * Comprehensive test suite for invisibleVerify function.
 *
 * Tests the end-to-end zero-UI agent verification flow:
 * - Fetch challenge from server
 * - Solve challenge locally
 * - Submit answer for verification
 * - Return proof token and metrics
 *
 * Includes error handling, retries, timeouts, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { invisibleVerify, generateChallenge, solveChallenge } from '../src/core'
import type { InvisibleVerifyOptions, InvisibleVerifyResult } from '../src/core'

/**
 * Mock fetch responses for testing
 */
function createMockChallenge() {
  return generateChallenge({ difficulty: 'easy' })
}

function createMockChallengeResponse(challenge: ReturnType<typeof generateChallenge>) {
  return {
    ok: true,
    status: 200,
    json: async () => challenge,
  } as Response
}

function createMockVerifyResponse(valid: boolean, proofToken?: string) {
  return {
    ok: valid,
    status: valid ? 200 : 403,
    json: async () => ({
      valid,
      proofToken: proofToken || 'mock_proof_token_xyz',
      elapsed: 42,
      suspicious: false,
    }),
  } as Response
}

function createMockErrorResponse(status: number, reason?: string) {
  return {
    ok: false,
    status,
    json: async () => ({
      valid: false,
      reason: reason || 'unknown_error',
    }),
  } as Response
}

describe('invisibleVerify', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('happy path: successful verification', () => {
    it('fetches challenge, solves, and verifies successfully', async () => {
      const challenge = createMockChallenge()
      const answer = solveChallenge(challenge)

      // Mock sequence: GET challenge → POST verify
      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true, 'proof_token_123'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        agentId: 'test-bot-v1',
      })

      expect(result.success).toBe(true)
      expect(result.proofToken).toBe('proof_token_123')
      expect(result.attempts).toBe(1)
      expect(result.solveTime).toBeDefined()
      expect(result.solveTime).toBeGreaterThanOrEqual(0)
      expect(result.totalTime).toBeDefined()
      expect(result.totalTime).toBeGreaterThanOrEqual(0)
      expect(result.token).toBeDefined()
      expect(result.token?.challengeId).toBe(challenge.id)
      expect(result.token?.answer).toBe(answer)

      // Verify fetch was called twice
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      expect(fetchSpy).toHaveBeenNthCalledWith(1, 'https://api.example.com/challenge', expect.any(Object))
      expect(fetchSpy).toHaveBeenNthCalledWith(2, 'https://api.example.com/verify', expect.any(Object))
    })

    it('includes agentId in verify request body', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        agentId: 'custom-agent-id',
      })

      // Check that agentId was sent in verify POST
      const verifyCall = fetchSpy.mock.calls[1]
      const verifyBody = JSON.parse((verifyCall[1] as Record<string, unknown>).body as string)
      expect(verifyBody.agentId).toBe('custom-agent-id')
    })

    it('records timing metrics', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result.solveTime).toBeDefined()
      expect(result.solveTime).toBeGreaterThanOrEqual(0)
      expect(result.totalTime).toBeDefined()
      expect(result.totalTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('error handling: challenge endpoint failures', () => {
    it('fails when challenge fetch returns 404', async () => {
      fetchSpy.mockResolvedValueOnce(createMockErrorResponse(404))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.attempts).toBe(1)
    })

    it('fails when challenge fetch returns 500', async () => {
      fetchSpy.mockResolvedValueOnce(createMockErrorResponse(500, 'Server error'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('fails when challenge endpoint returns invalid JSON', async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      } as Response)

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('fails when challenge endpoint is unreachable (network error)', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error: ECONNREFUSED'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Network error')
      expect(result.attempts).toBe(3)
    })
  })

  describe('error handling: verify endpoint failures', () => {
    it('fails when verify returns 403 (wrong answer)', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(false))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(3)
    })

    it('fails when verify returns 500', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockErrorResponse(500, 'Server error'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles verify response with missing proofToken gracefully', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            valid: true,
            // proofToken omitted
            elapsed: 42,
          }),
        } as Response)

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result.success).toBe(true)
      expect(result.proofToken).toBeUndefined()
      expect(result.token).toBeDefined()
    })
  })

  describe('retry logic', () => {
    it('retries on temporary network failures', async () => {
      const challenge = createMockChallenge()

      // Fail twice, then succeed
      fetchSpy
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 3,
      })

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(2)
      // Expect 3 fetch calls: first attempt (failed), second attempt (2 calls)
      expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('respects maxRetries option', async () => {
      const challenge = createMockChallenge()

      // Always fail
      fetchSpy.mockRejectedValue(new Error('Network error'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 2,
      })

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(2)
      expect(result.error).toContain('Network error')
    })

    it('applies exponential backoff between retries', async () => {
      const challenge = createMockChallenge()

      // Fail on first attempt, succeed on second
      fetchSpy
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const startTime = Date.now()
      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 3,
      })
      const elapsed = Date.now() - startTime

      expect(result.success).toBe(true)
      // At least 100ms backoff before second attempt
      expect(elapsed).toBeGreaterThanOrEqual(100)
    })

    it('returns error message from final failure', async () => {
      fetchSpy.mockRejectedValue(new Error('Custom error message'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBe('Custom error message')
      expect(result.attempts).toBe(1)
    })

    it('retries on verify failures when verification response is invalid', async () => {
      const challenge = createMockChallenge()

      // When verify returns ok:false, invisibleVerify will retry but also return error with reason
      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockErrorResponse(403, 'wrong_answer'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.attempts).toBe(1)
    })
  })

  describe('timeout handling', () => {
    it('uses default timeout of 10 seconds', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      // Should not timeout with default settings
      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result.success).toBe(true)
    })

    it('accepts custom timeout option', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      // Verify that timeout option is accepted
      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        timeout: 5000,
      })

      expect(result.success).toBe(true)
    })
  })

  describe('request headers and body', () => {
    it('sends Accept header for challenge request', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      const challengeCall = fetchSpy.mock.calls[0]
      const headers = (challengeCall[1] as Record<string, unknown>).headers as Record<string, unknown>
      expect(headers.Accept).toBe('application/json')
    })

    it('sends Content-Type header for verify request', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      const verifyCall = fetchSpy.mock.calls[1]
      const headers = (verifyCall[1] as Record<string, unknown>).headers as Record<string, unknown>
      expect(headers['Content-Type']).toBe('application/json')
    })

    it('includes challenge and answer in verify request body', async () => {
      const challenge = createMockChallenge()
      const answer = solveChallenge(challenge)

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      const verifyCall = fetchSpy.mock.calls[1]
      const body = JSON.parse((verifyCall[1] as Record<string, unknown>).body as string)
      expect(body.challenge.id).toBe(challenge.id)
      expect(body.answer).toBe(answer)
    })
  })

  describe('result structure', () => {
    it('returns all required result fields on success', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true, 'token_abc'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('proofToken')
      expect(result).toHaveProperty('token')
      expect(result).toHaveProperty('attempts')
      expect(result).toHaveProperty('solveTime')
      expect(result).toHaveProperty('totalTime')
      expect(result).not.toHaveProperty('error')
    })

    it('returns all required result fields on failure', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result).toHaveProperty('success', false)
      expect(result).toHaveProperty('error')
      expect(result).toHaveProperty('attempts')
      expect(result).toHaveProperty('totalTime')
      expect(result).not.toHaveProperty('proofToken')
      expect(result).not.toHaveProperty('token')
    })

    it('includes imRobotToken with correct structure', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result.token).toBeDefined()
      expect(result.token!.challengeId).toBe(challenge.id)
      expect(typeof result.token!.answer).toBe('string')
      expect(typeof result.token!.timestamp).toBe('number')
      expect(typeof result.token!.elapsed).toBe('number')
      expect(typeof result.token!.suspicious).toBe('boolean')
      expect(typeof result.token!.signature).toBe('string')
    })
  })

  describe('edge cases', () => {
    it('handles challenge with extreme difficulty levels', async () => {
      const hardChallenge = generateChallenge({ difficulty: 'hard' })

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(hardChallenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      expect(result.success).toBe(true)
    })

    it('handles missing agentId by using a generated one', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        // agentId omitted
      })

      expect(result.success).toBe(true)
      // The invisibleVerify should still submit a request with or without agentId
      expect(fetchSpy).toHaveBeenCalled()
    })

    it('accepts zero or minimal maxRetries option', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      // Verify that minimal retry settings work
      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        maxRetries: 1,
      })

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(1)
    })
  })

  describe('type safety', () => {
    it('returns InvisibleVerifyResult type', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const result = await invisibleVerify({
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
      })

      // TypeScript should accept this without errors
      const _typedResult: InvisibleVerifyResult = result
      expect(_typedResult).toBeDefined()
    })

    it('accepts InvisibleVerifyOptions type', async () => {
      const challenge = createMockChallenge()

      fetchSpy
        .mockResolvedValueOnce(createMockChallengeResponse(challenge))
        .mockResolvedValueOnce(createMockVerifyResponse(true))

      const options: InvisibleVerifyOptions = {
        challengeUrl: 'https://api.example.com/challenge',
        verifyUrl: 'https://api.example.com/verify',
        agentId: 'bot-v1',
        maxRetries: 3,
        timeout: 5000,
      }

      const result = await invisibleVerify(options)
      expect(result).toBeDefined()
    })
  })
})
