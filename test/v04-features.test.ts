import { describe, it, expect } from 'vitest'
import { executeOperation, executePipeline, formatOperation } from '../src/core/operations'
import { generateChallenge, verifyAnswer } from '../src/core/challenge'
import { solveChallenge } from '../src/core/solver'
import { ProofTokenIssuer, createTokenIssuer } from '../src/server/proof-token'
import { createVerifier } from '../src/server/verifier'
import { requireAgent, createAgentRouter } from '../src/server/middleware'
import type { Operation } from '../src/core/types'

const TEST_SECRET = 'test-secret-at-least-16-chars-long'

// ── New Crypto Operations ────────────────────────────────────────────

describe('sha256_hash operation', () => {
  it('produces a 64-char hex string', () => {
    const result = executeOperation('hello', { op: 'sha256_hash' })
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const a = executeOperation('test', { op: 'sha256_hash' })
    const b = executeOperation('test', { op: 'sha256_hash' })
    expect(a).toBe(b)
  })

  it('different inputs produce different hashes', () => {
    const a = executeOperation('hello', { op: 'sha256_hash' })
    const b = executeOperation('world', { op: 'sha256_hash' })
    expect(a).not.toBe(b)
  })
})

describe('byte_xor operation', () => {
  it('XORs with key array cycling', () => {
    const result = executeOperation('AB', { op: 'byte_xor', key: [1, 2] })
    // 'A' = 65, 65^1 = 64 = '@'
    // 'B' = 66, 66^2 = 64 = '@'
    expect(result).toBe('@@')
  })

  it('is reversible', () => {
    const input = 'hello world'
    const key = [42, 13, 7]
    const encoded = executeOperation(input, { op: 'byte_xor', key })
    const decoded = executeOperation(encoded, { op: 'byte_xor', key })
    expect(decoded).toBe(input)
  })

  it('handles single-byte key', () => {
    const result = executeOperation('AB', { op: 'byte_xor', key: [1] })
    expect(result).toBe('@C')
  })
})

describe('hash_chain operation', () => {
  it('returns 8-char hex after chaining', () => {
    const result = executeOperation('test', { op: 'hash_chain', rounds: 3 })
    expect(result).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is deterministic', () => {
    const a = executeOperation('test', { op: 'hash_chain', rounds: 5 })
    const b = executeOperation('test', { op: 'hash_chain', rounds: 5 })
    expect(a).toBe(b)
  })

  it('different rounds produce different results', () => {
    const a = executeOperation('test', { op: 'hash_chain', rounds: 2 })
    const b = executeOperation('test', { op: 'hash_chain', rounds: 3 })
    expect(a).not.toBe(b)
  })
})

describe('nibble_swap operation', () => {
  it('swaps high and low nibbles', () => {
    // 'A' = 0x41 -> swap -> 0x14 = 20 (non-printable, but valid)
    const result = executeOperation('A', { op: 'nibble_swap' })
    expect(result.charCodeAt(0)).toBe(0x14)
  })

  it('is reversible (self-inverse)', () => {
    const input = 'test123'
    const swapped = executeOperation(input, { op: 'nibble_swap' })
    const restored = executeOperation(swapped, { op: 'nibble_swap' })
    expect(restored).toBe(input)
  })
})

describe('bit_rotate operation', () => {
  it('rotates bits left', () => {
    // 0x41 = 01000001, rotate left 1 = 10000010 = 0x82
    const result = executeOperation('A', { op: 'bit_rotate', bits: 1 })
    expect(result.charCodeAt(0)).toBe(0x82)
  })

  it('full rotation returns original', () => {
    const input = 'hello'
    const rotated = executeOperation(input, { op: 'bit_rotate', bits: 8 })
    expect(rotated).toBe(input)
  })

  it('is reversible with complement rotation', () => {
    const input = 'test'
    const rotated = executeOperation(input, { op: 'bit_rotate', bits: 3 })
    const restored = executeOperation(rotated, { op: 'bit_rotate', bits: -3 })
    expect(restored).toBe(input)
  })
})

