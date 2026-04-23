/**
 * Tests for Cloudflare Turnstile integration (BP-001).
 *
 * Covers:
 * 1. TurnstileVerifier — successful verification
 * 2. TurnstileVerifier — Cloudflare returns success:false
 * 3. TurnstileVerifier — network failure (fetch throws)
 * 4. verifyTurnstileToken — standalone function
 * 5. createAgentRouter — required:true with missing header → 400
 * 6. createAgentRouter — required:false with missing header → token issued without flag
 * 7. createAgentRouter — Turnstile verified, flag present in proof token
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { TurnstileVerifier, verifyTurnstileToken } from '../src/server/turnstile'
import { createAgentRouter } from '../src/server/middleware'
import { ProofTokenIssuer } from '../src/server/proof-token'
import type { MiddlewareRequest, MiddlewareResponse } from '../src/server/middleware'
import { solveChallenge } from '../src/core/solver'

// ─── helpers ────────────────────────────────────────────────────────────────

const SECRET = 'turnstile-test-secret-16chars!!'

function mockFetch(response: object, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      json: async () => response,
    }),
  )
}

function mockFetchThrows(message = 'Network failure'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error(message)),
  )
}

function createMockRes(): MiddlewareResponse & {
  statusCode: number
  body: unknown
} {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    setHeader(_name: string, _value: string | number) {},
    json(body: unknown) {
      res.body = body
    },
  }
  return res
}

/**
 * Build a MiddlewareRequest with a valid solved imrobot challenge body.
 * Used to hit the verify endpoint through createAgentRouter.
 */
async function buildVerifyRequest(
  extraHeaders: Record<string, string> = {},
): Promise<MiddlewareRequest & { body?: { challenge: unknown; answer: string; agentId?: string } }> {
  // We need a real challenge + answer to get past verifier.verify()
  const { ImRobotVerifier } = await import('../src/server/verifier')
  const verifier = new ImRobotVerifier({ secret: SECRET })
  const challenge = await verifier.generate()
  const answer = solveChallenge(challenge)

  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: { challenge, answer, agentId: 'test-agent' },
  }
}

// ─── 1. TurnstileVerifier — successful verification ─────────────────────────

describe('TurnstileVerifier — successful verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns success:true when Cloudflare responds success:true', async () => {
    mockFetch({
      success: true,
      hostname: 'example.com',
      challenge_ts: '2026-04-22T12:00:00Z',
      'error-codes': [],
    })

    const verifier = new TurnstileVerifier({ secretKey: 'test-secret-key' })
    const result = await verifier.verify('cf-token-abc', '10.0.0.1')

    expect(result.success).toBe(true)
    expect(result.hostname).toBe('example.com')
    expect(result.challenge_ts).toBe('2026-04-22T12:00:00Z')
  })

  it('sends secret, response, and remoteip as form-encoded body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const verifier = new TurnstileVerifier({ secretKey: 'my-secret' })
    await verifier.verify('my-token', '1.2.3.4')

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')

    const body = new URLSearchParams(init.body as string)
    expect(body.get('secret')).toBe('my-secret')
    expect(body.get('response')).toBe('my-token')
    expect(body.get('remoteip')).toBe('1.2.3.4')
  })

  it('omits remoteip when not provided', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const verifier = new TurnstileVerifier({ secretKey: 'my-secret' })
    await verifier.verify('my-token')

    const [, init] = fetchSpy.mock.calls[0]
    const body = new URLSearchParams(init.body as string)
    expect(body.has('remoteip')).toBe(false)
  })

  it('throws when secretKey is empty', () => {
    expect(() => new TurnstileVerifier({ secretKey: '' })).toThrow(/secretKey/)
  })
})

// ─── 2. TurnstileVerifier — Cloudflare returns success:false ────────────────

describe('TurnstileVerifier — Cloudflare returns success:false', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns success:false and includes errorCodes', async () => {
    mockFetch({
      success: false,
      'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
    })

    const verifier = new TurnstileVerifier({ secretKey: 'test-secret-key' })
    const result = await verifier.verify('bad-token')

    expect(result.success).toBe(false)
    expect(result.errorCodes).toEqual(['invalid-input-response', 'timeout-or-duplicate'])
  })
})

// ─── 3. TurnstileVerifier — network failure ─────────────────────────────────

describe('TurnstileVerifier — network failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns success:false with network-error code when fetch throws', async () => {
    mockFetchThrows('ECONNREFUSED')

    const verifier = new TurnstileVerifier({ secretKey: 'test-secret-key' })
    const result = await verifier.verify('any-token')

    expect(result.success).toBe(false)
    expect(result.errorCodes).toContain('network-error')
  })
})

