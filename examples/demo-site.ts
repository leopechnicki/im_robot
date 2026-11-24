/**
 * A tiny imrobot-gated site for trying the agent examples locally.
 *
 *   npx tsx examples/demo-site.ts            # http://127.0.0.1:8787
 *
 * Serves /.well-known/imrobot.json, /imrobot/challenge, /imrobot/verify and a
 * protected /api/secret that needs the X-Agent-Proof header. Plain node:http,
 * no framework. In a real app use an adapter (imrobot/server, /next, /hono).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { ImRobotVerifier, ProofTokenIssuer, buildDiscoveryDocument } from 'imrobot/server'
import type { SignedChallenge } from 'imrobot'

const PORT = Number(process.env.PORT ?? 8787)
// Demo only: a fresh secret per run. Real servers load it from their secret store.
const secret = process.env.IMROBOT_SECRET ?? randomBytes(32).toString('hex')
const verifier = new ImRobotVerifier({ secret, difficulty: 'medium' })
const issuer = new ProofTokenIssuer({ secret })

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (text.length > 64 * 1024) throw new Error('too large')
  }
  return JSON.parse(text)
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (req.method === 'GET' && path === '/.well-known/imrobot.json') {
      return send(res, 200, buildDiscoveryDocument({ name: 'imrobot demo site' }))
    }
    if (req.method === 'GET' && path === '/imrobot/challenge') {
      return send(res, 200, await verifier.generate())
    }
    if (req.method === 'POST' && path === '/imrobot/verify') {
      const body = (await readBody(req)) as { challenge?: SignedChallenge; answer?: unknown; agentId?: unknown }
      if (!body.challenge || typeof body.answer !== 'string') {
        return send(res, 400, { valid: false, reason: 'missing_fields' })
      }
      const result = await verifier.verify(body.challenge, body.answer)
      if (!result.valid) return send(res, 400, result)
      const proofToken = await issuer.issue({
        agentId: typeof body.agentId === 'string' ? body.agentId.slice(0, 128) : 'anonymous',
        challengeId: body.challenge.id,
        difficulty: body.challenge.difficulty,
        solveTimeMs: result.elapsed ?? 0,
        suspicious: result.suspicious ?? false,
      })
      return send(res, 200, { ...result, proofToken })
    }
    if (req.method === 'GET' && path === '/api/secret') {
      const token = req.headers['x-agent-proof']
      const check = typeof token === 'string' ? await issuer.verify(token) : { valid: false }
      if (!check.valid) return send(res, 401, { error: 'agent proof required', discovery: '/.well-known/imrobot.json' })
      return send(res, 200, { message: 'Welcome, agent.', agent: check.payload?.sub })
    }
    send(res, 404, { error: 'not found' })
  } catch {
    send(res, 400, { error: 'bad request' })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`imrobot demo site on http://127.0.0.1:${PORT}`)
})
