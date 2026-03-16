import type { Challenge, ImRobotToken } from './types'
import { solveChallenge } from './solver'
import { createToken } from './challenge'

export interface InvisibleVerifyOptions {
  /** URL of the challenge endpoint (e.g., 'https://api.example.com/imrobot/challenge') */
  challengeUrl: string
  /** URL of the verify endpoint (e.g., 'https://api.example.com/imrobot/verify') */
  verifyUrl: string
  /** Agent identifier */
  agentId?: string
  /** Number of retry attempts (default: 3) */
  maxRetries?: number
  /** Timeout per request in ms (default: 10000) */
  timeout?: number
}

export interface InvisibleVerifyResult {
  /** Whether verification succeeded */
  success: boolean
  /** The proof token (if successful) */
  proofToken?: string
  /** The imrobot token (if successful) */
  token?: ImRobotToken
  /** Error message (if failed) */
  error?: string
  /** Number of attempts made */
  attempts: number
  /** Time taken to solve the challenge in ms */
  solveTime?: number
  /** Total time taken in ms */
  totalTime: number
}

/**
 * Invisible (zero-UI) agent verification.
 *
 * Fetches a challenge from the server, solves it locally, submits the answer,
 * and returns a proof token. No user interaction required.
 *
 * @example
 * ```typescript
 * import { invisibleVerify } from 'imrobot/core'
 *
 * const result = await invisibleVerify({
 *   challengeUrl: 'https://api.example.com/imrobot/challenge',
 *   verifyUrl: 'https://api.example.com/imrobot/verify',
 * })
 *
 * if (result.success) {
 *   // Use result.proofToken in X-Agent-Proof header
 *   fetch('/api/data', {
 *     headers: { 'X-Agent-Proof': result.proofToken! }
 *   })
 * }
 * ```
 */
export async function invisibleVerify(
  options: InvisibleVerifyOptions,
): Promise<InvisibleVerifyResult> {
  const maxRetries = options.maxRetries ?? 3
  const timeout = options.timeout ?? 10_000
  const startTime = Date.now()
  let attempts = 0

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    attempts++
    try {
      // 1. Fetch challenge
      const challengeResponse = await fetchWithTimeout(
        options.challengeUrl,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        timeout,
      )

      if (!challengeResponse.ok) {
        throw new Error(`Challenge request failed: ${challengeResponse.status}`)
      }

      const challenge: Challenge = await challengeResponse.json()

      // 2. Solve locally
      const solveStart = Date.now()
      const answer = solveChallenge(challenge)
      const solveTime = Date.now() - solveStart

      // 3. Submit answer
      const verifyResponse = await fetchWithTimeout(
        options.verifyUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challenge,
            answer,
            agentId: options.agentId,
          }),
        },
        timeout,
      )

      if (!verifyResponse.ok) {
        const errorBody = await verifyResponse.json().catch(() => ({}))
        throw new Error(
          `Verify failed: ${(errorBody as Record<string, string>).reason ?? verifyResponse.status}`,
        )
      }

      const result = (await verifyResponse.json()) as {
        valid: boolean
        proofToken?: string
        elapsed?: number
        suspicious?: boolean
      }

      if (result.valid) {
        const token = createToken(challenge, answer, solveStart)
        return {
          success: true,
          proofToken: result.proofToken,
          token,
          attempts,
          solveTime,
          totalTime: Date.now() - startTime,
        }
      }

      // If not valid, retry
    } catch (error) {
      // Retry on network errors
      if (attempt === maxRetries - 1) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          attempts,
          totalTime: Date.now() - startTime,
        }
      }
      // Exponential backoff: 100ms, 200ms, 400ms...
      await sleep(100 * Math.pow(2, attempt))
    }
  }

  return {
    success: false,
    error: 'Max retries exceeded',
    attempts,
    totalTime: Date.now() - startTime,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
