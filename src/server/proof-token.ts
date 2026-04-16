import type { AgentProofToken, Difficulty, SerializedProofToken } from '../core/types'
import { hmacSign, hmacVerify } from '../core/hmac'
import { fnv1a } from '../core/hash'

/**
 * Base64url encoding (RFC 4648 §5) — no padding, URL-safe.
 */
function base64url(input: string): string {
  // Use Buffer when available (Node.js) for correct UTF-8 handling
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input).toString("base64url")
  }
  // Browser fallback: encode to UTF-8 bytes first, then btoa on Latin-1 representation
  if (typeof btoa !== "undefined" && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(input)
    let binary = ""
    bytes.forEach((b) => (binary += String.fromCharCode(b)))
    return btoa(binary).replace(/[+]/g, "-").replace(/[/]/g, "_").replace(/=+$/, "")
  }
  throw new Error("base64url: no encoding method available")
}

function base64urlDecode(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  if (typeof atob !== 'undefined') {
    return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  }
  return Buffer.from(padded, 'base64url').toString()
}

export interface ProofTokenConfig {
  /** HMAC secret for signing (same as verifier secret) */
  secret: string
  /** Issuer identifier (e.g., 'imrobot.ai' or your domain) */
  issuer?: string
  /** Token TTL in milliseconds (default: 1 hour) */
  tokenTTL?: number
}

export interface IssueTokenParams {
  /** Unique agent identifier */
  agentId: string
  /** Target audience (e.g., 'api.example.com') */
  audience?: string
  /** Challenge ID from successful verification */
  challengeId: string
  /** Challenge difficulty */
  difficulty: Difficulty
  /** Time taken to solve in ms */
  solveTimeMs: number
  /** Whether the solve time was suspicious */
  suspicious: boolean
}

/**
 * Issues and verifies JWT-like Proof-of-Agent tokens.
 *
 * Tokens use HMAC-SHA256 signing (same secret as challenge verifier).
 * Format: base64url(header).base64url(payload).base64url(signature)
 *
 * @example
 * ```typescript
 * const issuer = new ProofTokenIssuer({
 *   secret: process.env.IMROBOT_SECRET!,
 *   issuer: 'imrobot.ai',
 * })
 *
 * // Issue after successful challenge verification
 * const token = await issuer.issue({
 *   agentId: 'agent_123',
 *   challengeId: 'ch_abc',
 *   difficulty: 'hard',
 *   solveTimeMs: 42,
 *   suspicious: false,
 * })
 *
 * // Verify a token from X-Agent-Proof header
 * const result = await issuer.verify(token)
 * if (result.valid) {
 *   console.log('Agent:', result.payload.sub)
 * }
 * ```
 */
export class ProofTokenIssuer {
  private readonly secret: string
  private readonly issuer: string
  private readonly tokenTTL: number

  constructor(config: ProofTokenConfig) {
    if (!config.secret || config.secret.trim().length < 16) {
      throw new Error('ProofTokenIssuer: secret must be at least 16 non-whitespace characters')
    }
    this.secret = config.secret
    this.issuer = config.issuer ?? 'imrobot'
    this.tokenTTL = config.tokenTTL ?? 3_600_000 // 1 hour
  }

  /**
   * Issue a signed Proof-of-Agent token after successful challenge verification.
   */
  async issue(params: IssueTokenParams): Promise<SerializedProofToken> {
    const now = Date.now()
    const jti = `imr_${fnv1a(params.challengeId + ':' + now + ':' + params.agentId)}`

    const header = {
      alg: 'HMAC-SHA256' as const,
      typ: 'agent+jwt' as const,
    }

    const payload: AgentProofToken = {
      ...header,
      iss: this.issuer,
      sub: params.agentId,
      aud: params.audience,
      iat: now,
      exp: now + this.tokenTTL,
      jti,
      imr: {
        challenge_id: params.challengeId,
        difficulty: params.difficulty,
        solve_time_ms: params.solveTimeMs,
        suspicious: params.suspicious,
        version: 2,
      },
    }

    const headerB64 = base64url(JSON.stringify(header))
    const payloadB64 = base64url(JSON.stringify(payload))
    const signingInput = `${headerB64}.${payloadB64}`
    const signature = await hmacSign(this.secret, signingInput)
    const signatureB64 = base64url(signature)

    return `${headerB64}.${payloadB64}.${signatureB64}`
  }

  /**
   * Verify a Proof-of-Agent token.
   * Returns the decoded payload if valid, or an error reason if not.
   */
  async verify(token: SerializedProofToken): Promise<{
    valid: boolean
    payload?: AgentProofToken
    reason?: 'malformed' | 'invalid_signature' | 'expired' | 'invalid_issuer'
  }> {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, reason: 'malformed' }
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`
    let signature: string
    try {
      signature = base64urlDecode(signatureB64)
    } catch {
      return { valid: false, reason: 'malformed' }
    }

    const signatureValid = await hmacVerify(this.secret, signingInput, signature)
    if (!signatureValid) {
      return { valid: false, reason: 'invalid_signature' }
    }

    // Decode payload
    let payload: AgentProofToken
    try {
      payload = JSON.parse(base64urlDecode(payloadB64))
    } catch {
      return { valid: false, reason: 'malformed' }
    }

    // Check expiration
    if (Date.now() > payload.exp) {
      return { valid: false, reason: 'expired' }
    }

    // Check issuer
    if (payload.iss !== this.issuer) {
      return { valid: false, reason: 'invalid_issuer' }
    }

    return { valid: true, payload }
  }

  /**
   * Decode a token without verifying its signature.
   * Useful for debugging or reading token claims.
   */
  static decode(token: SerializedProofToken): AgentProofToken | null {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      return JSON.parse(base64urlDecode(parts[1]))
    } catch {
      return null
    }
  }
}

/**
 * Create a ProofTokenIssuer instance.
 */
export function createTokenIssuer(config: ProofTokenConfig): ProofTokenIssuer {
  return new ProofTokenIssuer(config)
}
