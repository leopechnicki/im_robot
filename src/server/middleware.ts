import type { SignedChallenge, VerifyResult } from '../core/types'
import { ImRobotVerifier } from './verifier'
import { ProofTokenIssuer } from './proof-token'
import { RateLimiter } from './rate-limiter'
import type { RateLimiterConfig } from './rate-limiter'

/**
 * Generic middleware types — framework-agnostic.
 * Works with Express, Koa, Hono, or any framework with similar interfaces.
 */
export interface MiddlewareRequest {
  headers: Record<string, string | string[] | undefined>
  ip?: string
  method?: string
  url?: string
}

export interface MiddlewareResponse {
  status(code: number): MiddlewareResponse
  setHeader?(name: string, value: string | number): void
  json(body: unknown): void
}

export type NextFunction = () => void | Promise<void>

export interface RequireAgentOptions {
  /** HMAC secret for verification (must be ≥16 chars) */
  secret: string
  /** Where to extract the token from. Default: 'X-Agent-Proof' header */
  headerName?: string
  /** Rate limit configuration for verification endpoint */
  rateLimit?: RateLimiterConfig
  /** Custom bypass function (return true to skip verification) */
  bypass?: (req: MiddlewareRequest) => boolean
  /** Issuer name for proof tokens */
  issuer?: string
  /** Token TTL in ms (default: 1 hour) */
  tokenTTL?: number
  /**
   * Whether to trust proxy headers (X-Forwarded-For, X-Real-IP) for client IP extraction.
   * When false (default), only req.ip is used — preventing IP spoofing via headers.
   * Set to true only if your app runs behind a trusted reverse proxy (e.g., nginx, Cloudflare).
   */
  trustProxy?: boolean
}

/**
 * Agent verification middleware.
 *
 * Provides two usage patterns:
 * 1. Full flow: challenge → solve → verify → get proof token
 * 2. Token-only: present existing X-Agent-Proof token
 *
 * @example Express
 * ```typescript
 * import express from 'express'
 * import { createAgentRouter, requireAgent } from 'imrobot/server'
 *
 * const app = express()
 * app.use(express.json())
 *
 * // Mount challenge/verify endpoints
 * const router = createAgentRouter({ secret: process.env.IMROBOT_SECRET! })
 * app.use('/imrobot', router.handler)
 *
 * // Protect routes
 * const guard = requireAgent({ secret: process.env.IMROBOT_SECRET! })
 * app.get('/api/data', guard, (req, res) => {
 *   res.json({ message: 'Agent verified!', agent: req.agentProof })
 * })
 * ```
 */

/**
 * Extract client IP from request.
 *
 * When `trustProxy` is false (default), only `req.ip` is used.
 * This prevents attackers from spoofing their IP via X-Forwarded-For
 * headers to bypass rate limiting.
 *
 * When `trustProxy` is true, proxy headers are consulted first.
 * Only enable this behind a trusted reverse proxy that overwrites
 * these headers.
 */
function getClientIp(req: MiddlewareRequest, trustProxy = false): string {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    if (xff) {
      const ip = (Array.isArray(xff) ? xff[0] : xff).split(',')[0].trim()
      if (ip) return ip
    }
    const xri = req.headers['x-real-ip']
    if (xri) {
      const ip = Array.isArray(xri) ? xri[0] : xri
      if (ip) return ip.trim()
    }
  }
  return req.ip ?? 'unknown'
}
export function requireAgent(options: RequireAgentOptions) {
  const headerName = (options.headerName ?? 'x-agent-proof').toLowerCase()
  const tokenIssuer = new ProofTokenIssuer({
    secret: options.secret,
    issuer: options.issuer,
    tokenTTL: options.tokenTTL,
  })

  // Initialize rate limiter if configured
  const rateLimiter = options.rateLimit ? new RateLimiter(options.rateLimit) : undefined
  const rateLimitMax = options.rateLimit?.maxRequests ?? 30

  const trustProxy = options.trustProxy ?? false

  return async (req: MiddlewareRequest, res: MiddlewareResponse, next: NextFunction) => {
    // Bypass check
    if (options.bypass && options.bypass(req)) {
      return next()
    }

    // Rate limiting
    if (rateLimiter) {
      const key = getClientIp(req, trustProxy)
      const allowed = rateLimiter.isAllowed(key)

      if (!allowed) {
        const status = rateLimiter.getStatus(key)
        const retryAfter = Math.ceil((status.resetAt - Date.now()) / 1000)

        // Set standard rate limit headers
        res.setHeader?.('X-RateLimit-Limit', rateLimitMax)
        res.setHeader?.('X-RateLimit-Remaining', status.remaining)
        res.setHeader?.('X-RateLimit-Reset', status.resetAt)
        res.setHeader?.('Retry-After', retryAfter)

        return res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter,
        })
      }

      // Set rate limit headers for allowed requests
      const status = rateLimiter.getStatus(key)
      res.setHeader?.('X-RateLimit-Limit', rateLimitMax)
      res.setHeader?.('X-RateLimit-Remaining', status.remaining)
      res.setHeader?.('X-RateLimit-Reset', status.resetAt)
    }

    // Extract token
    const rawHeader = req.headers[headerName]
    const token = typeof rawHeader === 'string' ? rawHeader : undefined

    if (!token) {
      return res.status(401).json({
        error: 'Missing agent proof. Include X-Agent-Proof header with a valid token.',
        code: 'AGENT_PROOF_REQUIRED',
      })
    }

    // Verify the proof token
    const result = await tokenIssuer.verify(token)
    if (!result.valid) {
      return res.status(403).json({
        error: `Invalid agent proof: ${result.reason}`,
        code: 'AGENT_PROOF_INVALID',
      })
    }

    // Attach proof to request for downstream handlers
    ;(req as unknown as Record<string, unknown>).agentProof = result.payload
    ;(req as unknown as Record<string, unknown>).agentVerified = true

    return next()
  }
}