describe('formatOperation for new ops', () => {
  it('formats sha256_hash', () => {
    expect(formatOperation({ op: 'sha256_hash' })).toBe('sha256_hash()')
  })
  it('formats byte_xor', () => {
    expect(formatOperation({ op: 'byte_xor', key: [1, 2, 3] })).toBe('byte_xor([1,2,3])')
  })
  it('formats hash_chain', () => {
    expect(formatOperation({ op: 'hash_chain', rounds: 5 })).toBe('hash_chain(5)')
  })
  it('formats nibble_swap', () => {
    expect(formatOperation({ op: 'nibble_swap' })).toBe('nibble_swap()')
  })
  it('formats bit_rotate', () => {
    expect(formatOperation({ op: 'bit_rotate', bits: 3 })).toBe('bit_rotate(3)')
  })
})

// ── New Ops in Challenge Generation ──────────────────────────────────

describe('hard challenges with new ops', () => {
  it('generates and solves 50 hard challenges (includes new crypto ops)', () => {
    for (let i = 0; i < 50; i++) {
      const challenge = generateChallenge({ difficulty: 'hard' })
      const answer = solveChallenge(challenge)
      expect(verifyAnswer(challenge, answer)).toBe(true)
    }
  })
})

// ── Proof Token Issuer ───────────────────────────────────────────────

describe('ProofTokenIssuer', () => {
  it('creates with valid config', () => {
    expect(() => createTokenIssuer({ secret: TEST_SECRET })).not.toThrow()
  })

  it('throws for short secret', () => {
    expect(() => createTokenIssuer({ secret: 'short' })).toThrow()
  })

  it('issues a valid token', async () => {
    const issuer = createTokenIssuer({ secret: TEST_SECRET, issuer: 'test' })
    const token = await issuer.issue({
      agentId: 'agent_123',
      challengeId: 'ch_abc',
      difficulty: 'hard',
      solveTimeMs: 42,
      suspicious: false,
    })

    expect(token).toContain('.')
    const parts = token.split('.')
    expect(parts.length).toBe(3)
  })

  it('verifies its own tokens', async () => {
    const issuer = createTokenIssuer({ secret: TEST_SECRET, issuer: 'test' })
    const token = await issuer.issue({
      agentId: 'agent_123',
      challengeId: 'ch_abc',
      difficulty: 'medium',
      solveTimeMs: 100,
      suspicious: false,
    })

    const result = await issuer.verify(token)
    expect(result.valid).toBe(true)
    expect(result.payload?.sub).toBe('agent_123')
    expect(result.payload?.imr.difficulty).toBe('medium')
    expect(result.payload?.imr.solve_time_ms).toBe(100)
  })

  it('rejects tokens from different secret', async () => {
    const issuer1 = createTokenIssuer({ secret: 'secret-one-long-enough', issuer: 'test' })
    const issuer2 = createTokenIssuer({ secret: 'secret-two-long-enough', issuer: 'test' })

    const token = await issuer1.issue({
      agentId: 'agent_123',
      challengeId: 'ch_abc',
      difficulty: 'easy',
      solveTimeMs: 10,
      suspicious: false,
    })

    const result = await issuer2.verify(token)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_signature')
  })

  it('rejects expired tokens', async () => {
    const issuer = createTokenIssuer({
      secret: TEST_SECRET,
      issuer: 'test',
      tokenTTL: 1, // 1ms TTL
    })

    const token = await issuer.issue({
      agentId: 'agent_123',
      challengeId: 'ch_abc',
      difficulty: 'easy',
      solveTimeMs: 10,
      suspicious: false,
    })

    // Wait for expiration
    await new Promise((r) => setTimeout(r, 10))

    const result = await issuer.verify(token)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('expired')
  })

  it('rejects malformed tokens', async () => {
    const issuer = createTokenIssuer({ secret: TEST_SECRET })
    const result = await issuer.verify('not.a.valid.token')
    expect(result.valid).toBe(false)
  })

  it('rejects tokens from different issuer', async () => {
    const issuer1 = createTokenIssuer({ secret: TEST_SECRET, issuer: 'issuer-a' })
    const issuer2 = createTokenIssuer({ secret: TEST_SECRET, issuer: 'issuer-b' })

    const token = await issuer1.issue({
      agentId: 'agent_123',
      challengeId: 'ch_abc',
      difficulty: 'easy',
      solveTimeMs: 10,
      suspicious: false,
    })

    const result = await issuer2.verify(token)
    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_issuer')
  })

  it('static decode reads claims without verification', async () => {
    const issuer = createTokenIssuer({ secret: TEST_SECRET, issuer: 'test' })
    const token = await issuer.issue({
      agentId: 'agent_xyz',
      challengeId: 'ch_123',
      difficulty: 'hard',
      solveTimeMs: 5,
      suspicious: false,
    })

    const decoded = ProofTokenIssuer.decode(token)
    expect(decoded).not.toBeNull()
    expect(decoded!.sub).toBe('agent_xyz')
    expect(decoded!.imr.difficulty).toBe('hard')
  })
})

