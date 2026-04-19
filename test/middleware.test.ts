import { describe, it, expect, vi, beforeEach } from 'vitest'
import { requireAgent, createAgentRouter } from '../src/server/middleware'
import { ProofTokenIssuer } from '../src/server/proof-token'
import type { MiddlewareRequest, MiddlewareResponse, NextFunction } from '../src/server/middleware'

const TEST_SECRET = 'test-secret-at-least-16-chars-long'

// ── Helpers ──────────────────────────────────────────────────────────

function mockReq(overrides: Partial<MiddlewareRequest> = {}): MiddlewareRequest {
  return {
    headers: {},
    ip: '127.0.0.1',
    method: 'GET',
    url: '/',
    ...overrides,
  }
}

function mockRes(): MiddlewareResponse & {
  statusCode: number
  body: unknown
  headersSent: Record<string, string | number>
} {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headersSent: {} as Record<string, string | number>,
    status(code: number) {
      res.statusCode = code
      return res
    },
    setHeader(name: string, value: string | number) {
      res.headersSent[name] = value
    },
    json(body: unknown) {
      res.body = body
    },
  }
  return res
}

// ── requireAgent ─────────────────────────────────────────────────────

describe('requireAgent', () => {
  let issuer: ProofTokenIssuer

  beforeEach(() => {
    issuer = new ProofTokenIssuer({ secret: TEST_SECRET })
  })

  it('rejects requests without X-Agent-Proof header', async () => {
    const middleware = requireAgent({ secret: TEST_SECRET })
    const req = mockReq()
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.statusCode).toBe(401)
    expect((res.body as Record<string, string>).code).toBe('AGENT_PROOF_REQUIRED')
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects requests with invalid proof token', async () => {
    const middleware = requireAgent({ secret: TEST_SECRET })
    const req = mockReq({ headers: { 'x-agent-proof': 'bad-token' } })
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.statusCode).toBe(403)
    expect((res.body as Record<string, string>).code).toBe('AGENT_PROOF_INVALID')
    expect(next).not.toHaveBeenCalled()
  })

  it('allows requests with valid proof token', async () => {
    const token = await issuer.issue({
      agentId: 'test-agent',
      challengeId: 'ch_1234',
      difficulty: 'medium',
      solveTimeMs: 50,
      suspicious: false,
    })

    const middleware = requireAgent({ secret: TEST_SECRET })
    const req = mockReq({ headers: { 'x-agent-proof': token } })
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
    expect((req as Record<string, unknown>).agentVerified).toBe(true)
    expect((req as Record<string, unknown>).agentProof).toBeDefined()
  })

  it('respects custom header name', async () => {
    const token = await issuer.issue({
      agentId: 'test-agent',
      challengeId: 'ch_1234',
      difficulty: 'medium',
      solveTimeMs: 50,
      suspicious: false,
    })

    const middleware = requireAgent({ secret: TEST_SECRET, headerName: 'X-Custom-Proof' })
    const req = mockReq({ headers: { 'x-custom-proof': token } })
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('calls bypass function and skips verification when it returns true', async () => {
    const middleware = requireAgent({
      secret: TEST_SECRET,
      bypass: () => true,
    })
    const req = mockReq()
    const res = mockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('applies rate limiting when configured', async () => {
    const middleware = requireAgent({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60000, maxRequests: 2 },
    })

    const token = await issuer.issue({
      agentId: 'test-agent',
      challengeId: 'ch_1234',
      difficulty: 'medium',
      solveTimeMs: 50,
      suspicious: false,
    })

    // First two requests should succeed
    for (let i = 0; i < 2; i++) {
      const req = mockReq({ headers: { 'x-agent-proof': token } })
      const res = mockRes()
      const next = vi.fn()
      await middleware(req, res, next)
      expect(next).toHaveBeenCalled()
    }

    // Third request should be rate limited
    const req = mockReq({ headers: { 'x-agent-proof': token } })
    const res = mockRes()
    const next = vi.fn()
    await middleware(req, res, next)

    expect(res.statusCode).toBe(429)
    expect((res.body as Record<string, string>).code).toBe('RATE_LIMIT_EXCEEDED')
    expect(next).not.toHaveBeenCalled()
  })
})

// ── IP spoofing protection (trustProxy) ──────────────────────────────

describe('IP spoofing protection', () => {
  it('ignores X-Forwarded-For when trustProxy is false (default)', async () => {
    const middleware = requireAgent({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60000, maxRequests: 1 },
    })

    const issuer = new ProofTokenIssuer({ secret: TEST_SECRET })
    const token = await issuer.issue({
      agentId: 'agent',
      challengeId: 'ch',
      difficulty: 'medium',
      solveTimeMs: 10,
      suspicious: false,
    })

    // First request from IP 10.0.0.1
    const req1 = mockReq({
      headers: { 'x-agent-proof': token, 'x-forwarded-for': 'spoofed-ip-1' },
      ip: '10.0.0.1',
    })
    const res1 = mockRes()
    await middleware(req1, res1, vi.fn())
    // Should succeed (first request)

    // Second request: different XFF but same req.ip
    // With trustProxy=false, this should be rate limited because req.ip is the same
    const req2 = mockReq({
      headers: { 'x-agent-proof': token, 'x-forwarded-for': 'spoofed-ip-2' },
      ip: '10.0.0.1',
    })
    const res2 = mockRes()
    const next2 = vi.fn()
    await middleware(req2, res2, next2)

    expect(res2.statusCode).toBe(429)
    expect(next2).not.toHaveBeenCalled()
  })

  it('uses X-Forwarded-For when trustProxy is true', async () => {
    const middleware = requireAgent({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60000, maxRequests: 1 },
      trustProxy: true,
    })

    const issuer = new ProofTokenIssuer({ secret: TEST_SECRET })
    const token = await issuer.issue({
      agentId: 'agent',
      challengeId: 'ch',
      difficulty: 'medium',
      solveTimeMs: 10,
      suspicious: false,
    })

    // First request with XFF
    const req1 = mockReq({
      headers: { 'x-agent-proof': token, 'x-forwarded-for': 'proxy-client-1' },
      ip: '10.0.0.1',
    })
    const res1 = mockRes()
    await middleware(req1, res1, vi.fn())

    // Second request with different XFF (different "client") — should NOT be rate limited
    const req2 = mockReq({
      headers: { 'x-agent-proof': token, 'x-forwarded-for': 'proxy-client-2' },
      ip: '10.0.0.1',
    })
    const res2 = mockRes()
    const next2 = vi.fn()
    await middleware(req2, res2, next2)

    expect(next2).toHaveBeenCalled()
  })
})

