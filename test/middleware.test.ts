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

// ── IP normalization ─────────────────────────────────────────────────

describe('IP normalization for rate-limit keys', () => {
  it('treats ::ffff:127.0.0.1 and 127.0.0.1 as the same client', async () => {
    const issuer = new ProofTokenIssuer({ secret: TEST_SECRET })
    const token = await issuer.issue({
      agentId: 'agent',
      challengeId: 'ch',
      difficulty: 'easy',
      solveTimeMs: 1,
      suspicious: false,
    })

    const middleware = requireAgent({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60_000, maxRequests: 1 },
    })

    // First request — IPv4-mapped IPv6
    await middleware(
      mockReq({ headers: { 'x-agent-proof': token }, ip: '::ffff:192.168.1.1' }),
      mockRes(),
      vi.fn(),
    )

    // Second request from the *same* logical IP in plain IPv4 form must be limited
    const res = mockRes()
    await middleware(
      mockReq({ headers: { 'x-agent-proof': token }, ip: '192.168.1.1' }),
      res,
      vi.fn(),
    )

    expect(res.statusCode).toBe(429)
  })

  it('treats ::1 and 127.0.0.1 as the same client', async () => {
    const issuer = new ProofTokenIssuer({ secret: TEST_SECRET })
    const token = await issuer.issue({
      agentId: 'agent',
      challengeId: 'ch',
      difficulty: 'easy',
      solveTimeMs: 1,
      suspicious: false,
    })

    const middleware = requireAgent({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60_000, maxRequests: 1 },
    })

    await middleware(
      mockReq({ headers: { 'x-agent-proof': token }, ip: '::1' }),
      mockRes(),
      vi.fn(),
    )

    const res = mockRes()
    await middleware(
      mockReq({ headers: { 'x-agent-proof': token }, ip: '127.0.0.1' }),
      res,
      vi.fn(),
    )

    expect(res.statusCode).toBe(429)
  })
})

// ── Key rotation (kid) ───────────────────────────────────────────────