// ── End-to-End: Challenge → Solve → Verify → Proof Token ────────────

describe('end-to-end proof token flow', () => {
  it('full flow: generate → solve → verify → issue proof → verify proof', async () => {
    const verifier = createVerifier({ secret: TEST_SECRET })
    const tokenIssuer = createTokenIssuer({ secret: TEST_SECRET, issuer: 'e2e-test' })

    // 1. Generate signed challenge
    const challenge = await verifier.generate({ difficulty: 'hard' })

    // 2. Agent solves
    const answer = solveChallenge(challenge)

    // 3. Server verifies
    const result = await verifier.verify(challenge, answer)
    expect(result.valid).toBe(true)

    // 4. Issue proof token
    const proof = await tokenIssuer.issue({
      agentId: 'agent_e2e',
      challengeId: challenge.id,
      difficulty: challenge.difficulty,
      solveTimeMs: result.elapsed ?? 0,
      suspicious: result.suspicious ?? false,
    })

    // 5. Verify proof token
    const proofResult = await tokenIssuer.verify(proof)
    expect(proofResult.valid).toBe(true)
    expect(proofResult.payload?.sub).toBe('agent_e2e')
    expect(proofResult.payload?.imr.challenge_id).toBe(challenge.id)
  })
})

// ── Middleware ────────────────────────────────────────────────────────

