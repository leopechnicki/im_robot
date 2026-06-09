import type { NextMiddlewareConfig, NextRequestLike } from './types'
import { ImRobotVerifier } from '../server/verifier'
import { ProofTokenIssuer } from '../server/proof-token'
import { RateLimiter } from '../server/rate-limiter'

/**
 * Creates a Next.js App Router middleware that:
 * 1. Serves challenge endpoint at `GET {imrobotPath}/challenge`
 * 2. Serves verify endpoint at `POST {imrobotPath}/verify`
 * 3. Enforces agent proof on `protectedPaths`
 *
 * Mount in `middleware.ts` at the project root and configure the `matcher`
 * to include both the imrobot path and your protected paths.
 *
 * @example
 * ```typescript
 * // middleware.ts
 * import { createNextMiddleware } from 'imrobot/next'
 *
 * export const middleware = createNextMiddleware({
 *   secret: process.env.IMROBOT_SECRET!,
 *   protectedPaths: ['/api/agent'],
 * })
 *
 * export const config = {
 *   matcher: ['/api/agent/:path*', '/imrobot/:path*'],
 * }
 * ```
 *
 * Note: This adapter intentionally avoids importing from `next/server` so the
 * package remains installable in non-Next.js projects. The returned function
 * accepts any object that matches the NextRequest shape.
 */
export function createNextMiddleware(config: NextMiddlewareConfig) {
  const imrobotBase = config.imrobotPath ?? '/imrobot'
  const proofHeader = (config.proofHeaderName ?? 'x-agent-proof').toLowerCase()
  const protectedPaths = config.protectedPaths ?? []

  const verifier = new ImRobotVerifier({ secret: config.secret, difficulty: config.difficulty, ttl: config.ttl })
  const tokenIssuer = new ProofTokenIssuer({ secret: config.secret, tokenTTL: config.tokenTTL })
  const rateLimiter = config.rateLimit ? new RateLimiter(config.rateLimit) : undefined

  /**
   * The middleware function.
   * Pass the NextRequest object — the function returns a plain Response
   * (or null/undefined to continue to the next middleware/route).
   */
  return async function imrobotMiddleware(req: NextRequestLike): Promise<Response | null> {
    const url = new URL(req.url)
    const pathname = url.pathname
    const method = req.method?.toUpperCase() ?? 'GET'

    // ── Rate limiting ─────────────────────────────────────────────────
    if (rateLimiter) {
      const ip = req.ip ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
      const allowed = rateLimiter.isAllowed(ip)
      if (!allowed) {
        const status = rateLimiter.getStatus(ip)
        const retryAfter = Math.ceil((status.resetAt - Date.now()) / 1000)
        return new Response(
          JSON.stringify({ error: 'Too many requests', code: 'RATE_LIMIT_EXCEEDED', retryAfter }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter),
            },
          },
        )
      }
    }

    // ── Challenge endpoint: GET {imrobotBase}/challenge ───────────────
    if (method === 'GET' && pathname === `${imrobotBase}/challenge`) {
      const challenge = await verifier.generate()
      return new Response(JSON.stringify(challenge), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Verify endpoint: POST {imrobotBase}/verify ────────────────────
    if (method === 'POST' && pathname === `${imrobotBase}/verify`) {
      let body: { challenge?: unknown; answer?: string; agentId?: string }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      if (!body?.challenge || !body?.answer) {
        return new Response(
          JSON.stringify({ error: 'Missing challenge or answer', code: 'BAD_REQUEST' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const result = await verifier.verify(body.challenge as Parameters<typeof verifier.verify>[0], body.answer)
      if (!result.valid) {
        return new Response(
          JSON.stringify({ valid: false, reason: result.reason }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const challengeObj = body.challenge as { id: string; difficulty: 'easy' | 'medium' | 'hard' }
      const proofToken = await tokenIssuer.issue({
        agentId: body.agentId ?? `agent_${challengeObj.id.slice(0, 8)}`,
        challengeId: challengeObj.id,
        difficulty: challengeObj.difficulty,
        solveTimeMs: result.elapsed ?? 0,
        suspicious: result.suspicious ?? false,
      })

      return new Response(
        JSON.stringify({ valid: true, elapsed: result.elapsed, suspicious: result.suspicious, proofToken }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // ── Protected path guard ──────────────────────────────────────────
    const isProtected = protectedPaths.some(
      (p) => pathname === p || pathname.startsWith(p + '/'),
    )

    if (isProtected) {
      const token = req.headers.get(proofHeader)
      if (!token) {
        return new Response(
          JSON.stringify({
            error: 'Missing agent proof. Include X-Agent-Proof header with a valid token.',
            code: 'AGENT_PROOF_REQUIRED',
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        )
      }

      const tokenResult = await tokenIssuer.verify(token)
      if (!tokenResult.valid) {
        return new Response(
          JSON.stringify({ error: `Invalid agent proof: ${tokenResult.reason}`, code: 'AGENT_PROOF_INVALID' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Token valid — allow the request to continue to the route
      return null
    }

    // Not an imrobot path and not protected — pass through
    return null
  }
}
