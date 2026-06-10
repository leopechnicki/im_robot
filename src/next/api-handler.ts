import type { NextApiHandlerConfig, NextApiRequestLike, NextApiResponseLike } from './types'
import { ImRobotVerifier } from '../server/verifier'
import { ProofTokenIssuer } from '../server/proof-token'

/**
 * Creates a Next.js Pages Router API route handler for imrobot.
 *
 * Handles both GET (challenge) and POST (verify) on a single route.
 * Mount at `pages/api/imrobot.ts` (or any path you prefer).
 *
 * @example
 * ```typescript
 * // pages/api/imrobot.ts
 * import { createNextApiHandler } from 'imrobot/next'
 *
 * export default createNextApiHandler({
 *   secret: process.env.IMROBOT_SECRET!,
 *   difficulty: 'medium',
 * })
 * ```
 *
 * @example With custom issuer and token TTL
 * ```typescript
 * export default createNextApiHandler({
 *   secret: process.env.IMROBOT_SECRET!,
 *   issuer: 'my-app',
 *   tokenTTL: 2 * 60 * 60 * 1000, // 2 hours
 * })
 * ```
 */
export function createNextApiHandler(config: NextApiHandlerConfig) {
  const verifier = new ImRobotVerifier({
    secret: config.secret,
    difficulty: config.difficulty,
    ttl: config.ttl,
  })

  const tokenIssuer = new ProofTokenIssuer({
    secret: config.secret,
    issuer: config.issuer,
    tokenTTL: config.tokenTTL,
  })

  return async function handler(req: NextApiRequestLike, res: NextApiResponseLike) {
    const method = req.method?.toUpperCase() ?? 'GET'

    // GET /api/imrobot — generate a signed challenge
    if (method === 'GET') {
      const challenge = await verifier.generate()
      res.status(200).json(challenge)
      return
    }

    // POST /api/imrobot — verify agent answer, issue proof token
    if (method === 'POST') {
      const body = req.body as
        | { challenge?: unknown; answer?: string; agentId?: string }
        | undefined

      if (!body?.challenge || !body?.answer) {
        res
          .status(400)
          .json({ error: 'Missing challenge or answer in request body', code: 'BAD_REQUEST' })
        return
      }

      const result = await verifier.verify(
        body.challenge as Parameters<typeof verifier.verify>[0],
        body.answer,
      )

      if (!result.valid) {
        res.status(403).json({ valid: false, reason: result.reason })
        return
      }

      const challengeObj = body.challenge as { id: string; difficulty: 'easy' | 'medium' | 'hard' }
      const proofToken = await tokenIssuer.issue({
        agentId: body.agentId ?? `agent_${challengeObj.id.slice(0, 8)}`,
        challengeId: challengeObj.id,
        difficulty: challengeObj.difficulty,
        solveTimeMs: result.elapsed ?? 0,
        suspicious: result.suspicious ?? false,
      })

      res.status(200).json({
        valid: true,
        elapsed: result.elapsed,
        suspicious: result.suspicious,
        proofToken,
      })
      return
    }

    // Other methods
    res.status(405).json({
      error: 'Method Not Allowed. Use GET for challenges, POST to verify.',
      code: 'METHOD_NOT_ALLOWED',
    })
  }
}