describe('requireAgent middleware', () => {
  it('creates a middleware function', () => {
    const mw = requireAgent({ secret: TEST_SECRET })
    expect(typeof mw).toBe('function')
  })

  it('rejects requests without token', async () => {
    const mw = requireAgent({ secret: TEST_SECRET })
    let statusCode = 0
    let responseBody: unknown = null

    const req = { headers: {} }
    const res = {
      status(code: number) { statusCode = code; return this },
      json(body: unknown) { responseBody = body },
    }
    const next = () => {}

    await mw(req, res, next)
    expect(statusCode).toBe(401)
    expect((responseBody as Record<string, string>).code).toBe('AGENT_PROOF_REQUIRED')
  })

  it('rejects requests with invalid token', async () => {
    const mw = requireAgent({ secret: TEST_SECRET })
    let statusCode = 0

    const req = { headers: { 'x-agent-proof': 'invalid-token' } }
    const res = {
      status(code: number) { statusCode = code; return this },
      json() {},
    }
    const next = () => {}

    await mw(req, res, next)
    expect(statusCode).toBe(403)
  })

  it('accepts valid proof token', async () => {
    const mw = requireAgent({ secret: TEST_SECRET, issuer: 'mw-test' })
    const issuer = createTokenIssuer({ secret: TEST_SECRET, issuer: 'mw-test' })

    const token = await issuer.issue({
      agentId: 'agent_mw',
      challengeId: 'ch_mw',
      difficulty: 'medium',
      solveTimeMs: 50,
      suspicious: false,
    })

    let nextCalled = false
    const req: Record<string, unknown> = { headers: { 'x-agent-proof': token } }
    const res = {
      status() { return this },
      json() {},
    }
    const next = () => { nextCalled = true }

    await mw(req as any, res, next)
    expect(nextCalled).toBe(true)
    expect(req.agentVerified).toBe(true)
  })

  it('respects bypass function', async () => {
    const mw = requireAgent({
      secret: TEST_SECRET,
      bypass: (req) => req.url === '/health',
    })

    let nextCalled = false
    const req = { headers: {}, url: '/health' }
    const res = { status() { return this }, json() {} }
    const next = () => { nextCalled = true }

    await mw(req, res, next)
    expect(nextCalled).toBe(true)
  })

  it('enforces rate limiting', async () => {
    const mw = requireAgent({
      secret: TEST_SECRET,
      rateLimit: { windowMs: 60000, maxRequests: 2 },
    })

    const issuer = createTokenIssuer({ secret: TEST_SECRET })
    const token = await issuer.issue({
      agentId: 'rate-test',
      challengeId: 'ch_rate',
      difficulty: 'easy',
      solveTimeMs: 10,
      suspicious: false,
    })

    const makeReq = () => ({
      headers: { 'x-agent-proof': token },
      ip: '127.0.0.1',
    })

    let statusCode = 0
    const res = {
      status(code: number) { statusCode = code; return this },
      json() {},
    }

    // First two should pass
    await mw(makeReq(), res, () => {})
    await mw(makeReq(), res, () => {})

    // Third should be rate limited
    statusCode = 0
    await mw(makeReq(), res, () => {})
    expect(statusCode).toBe(429)
  })
})

// ── createAgentRouter ────────────────────────────────────────────────

describe('createAgentRouter', () => {
  it('challenge handler returns a signed challenge', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })

    let statusCode = 0
    let body: unknown = null

    const req = { headers: {} }
    const res = {
      status(code: number) { statusCode = code; return this },
      json(b: unknown) { body = b },
    }

    await router.challenge(req, res)
    expect(statusCode).toBe(200)
    expect((body as Record<string, unknown>).hmac).toBeDefined()
    expect((body as Record<string, unknown>).pipeline).toBeDefined()
  })

  it('verify handler validates correct answer and returns proof token', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })

    // First get a challenge
    let challenge: any = null
    await router.challenge(
      { headers: {} },
      { status() { return this }, json(b: unknown) { challenge = b } },
    )

    // Solve it
    const answer = solveChallenge(challenge)

    let statusCode = 0
    let body: unknown = null

    await router.verify(
      {
        headers: {},
        body: { challenge, answer, agentId: 'test_agent' },
      },
      {
        status(code: number) { statusCode = code; return this },
        json(b: unknown) { body = b },
      },
    )

    expect(statusCode).toBe(200)
    expect((body as Record<string, unknown>).valid).toBe(true)
    expect((body as Record<string, unknown>).proofToken).toBeDefined()
  })

  it('verify handler rejects wrong answer', async () => {
    const router = createAgentRouter({ secret: TEST_SECRET })

    let challenge: any = null
    await router.challenge(
      { headers: {} },
      { status() { return this }, json(b: unknown) { challenge = b } },
    )

    let statusCode = 0
    await router.verify(
      {
        headers: {},
        body: { challenge, answer: 'wrong' },
      },
      {
        status(code: number) { statusCode = code; return this },
        json() {},
      },
    )

    expect(statusCode).toBe(403)
  })
})
