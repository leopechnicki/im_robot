import type { SignedChallenge, ServerConfig, Difficulty, VerifyResult } from '../core/types'
import { SUSPICIOUS_THRESHOLD_MS } from '../core/types'
import { generateChallenge } from '../core/challenge'
import { executePipeline } from '../core/operations'
import { hmacSign, hmacVerify } from '../core/hmac'

/**
 * Server-side challenge verifier with HMAC-SHA256 signing.
 *
 * Provides stateless, tamper-proof challenge generation and verification.
 * No database required — the HMAC signature ensures integrity.
 *
 * @example
 * ```typescript
 * import { createVerifier } from 'imrobot/server'
 *
 * const verifier = createVerifier({ secret: process.env.IMROBOT_SECRET! })
 *
 * // Generate a signed challenge (send to client)
 * const challenge = await verifier.generate()
 *
 * // Verify agent's answer (stateless — no DB lookup)
 * const result = await verifier.verify(challenge, agentAnswer)
 * if (result.valid) {
 *   // Agent is verified
 * }
 * ```
 */
export class ImRobotVerifier {
  private readonly secret: string
  private readonly difficulty: Difficulty
  private readonly ttl?: number

  constructor(config: ServerConfig) {
    if (!config.secret || config.secret.length < 16) {
      throw new Error('ImRobotVerifier: secret must be at least 16 characters')
    }
    this.secret = config.secret
    this.difficulty = config.difficulty ?? 'medium'
    this.ttl = config.ttl
  }

  /**
   * Build the message string that gets HMAC-signed.
   * Includes all critical fields to prevent any tampering.
   */
  private buildSignatureMessage(
    id: string,
    verification: string,
    expiresAt: number,
    difficulty: Difficulty,
  ): string {
    return `${id}:${verification}:${expiresAt}:${difficulty}`
  }

  /**
   * Generate a signed challenge.
   * The challenge includes an HMAC signature that prevents tampering.
   * Send the entire SignedChallenge to the client agent.
   */
  async generate(overrides?: {
    difficulty?: Difficulty
    ttl?: number
  }): Promise<SignedChallenge> {
    const difficulty = overrides?.difficulty ?? this.difficulty
    const ttl = overrides?.ttl ?? this.ttl

    const challenge = generateChallenge({ difficulty, ttl })
    const expiresAt = challenge.timestamp + challenge.ttl

    const message = this.buildSignatureMessage(
      challenge.id,
      challenge.verification,
      expiresAt,
      challenge.difficulty,
    )
    const hmac = await hmacSign(this.secret, message)

    return {
      ...challenge,
      hmac,
      expiresAt,
    }
  }

  /**
   * Verify an agent's answer against a signed challenge.
   *
   * Checks in order:
   * 1. HMAC signature validity (challenge not tampered)
   * 2. Expiration (challenge not expired)
   * 3. Answer correctness
   *
   * Returns a VerifyResult with `valid` boolean and failure `reason`.
   */
  async verify(
    challenge: SignedChallenge,
    answer: string,
  ): Promise<VerifyResult> {
    // 1. Verify HMAC — ensures the challenge hasn't been tampered with
    const message = this.buildSignatureMessage(
      challenge.id,
      challenge.verification,
      challenge.expiresAt,
      challenge.difficulty,
    )
    const hmacValid = await hmacVerify(this.secret, message, challenge.hmac)
    if (!hmacValid) {
      return { valid: false, reason: 'invalid_hmac' }
    }

    // 2. Check expiration
    const now = Date.now()
    if (now > challenge.expiresAt) {
      return { valid: false, reason: 'expired' }
    }

    // 3. Verify the answer by re-executing the pipeline
    let expectedAnswer: string
    try {
      expectedAnswer = executePipeline(challenge.seed, challenge.pipeline)
    } catch {
      return { valid: false, reason: 'tampered' }
    }

    if (answer !== expectedAnswer) {
      return { valid: false, reason: 'wrong_answer' }
    }

    const elapsed = now - challenge.timestamp
    return {
      valid: true,
      elapsed,
      suspicious: elapsed > SUSPICIOUS_THRESHOLD_MS,
    }
  }
}

/**
 * Create a server-side verifier instance.
 *
 * @param config - Server configuration with HMAC secret
 * @returns An ImRobotVerifier instance
 *
 * @example
 * ```typescript
 * import { createVerifier } from 'imrobot/server'
 *
 * const verifier = createVerifier({
 *   secret: process.env.IMROBOT_SECRET!,
 *   difficulty: 'hard',
 * })
 *
 * // In your API route handler:
 * app.get('/api/challenge', async (req, res) => {
 *   const challenge = await verifier.generate()
 *   res.json(challenge)
 * })
 *
 * app.post('/api/verify', async (req, res) => {
 *   const { challenge, answer } = req.body
 *   const result = await verifier.verify(challenge, answer)
 *   res.json(result)
 * })
 * ```
 */
export function createVerifier(config: ServerConfig): ImRobotVerifier {
  return new ImRobotVerifier(config)
}
