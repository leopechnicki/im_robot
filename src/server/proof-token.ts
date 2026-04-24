import type { AgentProofToken, Difficulty, SerializedProofToken } from '../core/types'
import { hmacSign, hmacVerify } from '../core/hmac'
import { fnv1a } from '../core/hash'

/**
 * Base64url encoding (RFC 4648 §5) — no padding, URL-safe.
 */
function base64url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('base64url')
  }
  if (typeof btoa !== 'undefined' && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(input)
    let binary = ''
    bytes.forEach((b) => (binary += String.fromCharCode(b)))
    return btoa(binary).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '')
  }
  throw new Error('base64url: no encoding method available')
}

function base64urlDecode(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64url').toString('utf-8')
  }
  if (typeof atob !== 'undefined' && typeof TextDecoder !== 'undefined') {
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  }
  try {
    return atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    throw new Error('base64urlDecode: invalid base64url input')
  }
}

/** Constraint-bounded clock skew tolerance for token exp/nbf checks. */
const MAX_CLOCK_SKEW_SEC = 300 // 5 minutes — wider than any sane NTP drift

export interface ProofTokenConfig {
  /** Active HMAC secret used to sign newly-issued tokens (min 16 non-whitespace chars). */
  secret: string
  /**
   * Optional key id for the active secret. Embedded as `kid` in the JWT header
   * so tokens can be rotated without invalidating outstanding ones.
   */
  keyId?: string
  /**
   * Additional secrets accepted during verification (for graceful key rotation).
   * Each entry must have a unique `keyId` matching the `kid` header on tokens
   * issued under that previous secret. The active `secret` is always trusted.
   */
  previousSecrets?: Array<{ keyId: string; secret: string }>
  /** Issuer identifier (e.g., 'imrobot.ai' or your domain) */
  issuer?: string
  /** Token TTL in milliseconds (default: 1 hour) */
  tokenTTL?: number
  /**
   * Allowed clock skew in seconds when checking `iat`/`nbf`/`exp`.
   * Defaults to 5s — covers typical NTP drift between hosts.
   * Capped at 300s.
   */
  clockSkewSec?: number
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
  /**
   * Whether the accompanying Cloudflare Turnstile token was verified.
   * undefined = Turnstile not configured or token not present.
   * true  = Turnstile verified successfully.
   * false = Turnstile present but verification failed (required: false mode).
   */
  turnstileVerified?: boolean
}

/**
 * Issues and verifies RFC 7519 (JWT) Proof-of-Agent tokens.
 *
 * Tokens are real JWTs:
 * - Header: `{ "alg": "HS256", "typ": "JWT", "kid"?: "..." }`
 * - Payload: standard claims (`iss`, `sub`, `aud`, `iat`, `nbf`, `exp`, `jti`)
 *   in **seconds since epoch** (NumericDate per RFC 7519 §4.1.4) plus a
 *   namespaced `imr` claim with imrobot-specific metadata.
 * - Signature: HMAC-SHA256(`base64url(header).base64url(payload)`).
 *
 * Compatible with any RFC-compliant JWT library (`jsonwebtoken`, `jose`, ...).
 *
 * @example
 * ```typescript
 * const issuer = new ProofTokenIssuer({
 *   secret: process.env.IMROBOT_SECRET!,
 *   keyId: 'k-2026-04',
 *   previousSecrets: [{ keyId: 'k-2026-01', secret: process.env.IMROBOT_SECRET_PREV! }],
 *   issuer: 'imrobot.ai',
 *   clockSkewSec: 5,
 * })
 *
 * const token = await issuer.issue({
 *   agentId: 'agent_123',
 *   challengeId: 'ch_abc',
 *   difficulty: 'hard',
 *   solveTimeMs: 42,
 *   suspicious: false,
 * })
 *
 * const result = await issuer.verify(token)
 * if (result.valid) console.log('Agent:', result.payload!.sub)
 * ```
 */
export class ProofTokenIssuer {
  private readonly secret: string
  private readonly keyId?: string
  private readonly issuer: string
  private readonly tokenTTL: number
  private readonly clockSkewSec: number
  /** Map of keyId → secret for verification (active key plus rotated-out keys). */
  private readonly secrets: Map<string, string>

