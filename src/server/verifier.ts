import type { SignedChallenge, ServerConfig, Difficulty, VerifyResult } from '../core/types'
import { SUSPICIOUS_THRESHOLD_MS } from '../core/types'
import { generateChallenge } from '../core/challenge'
import { executePipeline } from '../core/operations'
import { constantTimeEqual, hmacSign, hmacVerify } from '../core/hmac'
import { fnv1a } from '../core/hash'
import type { ChallengeReplayGuard } from './replay-guard'

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
  private readonly replayGuard?: ChallengeReplayGuard
  private readonly sha256: boolean
  private readonly minSolveMs: number
  private readonly maxSolveMs?: number

  constructor(config: ServerConfig & { replayGuard?: ChallengeReplayGuard }) {
    if (!config.secret || config.secret.trim().length < 16) {
      throw new Error('ImRobotVerifier: secret must be at least 16 non-whitespace characters')
    }
    const { minSolveMs = 0, maxSolveMs } = config
    if (!Number.isFinite(minSolveMs) || minSolveMs < 0) {
      throw new Error('ImRobotVerifier: minSolveMs must be a non-negative number')
    }
    if (maxSolveMs !== undefined && (!Number.isFinite(maxSolveMs) || maxSolveMs <= minSolveMs)) {
      throw new Error('ImRobotVerifier: maxSolveMs must be a number greater than minSolveMs')
    }
    this.secret = config.secret
    this.difficulty = config.difficulty ?? 'medium'
    this.ttl = config.ttl
    this.replayGuard = config.replayGuard
    this.sha256 = config.sha256 === true
    this.minSolveMs = minSolveMs
    this.maxSolveMs = maxSolveMs
  }

  /**
   * Build the message string that gets HMAC-signed (format v2, imrobot 0.9).
   * Covers every field verify() trusts: the issue time (timing gate), the seed
   * and the pipeline (answer re-execution), expiry and difficulty.
   */
  private buildSignatureMessage(c: {
    id: string
    verification: string
    expiresAt: number
    difficulty: Difficulty
    timestamp: number
    seed: string
    pipeline: unknown[]
  }): string {
    return [
      'v2',
      c.id,
      c.verification,
      c.expiresAt,
      c.difficulty,
      c.timestamp,
      c.seed,
      JSON.stringify(c.pipeline),
    ].join(':')
  }

  /**
   * Generate a signed challenge.
   * The challenge includes an HMAC signature that prevents tampering.
   * Send the entire SignedChallenge to the client agent.
   */
  async generate(overrides?: { difficulty?: Difficulty; ttl?: number }): Promise<SignedChallenge> {
    const difficulty = overrides?.difficulty ?? this.difficulty
    const ttl = overrides?.ttl ?? this.ttl

    const challenge = generateChallenge({ difficulty, ttl, sha256: this.sha256 })
    const expiresAt = challenge.timestamp + challenge.ttl

    const message = this.buildSignatureMessage({ ...challenge, expiresAt })
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
   * 3. Timing gate (`minSolveMs` / `maxSolveMs`, measured from the signed issue time)
   * 4. Answer correctness (constant-time compares)
   * 5. Replay guard
   *
   * Returns a VerifyResult with `valid` boolean and failure `reason`.
   */
  async verify(challenge: SignedChallenge, answer: string): Promise<VerifyResult> {
    // 1. Verify HMAC — ensures the challenge hasn't been tampered with
    if (
      typeof challenge !== 'object' ||
      challenge === null ||
      typeof challenge.hmac !== 'string' ||
      typeof answer !== 'string' ||
      !Array.isArray(challenge.pipeline)
    ) {
      return { valid: false, reason: 'invalid_hmac' }
    }
    const message = this.buildSignatureMessage(challenge)
    const hmacValid = await hmacVerify(this.secret, message, challenge.hmac)
    if (!hmacValid) {
      return { valid: false, reason: 'invalid_hmac' }
    }

    // 2. Check expiration
    const now = Date.now()
    if (now > challenge.expiresAt) {
      return { valid: false, reason: 'expired' }
    }

    // 3. Timing gate, on the server clock against the HMAC-signed issue time.
    const elapsed = now - challenge.timestamp
    if (elapsed < this.minSolveMs) {
      return { valid: false, reason: 'too_fast', elapsed }
    }
    if (this.maxSolveMs !== undefined && elapsed > this.maxSolveMs) {
      return { valid: false, reason: 'too_slow', elapsed }
    }

    // 4. Verify the answer against the HMAC-protected verification hash.
    // This catches pipeline tampering: the verification field is fnv1a(answer + ':' + id),
    // signed by the HMAC. Even if an attacker swaps the pipeline, the verification
    // won't match their new answer.
    const expectedVerification = fnv1a(answer + ':' + challenge.id)
    if (!constantTimeEqual(expectedVerification, challenge.verification)) {
      return { valid: false, reason: 'wrong_answer' }
    }

    // Re-execute the pipeline as a secondary check
    let expectedAnswer: string
    try {
      expectedAnswer = executePipeline(challenge.seed, challenge.pipeline)
    } catch {
      return { valid: false, reason: 'tampered' }
    }

    if (!constantTimeEqual(answer, expectedAnswer)) {
      return { valid: false, reason: 'tampered' }
    }

    // 5. Check replay — rejects duplicate challenge verifications
    if (this.replayGuard) {
      const allowed = this.replayGuard.markUsed(challenge.id)
      if (!allowed) {
        return { valid: false, reason: 'replay' }
      }
    }

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
export function createVerifier(
  config: ServerConfig & { replayGuard?: ChallengeReplayGuard },
): ImRobotVerifier {
  return new ImRobotVerifier(config)
}
