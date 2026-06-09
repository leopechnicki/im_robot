import { describe, it, expect, beforeEach } from 'vitest'
import { createNextMiddleware } from '../src/next/middleware'
import { createNextApiHandler } from '../src/next/api-handler'
import type { NextMiddlewareConfig } from '../src/next/types'
import { solveChallenge } from '../src/core/solver'

const SECRET = 'next-adapter-test-secret-32chars'

// ── Helpers ───────────────────────────────────────────────────────────────

function makeRequest(
  method: string,
  pathname: string,
  body?: unknown,
  headers?: Record<string, string>,
): {
  method: string
  url: string
  headers: { get: (k: string) => string | null }
  json: () => Promise<unknown>
  ip?: string
} {
  return {
    method,
    url: `http://localhost${pathname}`,
    headers: {
      get: (k: string) => headers?.[k.toLowerCase()] ?? null,
    },
    json: () => Promise.resolve(body ?? {}),
    ip: '127.0.0.1',
  }
}

function makeApiReq(method: string, body?: unknown): {
  method: string
  body: unknown
  headers: Record<string, string>
} {
  return { method, body, headers: {} }
}

function makeApiRes(): {
  statusCode: number
  body: unknown
  headers: Record<string, string | number>
  status: (code: number) => ReturnType<typeof makeApiRes>
  json: (data: unknown) => void
  setHeader: (k: string, v: string | number) => void
  end: () => void
} {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string | number>,
    status(code: number) { res.statusCode = code; return res },
    json(data: unknown) { res.body = data },
    setHeader(k: string, v: string | number) { res.headers[k] = v },
    end() {},
  }
  return res
}

// ── createNextMiddleware — challenge endpoint ─────────────────────────────