describe('proof-token key rotation', () => {
  it('accepts tokens signed with a previous secret if its kid is registered', async () => {
    const oldSecret = 'old-secret-at-least-16-chars-aaa'
    const newSecret = 'new-secret-at-least-16-chars-bbb'

    // Token issued under the OLD key
    const oldIssuer = new ProofTokenIssuer({
      secret: oldSecret,
      keyId: 'k-2025-12',
      issuer: 'imrobot',
    })
    const token = await oldIssuer.issue({
      agentId: 'agent',
      challengeId: 'ch',
      difficulty: 'easy',
      solveTimeMs: 1,
      suspicious: false,
    })

    // Middleware on the NEW key, with the old key registered as a previous secret
    const middleware = requireAgent({
      secret: newSecret,
      keyId: 'k-2026-04',
      previousSecrets: [{ keyId: 'k-2025-12', secret: oldSecret }],
    })

    const next = vi.fn()
    const res = mockRes()
    await middleware(mockReq({ headers: { 'x-agent-proof': token } }), res, next)

    expect(next).toHaveBeenCalled()
    expect(res.statusCode).toBe(0)
  })

  it('rejects tokens whose kid is not registered', async () => {
    const oldSecret = 'old-secret-at-least-16-chars-aaa'
    const newSecret = 'new-secret-at-least-16-chars-bbb'

    const oldIssuer = new ProofTokenIssuer({
      secret: oldSecret,
      keyId: 'k-rogue',
      issuer: 'imrobot',
    })
    const token = await oldIssuer.issue({
      agentId: 'agent',
      challengeId: 'ch',
      difficulty: 'easy',
      solveTimeMs: 1,
      suspicious: false,
    })

    const middleware = requireAgent({
      secret: newSecret,
      keyId: 'k-2026-04',
      // No previousSecrets — k-rogue is unknown
    })

    const next = vi.fn()
    const res = mockRes()
    await middleware(mockReq({ headers: { 'x-agent-proof': token } }), res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(403)
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

  it('emits X-RateLimit-Reset as seconds-since-epoch (RFC convention)', async () => {
    const router = createAgentRouter({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60_000, maxRequests: 5 },
    })

    const req = mockReq({ method: 'GET' })
    const res = mockRes()
    await router.handler(req as any, res)

    const reset = res.headersSent['X-RateLimit-Reset']
    expect(typeof reset).toBe('number')
    const nowSec = Math.floor(Date.now() / 1000)
    // Must be within (now, now + 70) seconds — proves it's seconds, not ms
    expect(reset as number).toBeGreaterThan(nowSec)
    expect(reset as number).toBeLessThan(nowSec + 70)
  })

  it('emits X-RateLimit-Reset as seconds even on 429', async () => {
    const router = createAgentRouter({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60_000, maxRequests: 1 },
    })

    await router.handler(mockReq({ method: 'GET' }) as any, mockRes())
    const res = mockRes()
    await router.handler(mockReq({ method: 'GET' }) as any, res)

    expect(res.statusCode).toBe(429)
    const reset = res.headersSent['X-RateLimit-Reset']
    expect(typeof reset).toBe('number')
    const nowSec = Math.floor(Date.now() / 1000)
    expect(reset as number).toBeGreaterThan(nowSec)
    expect(reset as number).toBeLessThan(nowSec + 70)
    expect(res.headersSent['Retry-After']).toBeGreaterThan(0)
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

// ── createAgentRouter.destroy() ───────────────────────────────────────

describe('createAgentRouter — destroy', () => {
  it('returns a destroy function', () => {
    const router = createAgentRouter({ secret: TEST_SECRET })
    expect(typeof router.destroy).toBe('function')
  })

  it('destroy() does not throw when no rate limiter is configured', () => {
    const router = createAgentRouter({ secret: TEST_SECRET })
    expect(() => router.destroy()).not.toThrow()
  })

  it('destroy() does not throw when a rate limiter is configured', () => {
    const router = createAgentRouter({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60_000, maxRequests: 10 },
    })
    expect(() => router.destroy()).not.toThrow()
  })

  it('destroy() is idempotent — safe to call multiple times', () => {
    const router = createAgentRouter({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60_000, maxRequests: 10 },
    })
    expect(() => {
      router.destroy()
      router.destroy()
      router.destroy()
    }).not.toThrow()
  })

  it('destroy() clears the rate limiter cleanup interval', () => {
    vi.useFakeTimers()

    const router = createAgentRouter({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 1_000, maxRequests: 5 },
    })

    const setIntervalSpy = vi.spyOn(global, 'clearInterval')
    router.destroy()

    expect(setIntervalSpy).toHaveBeenCalled()

    vi.useRealTimers()
    setIntervalSpy.mockRestore()
  })
})

// ── createAgentRouter — Turnstile ────────────────────────────────────

describe('createAgentRouter — Turnstile', () => {
  it('returns 400 when turnstile.required is true and no cf-turnstile-response header is present', async () => {
    const router = createAgentRouter({
      secret: TEST_SECRET,
      turnstile: { secretKey: 'fake-turnstile-secret-key-minimum-xx', required: true },
    })

    // Obtain a valid challenge + answer
    const challengeRes = mockRes()
    await router.handler(mockReq({ method: 'GET' }) as any, challengeRes)
    const challenge = challengeRes.body as Record<string, unknown>

    const { solveChallenge } = await import('../src/core/solver')
    const answer = solveChallenge(challenge as any)

    const verifyReq = { ...mockReq({ method: 'POST' }), body: { challenge, answer } }
    const verifyRes = mockRes()
    await router.handler(verifyReq as any, verifyRes)

    expect(verifyRes.statusCode).toBe(400)
    expect((verifyRes.body as Record<string, string>).code).toBe('TURNSTILE_TOKEN_REQUIRED')
  })

  it('succeeds when turnstile.required is false and no cf-turnstile-response header is present', async () => {
    const router = createAgentRouter({
      secret: TEST_SECRET,
      turnstile: { secretKey: 'fake-turnstile-secret-key-minimum-xx', required: false },
    })

    // Obtain a valid challenge + answer
    const challengeRes = mockRes()
    await router.handler(mockReq({ method: 'GET' }) as any, challengeRes)
    const challenge = challengeRes.body as Record<string, unknown>

    const { solveChallenge } = await import('../src/core/solver')
    const answer = solveChallenge(challenge as any)

    const verifyReq = { ...mockReq({ method: 'POST' }), body: { challenge, answer } }
    const verifyRes = mockRes()
    await router.handler(verifyReq as any, verifyRes)

    // Turnstile not required — missing token is tolerated, verification succeeds
    expect(verifyRes.statusCode).toBe(200)
    expect((verifyRes.body as Record<string, unknown>).valid).toBe(true)
  })
})