  constructor(config: ProofTokenConfig) {
    if (!config.secret || config.secret.trim().length < 16) {
      throw new Error('ProofTokenIssuer: secret must be at least 16 non-whitespace characters')
    }
    this.secret = config.secret
    this.keyId = config.keyId
    this.issuer = config.issuer ?? 'imrobot'
    this.tokenTTL = config.tokenTTL ?? 3_600_000 // 1 hour
    const skew = config.clockSkewSec ?? 5
    this.clockSkewSec = Math.max(0, Math.min(MAX_CLOCK_SKEW_SEC, skew))

    this.secrets = new Map()
    if (config.keyId) this.secrets.set(config.keyId, config.secret)
    for (const prev of config.previousSecrets ?? []) {
      if (!prev.secret || prev.secret.trim().length < 16) {
        throw new Error(
          `ProofTokenIssuer: previousSecrets[${prev.keyId}] must be at least 16 non-whitespace characters`,
        )
      }
      this.secrets.set(prev.keyId, prev.secret)
    }
  }

  /**
   * Issue a signed RFC 7519 JWT after successful challenge verification.
   */
  async issue(params: IssueTokenParams): Promise<SerializedProofToken> {
    const nowMs = Date.now()
    const nowSec = Math.floor(nowMs / 1000)
    const expSec = Math.floor((nowMs + this.tokenTTL) / 1000)
    const jti = `imr_${fnv1a(params.challengeId + ':' + nowMs + ':' + params.agentId)}`

    const header: { alg: 'HS256'; typ: 'JWT'; kid?: string } = {
      alg: 'HS256',
      typ: 'JWT',
    }
    if (this.keyId) header.kid = this.keyId

    const payload: AgentProofToken = {
      iss: this.issuer,
      sub: params.agentId,
      aud: params.audience,
      iat: nowSec,
      nbf: nowSec,
      exp: expSec,
      jti,
      imr: {
        challenge_id: params.challengeId,
        difficulty: params.difficulty,
        solve_time_ms: params.solveTimeMs,
        suspicious: params.suspicious,
        version: 2,
        ...(params.turnstileVerified !== undefined
          ? { turnstile_verified: params.turnstileVerified }
          : {}),
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
    /** Header `kid` of the key that signed the token (if present). */
    keyId?: string
    reason?:
      | 'malformed'
      | 'invalid_signature'
      | 'expired'
      | 'not_yet_valid'
      | 'invalid_issuer'
      | 'unsupported_alg'
      | 'unknown_key'
  }> {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, reason: 'malformed' }
    }

    const [headerB64, payloadB64, signatureB64] = parts

    // Decode header to read alg + kid
    let header: { alg?: string; typ?: string; kid?: string }
    try {
      header = JSON.parse(base64urlDecode(headerB64))
    } catch {
      return { valid: false, reason: 'malformed' }
    }

    if (header.alg !== 'HS256') {
      return { valid: false, reason: 'unsupported_alg' }
    }

    // Resolve which secret signed this token
    let candidateSecret = this.secret
    if (header.kid) {
      const mapped = this.secrets.get(header.kid)
      if (!mapped) {
        return { valid: false, reason: 'unknown_key', keyId: header.kid }
      }
      candidateSecret = mapped
    }

    // Verify signature with the resolved secret
    const signingInput = `${headerB64}.${payloadB64}`
    let signature: string
    try {
      signature = base64urlDecode(signatureB64)
    } catch {
      return { valid: false, reason: 'malformed' }
    }

    const signatureValid = await hmacVerify(candidateSecret, signingInput, signature)
    if (!signatureValid) {
      return { valid: false, reason: 'invalid_signature', keyId: header.kid }
    }

    // Decode payload
    let payload: AgentProofToken
    try {
      payload = JSON.parse(base64urlDecode(payloadB64))
    } catch {
      return { valid: false, reason: 'malformed' }
    }

    const nowSec = Math.floor(Date.now() / 1000)

    if (typeof payload.exp !== 'number' || nowSec > payload.exp + this.clockSkewSec) {
      return { valid: false, reason: 'expired', keyId: header.kid }
    }
    if (typeof payload.nbf === 'number' && nowSec + this.clockSkewSec < payload.nbf) {
      return { valid: false, reason: 'not_yet_valid', keyId: header.kid }
    }
    if (payload.iss !== this.issuer) {
      return { valid: false, reason: 'invalid_issuer', keyId: header.kid }
    }

    return { valid: true, payload, keyId: header.kid }
  }

  /**
   * Decode a token WITHOUT verifying its signature.
   * For debugging / logging only — never gate access on this.
   */
  static decodeUnsafe(token: SerializedProofToken): AgentProofToken | null {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      return JSON.parse(base64urlDecode(parts[1]))
    } catch {
      return null
    }
  }

  /** @deprecated renamed to `decodeUnsafe` to make the no-verification semantics explicit. */
  static decode(token: SerializedProofToken): AgentProofToken | null {
    return ProofTokenIssuer.decodeUnsafe(token)
  }
}

/**
 * Create a ProofTokenIssuer instance.
 */
export function createTokenIssuer(config: ProofTokenConfig): ProofTokenIssuer {
  return new ProofTokenIssuer(config)
}