/**
 * Creates a handler object with challenge/verify endpoints.
 * Mount this as a sub-route (e.g., /imrobot).
 *
 * Provides:
 * - GET  /challenge — generate a signed challenge
 * - POST /verify    — verify answer and issue proof token
 *
 * Optionally applies rate limiting to both endpoints if configured.
 *
 * @example
 * ```typescript
 * // Express
 * const router = createAgentRouter({
 *   secret: 'your-secret-min-16-chars',
 *   rateLimit: { windowMs: 60000, maxRequests: 30 }
 * })
 * app.get('/imrobot/challenge', router.challenge)
 * app.post('/imrobot/verify', router.verify)
 *
 * // Or use the combined handler — routes GET → challenge, POST → verify
 * app.use('/imrobot', router.handler)
 * ```
 */
export function createAgentRouter(options: RequireAgentOptions) {
  const verifier = new ImRobotVerifier({
    secret: options.secret,
  })

  const tokenIssuer = new ProofTokenIssuer({
    secret: options.secret,
    issuer: options.issuer,
    tokenTTL: options.tokenTTL,
  })

  // Initialize rate limiter if configured
  const rateLimiter = options.rateLimit ? new RateLimiter(options.rateLimit) : undefined

  type VerifyRequest = MiddlewareRequest & {
    body?: { challenge: SignedChallenge; answer: string; agentId?: string }
  }

  const trustProxy = options.trustProxy ?? false

  /**
   * Helper to apply rate limiting to a response.
   */
  const applyRateLimit = (req: MiddlewareRequest, res: MiddlewareResponse): boolean => {
    if (!rateLimiter) return true

    const key = getClientIp(req, trustProxy)
    const allowed = rateLimiter.isAllowed(key)

    if (!allowed) {
      const status = rateLimiter.getStatus(key)
      const retryAfter = Math.ceil((status.resetAt - Date.now()) / 1000)

      // Set standard rate limit headers
      res.setHeader?.('X-RateLimit-Limit', options.rateLimit?.maxRequests ?? 30)
      res.setHeader?.('X-RateLimit-Remaining', status.remaining)
      res.setHeader?.('X-RateLimit-Reset', status.resetAt)
      res.setHeader?.('Retry-After', retryAfter)

      res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter,
      })
      return false
    }

    // Set rate limit headers for allowed requests
    const status = rateLimiter.getStatus(key)
    res.setHeader?.('X-RateLimit-Limit', options.rateLimit?.maxRequests ?? 30)
    res.setHeader?.('X-RateLimit-Remaining', status.remaining)
    res.setHeader?.('X-RateLimit-Reset', status.resetAt)
    return true
  }

  /**
   * Generate a signed challenge for an agent.
   */
  const challenge = async (req: MiddlewareRequest, res: MiddlewareResponse) => {
    // Apply rate limiting
    if (!applyRateLimit(req, res)) return

    const ch = await verifier.generate()
    return res.status(200).json(ch)
  }

  /**
   * Verify an agent's answer and issue a proof token.
   */
  const verify = async (req: VerifyRequest, res: MiddlewareResponse) => {
    // Apply rate limiting
    if (!applyRateLimit(req, res)) return

    const body = req.body
    if (!body?.challenge || !body?.answer) {
      return res.status(400).json({
        error: 'Missing challenge or answer in request body',
        code: 'BAD_REQUEST',
      })
    }

    const result: VerifyResult = await verifier.verify(body.challenge, body.answer)

    if (!result.valid) {
      return res.status(403).json({
        valid: false,
        reason: result.reason,
      })
    }

    // Issue proof token
    const proofToken = await tokenIssuer.issue({
      agentId: body.agentId ?? `agent_${body.challenge.id.slice(0, 8)}`,
      challengeId: body.challenge.id,
      difficulty: body.challenge.difficulty,
      solveTimeMs: result.elapsed ?? 0,
      suspicious: result.suspicious ?? false,
    })

    return res.status(200).json({
      valid: true,
      elapsed: result.elapsed,
      suspicious: result.suspicious,
      proofToken,
    })
  }

  /**
   * Combined request handler that routes by HTTP method.
   * GET  → challenge endpoint (returns a signed challenge)
   * POST → verify endpoint   (verifies answer, returns proof token)
   * Other methods → 405 Method Not Allowed (or calls next() if provided)
   *
   * @example Express
   * ```typescript
   * app.use('/imrobot', router.handler)
   * ```
   *
   * @example Koa / raw Node.js
   * ```typescript
   * server.on('request', (req, res) => router.handler(req, res))
   * ```
   */
  const handler = async (req: VerifyRequest, res: MiddlewareResponse, next?: NextFunction) => {
    if (req.method === 'GET') return challenge(req, res)
    if (req.method === 'POST') return verify(req, res)
    if (next) return next()
    return res.status(405).json({
      error: 'Method Not Allowed. Use GET for challenges, POST to verify.',
      code: 'METHOD_NOT_ALLOWED',
    })
  }

  return { challenge, verify, handler }
}
