import type { SignedChallenge, VerifyResult } from '../core/types'
import { ImRobotVerifier } from './verifier'
import { ProofTokenIssuer } from './proof-token'

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
  json(body: unknown): void
}

export type NextFunction = () => void | Promise<void>

export interface RequireAgentOptions {
  /** HMAC secret for verification (must be ≥16 chars) */
  secret: string
  /** Where to extract the token from. Default: 'X-Agent-Proof' header */
  headerName?: string
  /** Rate limit: max requests per window per IP */
  rateLimit?: { windowMs: number; maxRequests: number }
  /** Custom bypass function (return true to skip verification) */
  bypass?: (req: MiddlewareRequest) => boolean
  /** Issuer name for proof tokens */
  issuer?: string
  /** Token TTL in ms (default: 1 hour) */
  tokenTTL?: number
}

interface RateLimitRecord {
  count: number
  resetAt: number
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
export function requireAgent(options: RequireAgentOptions) {
  const headerName = (options.headerName ?? 'x-agent-proof').toLowerCase()
  const tokenIssuer = new ProofTokenIssuer({
    secret: options.secret,
    issuer: options.issuer,
    tokenTTL: options.tokenTTL,
  })

  // Rate limiting state
  const rateLimitStore = new Map<string, RateLimitRecord>()
  const rateLimit = options.rateLimit

  // Periodic cleanup (every 60s)
  if (rateLimit) {
    setInterval(() => {
      const now = Date.now()
      for (const [key, record] of rateLimitStore.entries()) {
        if (record.resetAt < now) rateLimitStore.delete(key)
      }
    }, 60_000).unref?.()
  }

  return async (req: MiddlewareRequest, res: MiddlewareResponse, next: NextFunction) => {
    // Bypass check
    if (options.bypass && options.bypass(req)) {
      return next()
    }

    // Rate limiting
    if (rateLimit) {
      const key = req.ip ?? 'unknown'
      const now = Date.now()
      const record = rateLimitStore.get(key)

      if (!record || record.resetAt < now) {
        rateLimitStore.set(key, { count: 1, resetAt: now + rateLimit.windowMs })
      } else if (record.count >= rateLimit.maxRequests) {
        const retryAfter = Math.ceil((record.resetAt - now) / 1000)
        return res.status(429).json({
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter,
        })
      } else {
        record.count++
      }
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
 * @example
 * ```typescript
 * // Express
 * const router = createAgentRouter({ secret: 'your-secret-min-16-chars' })
 * app.get('/imrobot/challenge', router.challenge)
 * app.post('/imrobot/verify', router.verify)
 *
 * // Or use the combined handler
 * app.use('/imrobot', (req, res, next) => {
 *   if (req.method === 'GET' && req.url === '/challenge') return router.challenge(req, res, next)
 *   if (req.method === 'POST' && req.url === '/verify') return router.verify(req, res, next)
 *   next()
 * })
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

  return {
    /**
     * Generate a signed challenge for an agent.
     */
    challenge: async (_req: MiddlewareRequest, res: MiddlewareResponse) => {
      const challenge = await verifier.generate()
      return res.status(200).json(challenge)
    },

    /**
     * Verify an agent's answer and issue a proof token.
     */
    verify: async (
      req: MiddlewareRequest & {
        body?: { challenge: SignedChallenge; answer: string; agentId?: string }
      },
      res: MiddlewareResponse,
    ) => {
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
    },
  }
}
