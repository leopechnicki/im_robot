/**
 * Cloudflare Turnstile server-side verification.
 *
 * Verifies Turnstile challenge tokens with Cloudflare's siteverify API.
 * Uses native fetch (Node 18+ built-in) with an AbortController-driven timeout.
 * Zero external dependencies.
 *
 * @example
 * ```typescript
 * import { TurnstileVerifier } from 'imrobot/server'
 *
 * const verifier = new TurnstileVerifier({
 *   // Never hardcode secrets — set ENV:TURNSTILE_SECRET_KEY in your environment
 *   secretKey: process.env.TURNSTILE_SECRET_KEY!,
 *   timeoutMs: 5000,
 * })
 *
 * const result = await verifier.verify(token, clientIp)
 * if (!result.success) {
 *   console.error('Turnstile verification failed:', result.errorCodes)
 * }
 * ```
 */

const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const DEFAULT_TIMEOUT_MS = 5_000
/** Cloudflare-published min length for production secret keys. */
const MIN_SECRET_LENGTH = 16

/**
 * Configuration for TurnstileVerifier.
 *
 * The secret key must be set via the TURNSTILE_SECRET_KEY environment variable.
 * Never hardcode secret keys in source code.
 */
export interface TurnstileConfig {
  /**
   * Cloudflare Turnstile secret key.
   * Reference as ENV:TURNSTILE_SECRET_KEY — load from process.env.TURNSTILE_SECRET_KEY.
   * Must be at least 16 non-whitespace characters (matches the imrobot HMAC secret guard).
   * Cloudflare's published test keys (e.g. `1x0000000000000000000000000000000AA`) satisfy this.
   */
  secretKey: string
  /**
   * Optional: expected site URL for origin validation.
   * If provided, the hostname in Cloudflare's response is compared against this.
   */
  siteUrl?: string
  /**
   * Request timeout in milliseconds for the siteverify call.
   * Defaults to 5000ms. Set to 0 to disable.
   */
  timeoutMs?: number
}

/**
 * Result from Cloudflare's Turnstile siteverify endpoint.
 */
export interface TurnstileResult {
  /** Whether the token was valid */
  success: boolean
  /** Hostname of the site where the challenge was solved */
  hostname?: string
  /** ISO 8601 timestamp of the challenge */
  challenge_ts?: string
  /**
   * Error codes returned by Cloudflare or this client. In addition to
   * Cloudflare's own codes, this client emits `network-error`,
   * `invalid-response`, and `timeout`.
   */
  errorCodes?: string[]
}

/**
 * Raw response shape from Cloudflare's siteverify API.
 */
interface CloudflareVerifyResponse {
  success: boolean
  hostname?: string
  challenge_ts?: string
  'error-codes'?: string[]
}

/**
 * Cloudflare Turnstile token verifier.
 *
 * Wraps the Cloudflare siteverify API with a clean interface, secret-length
 * enforcement, and an AbortController-driven request timeout.
 * Uses native fetch (Node 18+). Zero external dependencies.
 */
export class TurnstileVerifier {
  private readonly config: TurnstileConfig

  constructor(config: TurnstileConfig) {
    if (!config.secretKey || config.secretKey.trim().length < MIN_SECRET_LENGTH) {
      throw new Error(
        `TurnstileVerifier: secretKey must be at least ${MIN_SECRET_LENGTH} non-whitespace characters. Set ENV:TURNSTILE_SECRET_KEY in your environment.`,
      )
    }
    this.config = config
  }

  /**
   * Verify a Turnstile challenge token with Cloudflare's siteverify API.
   *
   * @param token  - The cf-turnstile-response token from the client
   * @param remoteip - Optional: client IP address, forwarded to Cloudflare for risk scoring
   * @returns TurnstileResult with success flag and optional metadata
   */
  async verify(token: string, remoteip?: string): Promise<TurnstileResult> {
    return verifyTurnstileToken(this.config.secretKey, token, remoteip, {
      timeoutMs: this.config.timeoutMs,
    })
  }
}

/**
 * Verify a Cloudflare Turnstile token using the siteverify API.
 *
 * Standalone function — use this when you don't need the class wrapper.
 * Uses native fetch (Node 18+ built-in) and aborts after `timeoutMs`.
 *
 * @param secretKey - Cloudflare Turnstile secret key (ENV:TURNSTILE_SECRET_KEY)
 * @param token     - The cf-turnstile-response token from the client
 * @param remoteip  - Optional: client IP address for Cloudflare risk scoring
 * @param options   - Optional: { timeoutMs }
 * @returns TurnstileResult with success flag and optional metadata
 */
export async function verifyTurnstileToken(
  secretKey: string,
  token: string,
  remoteip?: string,
  options?: { timeoutMs?: number },
): Promise<TurnstileResult> {
  const params = new URLSearchParams()
  params.set('secret', secretKey)
  params.set('response', token)
  if (remoteip) {
    params.set('remoteip', remoteip)
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = timeoutMs > 0 ? new AbortController() : undefined
  const timer =
    timeoutMs > 0 && controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined

  let response: Response
  try {
    response = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: controller?.signal,
    })
  } catch (err) {
    const isAbort =
      (err instanceof Error && err.name === 'AbortError') ||
      (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError')
    return {
      success: false,
      errorCodes: [isAbort ? 'timeout' : 'network-error'],
    }
  } finally {
    if (timer) clearTimeout(timer)
  }

  let data: CloudflareVerifyResponse
  try {
    data = (await response.json()) as CloudflareVerifyResponse
  } catch {
    return {
      success: false,
      errorCodes: ['invalid-response'],
    }
  }

  return {
    success: data.success,
    hostname: data.hostname,
    challenge_ts: data.challenge_ts,
    errorCodes: data['error-codes'],
  }
}
