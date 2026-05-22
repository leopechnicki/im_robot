export type Operation =
  | { op: 'reverse' }
  | { op: 'base64_encode' }
  | { op: 'to_upper' }
  | { op: 'to_lower' }
  | { op: 'rot13' }
  | { op: 'hex_encode' }
  | { op: 'sort_chars' }
  | { op: 'char_code_sum' }
  | { op: 'substring'; start: number; end: number }
  | { op: 'repeat'; times: number }
  | { op: 'replace'; search: string; replacement: string }
  | { op: 'pad_start'; length: number; fill: string }
  // New operations for challenge variety
  | { op: 'xor_encode'; key: number }
  | { op: 'count_chars'; char: string }
  | { op: 'caesar'; shift: number }
  | { op: 'slice_alternate' }
  | { op: 'fnv1a_hash' }
  | { op: 'length' }
  // Crypto-grade operations (v0.4)
  /**
   * @deprecated Misnomer — this is FNV-1a cascaded 8 times, NOT SHA-256.
   * Use {@link Operation.fnv1a_cascade} instead. Kept for wire-format compatibility.
   */
  | { op: 'sha256_hash' }
  /** Cascaded FNV-1a → 64 hex chars. Synchronous, deterministic. */
  | { op: 'fnv1a_cascade' }
  | { op: 'byte_xor'; key: number[] }
  | { op: 'hash_chain'; rounds: number }
  | { op: 'nibble_swap' }
  | { op: 'bit_rotate'; bits: number }
  // Additional operations (v0.5+)
  | { op: 'vowel_count' }
  | { op: 'consonant_extract' }
  | { op: 'run_length_encode' }
  | { op: 'atbash' }

export interface Challenge {
  version: 1
  id: string
  timestamp: number
  ttl: number
  difficulty: Difficulty
  /** Full seed used for computation (visibleSeed + nonce) */
  seed: string
  /** The portion of the seed shown on screen */
  visibleSeed: string
  /** Hidden nonce — only present in the JSON data attribute, never displayed */
  nonce: string
  pipeline: Operation[]
  verification: string
}

/**
 * A server-signed challenge with HMAC-SHA256.
 * Prevents tampering, replay attacks, and enables stateless verification.
 */
export interface SignedChallenge extends Challenge {
  /** HMAC-SHA256(secret, id + ":" + verification + ":" + expiresAt) */
  hmac: string
  /** Absolute expiration timestamp (ms since epoch) */
  expiresAt: number
}

export type Difficulty = 'easy' | 'medium' | 'hard'

/** All valid difficulty levels as a runtime array — useful for validation and iteration. */
export const SUPPORTED_DIFFICULTIES = [
  'easy',
  'medium',
  'hard',
] as const satisfies readonly Difficulty[]

/** Submissions slower than this are flagged as suspicious (possible human relay) */
export const SUSPICIOUS_THRESHOLD_MS = 5_000

export interface ImRobotToken {
  challengeId: string
  answer: string
  timestamp: number
  elapsed: number
  /** true when elapsed > SUSPICIOUS_THRESHOLD_MS — hints at human relay attack */
  suspicious: boolean
  signature: string
}

export interface ImRobotConfig {
  difficulty?: Difficulty
  ttl?: number
  theme?: 'light' | 'dark'
  onVerified?: (token: ImRobotToken) => void
  onError?: (error: Error) => void
}

/**
 * RFC 7519 JWT Proof-of-Agent token issued after successful verification.
 * Designed for cross-service agent authentication via X-Agent-Proof header.
 *
 * Header (separate from this payload type) is `{ alg: 'HS256', typ: 'JWT', kid?: string }`.
 * All time-based claims (`iat`, `nbf`, `exp`) are seconds since epoch (NumericDate, RFC 7519 §4.1.4).
 */
export interface AgentProofToken {
  /** Issuer identifier (RFC 7519 §4.1.1) */
  iss: string
  /** Subject — agent id (RFC 7519 §4.1.2) */
  sub: string
  /** Audience (RFC 7519 §4.1.3) */
  aud?: string
  /** Issued-at, seconds since epoch (RFC 7519 §4.1.6) */
  iat: number
  /** Not-before, seconds since epoch (RFC 7519 §4.1.5) */
  nbf?: number
  /** Expiration, seconds since epoch (RFC 7519 §4.1.4) */
  exp: number
  /** JWT ID (RFC 7519 §4.1.7) */
  jti: string
  /** Namespaced imrobot claim (RFC 7519 §4.3 private claim) */
  imr: {
    challenge_id: string
    difficulty: Difficulty
    solve_time_ms: number
    suspicious: boolean
    version: number
    /** Present only when Cloudflare Turnstile is configured on the server. */
    turnstile_verified?: boolean
    /** Present only when Web Bot Auth is configured and a signature was supplied. */
    web_bot_auth_verified?: boolean
  }
}

/** Serialized proof token (base64url-encoded header.payload.signature) */
export type SerializedProofToken = string

/**
 * Configuration for the server-side verifier.
 * The secret is used for HMAC signing — keep it safe and never expose to clients.
 */
export interface ServerConfig {
  /** HMAC secret — must be kept server-side only */
  secret: string
  difficulty?: Difficulty
  /** Challenge TTL in milliseconds (default: per difficulty) */
  ttl?: number
}

/** Result of server-side verification */
export interface VerifyResult {
  valid: boolean
  /** Reason for failure, if any */
  reason?: 'expired' | 'invalid_hmac' | 'wrong_answer' | 'tampered' | 'replay'
  /** Elapsed time in ms (from challenge creation to verification) */
  elapsed?: number
  /** Whether the response was suspiciously slow */
  suspicious?: boolean
}