describe('createNextMiddleware — challenge endpoint', () => {
  const middleware = createNextMiddleware({ secret: SECRET })

  it('GET /imrobot/challenge returns a signed challenge', async () => {
    const req = makeRequest('GET', '/imrobot/challenge')
    const res = await middleware(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const data = JSON.parse(await res!.text()) as Record<string, unknown>
    expect(data).toHaveProperty('id')
    expect(data).toHaveProperty('hmac')
    expect(data).toHaveProperty('pipeline')
  })

  it('returns null for unrelated paths (pass-through)', async () => {
    const req = makeRequest('GET', '/api/other')
    const res = await middleware(req)
    expect(res).toBeNull()
  })
})

// ── createNextMiddleware — verify endpoint ────────────────────────────────

describe('createNextMiddleware — verify endpoint', () => {
  const middleware = createNextMiddleware({ secret: SECRET })

  it('POST /imrobot/verify with correct answer returns proofToken', async () => {
    // First get a challenge
    const challengeReq = makeRequest('GET', '/imrobot/challenge')
    const challengeRes = await middleware(challengeReq)
    const challenge = JSON.parse(await challengeRes!.text()) as Parameters<typeof solveChallenge>[0]

    const answer = solveChallenge(challenge)
    const verifyReq = makeRequest('POST', '/imrobot/verify', { challenge, answer })
    const verifyRes = await middleware(verifyReq)
    expect(verifyRes).not.toBeNull()
    expect(verifyRes!.status).toBe(200)
    const data = JSON.parse(await verifyRes!.text()) as Record<string, unknown>
    expect(data.valid).toBe(true)
    expect(typeof data.proofToken).toBe('string')
  })

  it('POST /imrobot/verify with wrong answer returns 403', async () => {
    const challengeReq = makeRequest('GET', '/imrobot/challenge')
    const challengeRes = await middleware(challengeReq)
    const challenge = JSON.parse(await challengeRes!.text()) as Record<string, unknown>

    const verifyReq = makeRequest('POST', '/imrobot/verify', { challenge, answer: 'wrong' })
    const verifyRes = await middleware(verifyReq)
    expect(verifyRes!.status).toBe(403)
  })

  it('POST /imrobot/verify with missing body returns 400', async () => {
    const req = makeRequest('POST', '/imrobot/verify', {})
    const res = await middleware(req)
    expect(res!.status).toBe(400)
  })
})

// ── createNextMiddleware — protected paths ────────────────────────────────

describe('createNextMiddleware — protected paths', () => {
  const middleware = createNextMiddleware({
    secret: SECRET,
    protectedPaths: ['/api/agent'],
  })

  it('rejects request to protected path with no token', async () => {
    const req = makeRequest('GET', '/api/agent/data')
    const res = await middleware(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })

  it('rejects request with an invalid token', async () => {
    const req = makeRequest('GET', '/api/agent', undefined, { 'x-agent-proof': 'bad.token.here' })
    const res = await middleware(req)
    expect(res!.status).toBe(403)
  })

  it('passes through when token is valid', async () => {
    // Get challenge, solve, verify, get proof token
    const mw2 = createNextMiddleware({ secret: SECRET, protectedPaths: ['/api/agent'] })

    const challengeRes = await mw2(makeRequest('GET', '/imrobot/challenge'))
    const challenge = JSON.parse(await challengeRes!.text()) as Parameters<typeof solveChallenge>[0]
    const answer = solveChallenge(challenge)
    const verifyRes = await mw2(makeRequest('POST', '/imrobot/verify', { challenge, answer }))
    const { proofToken } = JSON.parse(await verifyRes!.text()) as { proofToken: string }

    const protectedReq = makeRequest('GET', '/api/agent', undefined, { 'x-agent-proof': proofToken })
    const result = await mw2(protectedReq)
    // null means pass-through (allow request to continue)
    expect(result).toBeNull()
  })
})

// ── createNextApiHandler ──────────────────────────────────────────────────

describe('createNextApiHandler — GET returns challenge', () => {
  const handler = createNextApiHandler({ secret: SECRET })

  it('GET returns a challenge', async () => {
    const req = makeApiReq('GET')
    const res = makeApiRes()
    await handler(req, res)
    expect(res.statusCode).toBe(200)
    const data = res.body as Record<string, unknown>
    expect(data).toHaveProperty('id')
    expect(data).toHaveProperty('hmac')
  })
})

describe('createNextApiHandler — POST verifies answer', () => {
  const handler = createNextApiHandler({ secret: SECRET })

  it('POST with correct answer returns proofToken', async () => {
    // Get challenge via handler
    const challengeReq = makeApiReq('GET')
    const challengeRes = makeApiRes()
    await handler(challengeReq, challengeRes)
    const challenge = challengeRes.body as Parameters<typeof solveChallenge>[0]
    const answer = solveChallenge(challenge)

    const verifyReq = makeApiReq('POST', { challenge, answer })
    const verifyRes = makeApiRes()
    await handler(verifyReq, verifyRes)
    expect(verifyRes.statusCode).toBe(200)
    const data = verifyRes.body as Record<string, unknown>
    expect(data.valid).toBe(true)
    expect(typeof data.proofToken).toBe('string')
  })

  it('POST with wrong answer returns 403', async () => {
    const challengeReq = makeApiReq('GET')
    const challengeRes = makeApiRes()
    await handler(challengeReq, challengeRes)
    const challenge = challengeRes.body

    const verifyReq = makeApiReq('POST', { challenge, answer: 'nope' })
    const verifyRes = makeApiRes()
    await handler(verifyReq, verifyRes)
    expect(verifyRes.statusCode).toBe(403)
  })

  it('POST with missing body returns 400', async () => {
    const req = makeApiReq('POST', {})
    const res = makeApiRes()
    await handler(req, res)
    expect(res.statusCode).toBe(400)
  })

  it('DELETE returns 405', async () => {
    const req = makeApiReq('DELETE')
    const res = makeApiRes()
    await handler(req, res)
    expect(res.statusCode).toBe(405)
  })
})