// ── createAgentRouter ────────────────────────────────────────────────

describe('createAgentRouter', () => {
  it('returns challenge, verify, and handler functions', () => {
    const router = createAgentRouter({ secret: TEST_SECRET })
    expect(typeof router.challenge).toBe('function')
    expect(typeof router.verify).toBe('function')
    expect(typeof router.handler).toBe('function')
  })

  it('handler routes GET to challenge endpoint', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })
    const req = mockReq({ method: 'GET' })
    const res = mockRes()

    await router.handler(req as any, res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toBeDefined()
    const body = res.body as Record<string, unknown>
    expect(body.id).toBeDefined()
    expect(body.pipeline).toBeDefined()
    expect(body.hmac).toBeDefined()
  })

  it('handler routes POST to verify endpoint', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })

    // First get a challenge
    const challengeReq = mockReq({ method: 'GET' })
    const challengeRes = mockRes()
    await router.handler(challengeReq as any, challengeRes)
    const challenge = challengeRes.body as Record<string, unknown>

    // Import solver to get the right answer
    const { solveChallenge } = await import('../src/core/solver')
    const answer = solveChallenge(challenge as any)

    // Now verify
    const verifyReq = {
      ...mockReq({ method: 'POST' }),
      body: { challenge, answer, agentId: 'test-agent' },
    }
    const verifyRes = mockRes()
    await router.handler(verifyReq as any, verifyRes)

    expect(verifyRes.statusCode).toBe(200)
    const result = verifyRes.body as Record<string, unknown>
    expect(result.valid).toBe(true)
    expect(result.proofToken).toBeDefined()
  })

  it('handler returns 400 for POST without body', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })
    const req = { ...mockReq({ method: 'POST' }), body: {} }
    const res = mockRes()

    await router.handler(req as any, res)

    expect(res.statusCode).toBe(400)
    expect((res.body as Record<string, string>).code).toBe('BAD_REQUEST')
  })

  it('handler returns 405 for unsupported methods', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })
    const req = mockReq({ method: 'PUT' })
    const res = mockRes()

    await router.handler(req as any, res)

    expect(res.statusCode).toBe(405)
    expect((res.body as Record<string, string>).code).toBe('METHOD_NOT_ALLOWED')
  })

  it('handler calls next() for unsupported methods when next is provided', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })
    const req = mockReq({ method: 'DELETE' })
    const res = mockRes()
    const next = vi.fn()

    await router.handler(req as any, res, next)

    expect(next).toHaveBeenCalled()
  })

  it('applies rate limiting to challenge endpoint', async () => {
    const router = createAgentRouter({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60000, maxRequests: 2 },
    })

    // Two requests should work
    for (let i = 0; i < 2; i++) {
      const req = mockReq({ method: 'GET' })
      const res = mockRes()
      await router.handler(req as any, res)
      expect(res.statusCode).toBe(200)
    }

    // Third should be rate limited
    const req = mockReq({ method: 'GET' })
    const res = mockRes()
    await router.handler(req as any, res)
    expect(res.statusCode).toBe(429)
  })

  it('verify endpoint rejects wrong answer', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })

    // Get challenge
    const challengeReq = mockReq({ method: 'GET' })
    const challengeRes = mockRes()
    await router.handler(challengeReq as any, challengeRes)
    const challenge = challengeRes.body

    // Submit wrong answer
    const verifyReq = {
      ...mockReq({ method: 'POST' }),
      body: { challenge, answer: 'wrong-answer' },
    }
    const verifyRes = mockRes()
    await router.handler(verifyReq as any, verifyRes)

    expect(verifyRes.statusCode).toBe(403)
    expect((verifyRes.body as Record<string, unknown>).valid).toBe(false)
  })
})