// ─── 4. verifyTurnstileToken — standalone function ──────────────────────────

describe('verifyTurnstileToken — standalone function', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('works identically to TurnstileVerifier.verify', async () => {
    mockFetch({
      success: true,
      hostname: 'standalone.example.com',
    })

    const result = await verifyTurnstileToken('sk-standalone', 'tok-abc', '5.6.7.8')

    expect(result.success).toBe(true)
    expect(result.hostname).toBe('standalone.example.com')
  })
})

// ─── 5. createAgentRouter — required:true, missing header → 400 ─────────────

describe('createAgentRouter — turnstile.required:true, missing token', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 400 when turnstile header is absent and required:true', async () => {
    const router = createAgentRouter({
      secret: SECRET,
      turnstile: {
        secretKey: 'ts-secret',
        required: true,
      },
    })

    const req = await buildVerifyRequest() // no turnstile header
    const res = createMockRes()

    await router.verify(req, res)

    expect(res.statusCode).toBe(400)
    expect((res.body as { code: string }).code).toBe('TURNSTILE_TOKEN_REQUIRED')
  })

  it('returns 400 when Cloudflare verification fails and required:true', async () => {
    mockFetch({ success: false, 'error-codes': ['invalid-input-response'] })

    const router = createAgentRouter({
      secret: SECRET,
      turnstile: {
        secretKey: 'ts-secret',
        required: true,
      },
    })

    const req = await buildVerifyRequest({ 'cf-turnstile-response': 'bad-token' })
    const res = createMockRes()

    await router.verify(req, res)

    expect(res.statusCode).toBe(400)
    expect((res.body as { code: string }).code).toBe('TURNSTILE_VERIFICATION_FAILED')
  })
})

// ─── 6. createAgentRouter — required:false, missing header → token without flag

describe('createAgentRouter — turnstile.required:false, missing token', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('issues proof token without turnstile_verified when header is absent', async () => {
    const router = createAgentRouter({
      secret: SECRET,
      turnstile: {
        secretKey: 'ts-secret',
        required: false, // default
      },
    })

    const req = await buildVerifyRequest() // no turnstile header
    const res = createMockRes()

    await router.verify(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { valid: boolean; proofToken: string }
    expect(body.valid).toBe(true)

    const decoded = ProofTokenIssuer.decode(body.proofToken)
    expect(decoded).not.toBeNull()
    // turnstile_verified should NOT be present when header is absent
    expect(decoded!.imr.turnstile_verified).toBeUndefined()
  })

  it('issues proof token with turnstile_verified:false when token fails and required:false', async () => {
    mockFetch({ success: false, 'error-codes': ['timeout-or-duplicate'] })

    const router = createAgentRouter({
      secret: SECRET,
      turnstile: {
        secretKey: 'ts-secret',
        required: false,
      },
    })

    const req = await buildVerifyRequest({ 'cf-turnstile-response': 'expired-token' })
    const res = createMockRes()

    await router.verify(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { valid: boolean; proofToken: string }
    expect(body.valid).toBe(true)

    const decoded = ProofTokenIssuer.decode(body.proofToken)
    expect(decoded).not.toBeNull()
    expect(decoded!.imr.turnstile_verified).toBe(false)
  })
})

// ─── 7. createAgentRouter — successful Turnstile → flag in proof token ───────

describe('createAgentRouter — Turnstile verified, flag in proof token', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets turnstile_verified:true in proof token payload when Cloudflare confirms', async () => {
    mockFetch({
      success: true,
      hostname: 'myapp.example.com',
      challenge_ts: '2026-04-22T10:00:00Z',
      'error-codes': [],
    })

    const router = createAgentRouter({
      secret: SECRET,
      turnstile: {
        secretKey: 'ts-secret',
        required: true,
      },
    })

    const req = await buildVerifyRequest({ 'cf-turnstile-response': 'valid-cf-token' })
    const res = createMockRes()

    await router.verify(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { valid: boolean; proofToken: string }
    expect(body.valid).toBe(true)

    const decoded = ProofTokenIssuer.decode(body.proofToken)
    expect(decoded).not.toBeNull()
    expect(decoded!.imr.turnstile_verified).toBe(true)
  })

  it('issues token without turnstile_verified when Turnstile is not configured', async () => {
    // No turnstile config at all
    const router = createAgentRouter({ secret: SECRET })

    const req = await buildVerifyRequest()
    const res = createMockRes()

    await router.verify(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { valid: boolean; proofToken: string }

    const decoded = ProofTokenIssuer.decode(body.proofToken)
    expect(decoded).not.toBeNull()
    expect(decoded!.imr.turnstile_verified).toBeUndefined()
  })
})
