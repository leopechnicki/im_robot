/**
 * Tests for the Hono adapter (`imrobot/hono`).
 *
 * We DO NOT depend on Hono at test time — instead we synthesize a minimal
 * mock `Context` that matches our documented structural type. This keeps the
 * test suite dep-free (matches the "zero deps" positioning).
 */
import { describe, it, expect } from 'vitest'
import {
  createHonoAgentRouter,
  requireAgentHono,
  type HonoContext,
  type HonoRouterLike,
} from '../src/hono/index'
import { solveChallenge } from '../src/core/solver'
import type { SignedChallenge } from '../src/core/types'

const SECRET = 'test-secret-at-least-sixteen-chars-ok'

// ---------------------------------------------------------------------------
// Minimal mock HonoContext factory.
// ---------------------------------------------------------------------------

interface MockCtxOpts {
  headers?: Record<string, string>
  jsonBody?: unknown
  method?: string
  url?: string
}

interface MockCtx {
  ctx: HonoContext
  captured: {
    responseBody: unknown
    responseStatus: number
    responseHeaders: Record<string, string>
    state: Record<string, unknown>
  }
}

function makeCtx(opts: MockCtxOpts = {}): MockCtx {
  const headers = opts.headers ?? {}
  const captured = {
    responseBody: undefined as unknown,
    responseStatus: 200,
    responseHeaders: {} as Record<string, string>,
    state: {} as Record<string, unknown>,
  }
  const ctx: HonoContext = {
    req: {
      header(name: string) {
        return headers[name] ?? headers[name.toLowerCase()]
      },
      async json<T>() {
        if (opts.jsonBody === undefined) throw new Error('no body')
        return opts.jsonBody as T
      },
      url: opts.url ?? 'http://localhost/',
      method: opts.method ?? 'GET',
      raw: new Request(opts.url ?? 'http://localhost/'),
    },
    json(body: unknown, status = 200) {
      captured.responseBody = body
      captured.responseStatus = status
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    },
    text(body: string, status = 200) {
      captured.responseBody = body
      captured.responseStatus = status
      return new Response(body, { status })
    },
    status(s: number) {
      captured.responseStatus = s
    },
    header(name: string, value: string) {
      captured.responseHeaders[name] = value
    },
    set(key: string, value: unknown) {
      captured.state[key] = value
    },
    get<T = unknown>(key: string) {
      return captured.state[key] as T
    },
  }
  return { ctx, captured }
}

// ---------------------------------------------------------------------------
// createHonoAgentRouter — challenge + verify handlers
// ---------------------------------------------------------------------------

describe('createHonoAgentRouter', () => {
  it('challenge handler returns a signed challenge as JSON', async () => {
    const router = createHonoAgentRouter({ secret: SECRET })
    const { ctx, captured } = makeCtx()
    const res = await router.challenge(ctx)
    expect(res.status).toBe(200)
    const body = captured.responseBody as SignedChallenge
    expect(body).toBeDefined()
    expect(body.hmac).toBeDefined()
    expect(body.id).toHaveLength(16)
    expect(body.pipeline.length).toBeGreaterThan(0)
  })

  it('verify handler issues a proof token for a correct answer', async () => {
    const router = createHonoAgentRouter({ secret: SECRET })

    // First get a challenge
    const { ctx: c1, captured: cap1 } = makeCtx()
    await router.challenge(c1)
    const challenge = cap1.responseBody as SignedChallenge
    const answer = solveChallenge(challenge)

    // Then verify
    const { ctx: c2, captured: cap2 } = makeCtx({
      method: 'POST',
      jsonBody: { challenge, answer },
    })
    const res = await router.verify(c2)
    expect(res.status).toBe(200)
    const body = cap2.responseBody as { valid: boolean; proofToken: string }
    expect(body.valid).toBe(true)
    expect(body.proofToken).toBeDefined()
    expect(cap2.responseHeaders['X-Agent-Proof']).toBe(body.proofToken)
  })

  it('verify rejects a malformed body with 400', async () => {
    const router = createHonoAgentRouter({ secret: SECRET })
    const { ctx, captured } = makeCtx({
      method: 'POST',
      jsonBody: { garbage: true },
    })
    const res = await router.verify(ctx)
    expect(res.status).toBe(400)
    expect(captured.responseStatus).toBe(400)
    expect((captured.responseBody as { reason: string }).reason).toBe('missing_fields')
  })

  it('verify handles invalid json with 400', async () => {
    const router = createHonoAgentRouter({ secret: SECRET })
    // jsonBody undefined causes req.json() to throw
    const { ctx, captured } = makeCtx({ method: 'POST' })
    const res = await router.verify(ctx)
    expect(res.status).toBe(400)
    expect((captured.responseBody as { reason: string }).reason).toBe('invalid_json')
  })

  it('verify rejects a wrong answer with 400', async () => {
    const router = createHonoAgentRouter({ secret: SECRET })
    const { ctx: c1, captured: cap1 } = makeCtx()
    await router.challenge(c1)
    const challenge = cap1.responseBody as SignedChallenge

    const { ctx: c2, captured: cap2 } = makeCtx({
      method: 'POST',
      jsonBody: { challenge, answer: 'nope' },
    })
    const res = await router.verify(c2)
    expect(res.status).toBe(400)
    expect((cap2.responseBody as { valid: boolean }).valid).toBe(false)
  })

  it('mount() wires challenge + verify onto a HonoRouterLike', () => {
    const router = createHonoAgentRouter({ secret: SECRET })
    const seen: Array<{ method: string; path: string }> = []
    const mockApp: HonoRouterLike = {
      get: (path) => (seen.push({ method: 'GET', path }), mockApp),
      post: (path) => (seen.push({ method: 'POST', path }), mockApp),
    }
    router.mount(mockApp, '/imrobot')
    expect(seen).toContainEqual({ method: 'GET', path: '/imrobot/challenge' })
    expect(seen).toContainEqual({ method: 'POST', path: '/imrobot/verify' })
  })

  it('mount() strips trailing slash on basePath', () => {
    const router = createHonoAgentRouter({ secret: SECRET })
    const seen: Array<{ method: string; path: string }> = []
    const mockApp: HonoRouterLike = {
      get: (path) => (seen.push({ method: 'GET', path }), mockApp),
      post: (path) => (seen.push({ method: 'POST', path }), mockApp),
    }
    router.mount(mockApp, '/api/imrobot/')
    expect(seen).toContainEqual({ method: 'GET', path: '/api/imrobot/challenge' })
    expect(seen).toContainEqual({ method: 'POST', path: '/api/imrobot/verify' })
  })
})

// ---------------------------------------------------------------------------
// requireAgentHono — gate middleware
// ---------------------------------------------------------------------------

describe('requireAgentHono', () => {
  it('returns 401 when token header is missing', async () => {
    const mw = requireAgentHono({ secret: SECRET })
    const { ctx, captured } = makeCtx()
    let nextCalled = false
    const res = await mw(ctx, async () => {
      nextCalled = true
    })
    expect(res).toBeDefined()
    expect(captured.responseStatus).toBe(401)
    expect((captured.responseBody as { error: string }).error).toBe('agent_proof_required')
    expect(nextCalled).toBe(false)
  })

  it('returns 401 when token is invalid', async () => {
    const mw = requireAgentHono({ secret: SECRET })
    const { ctx, captured } = makeCtx({ headers: { 'X-Agent-Proof': 'nope.nope.nope' } })
    let nextCalled = false
    await mw(ctx, async () => {
      nextCalled = true
    })
    expect(captured.responseStatus).toBe(401)
    expect((captured.responseBody as { error: string }).error).toBe('agent_proof_invalid')
    expect(nextCalled).toBe(false)
  })

  it('calls next() and stashes payload when token is valid', async () => {
    const router = createHonoAgentRouter({ secret: SECRET })

    // Issue a token
    const { ctx: c1, captured: cap1 } = makeCtx()
    await router.challenge(c1)
    const challenge = cap1.responseBody as SignedChallenge
    const answer = solveChallenge(challenge)

    const { ctx: c2, captured: cap2 } = makeCtx({
      method: 'POST',
      jsonBody: { challenge, answer },
    })
    await router.verify(c2)
    const token = (cap2.responseBody as { proofToken: string }).proofToken

    // Use it to pass the gate
    const mw = requireAgentHono({ secret: SECRET })
    const { ctx: c3, captured: cap3 } = makeCtx({ headers: { 'X-Agent-Proof': token } })
    let nextCalled = false
    await mw(c3, async () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
    expect(cap3.state.agentProof).toBeDefined()
    expect(cap3.state.agentVerified).toBe(true)
  })

  it('respects a bypass() function', async () => {
    const mw = requireAgentHono({
      secret: SECRET,
      bypass: () => true,
    })
    const { ctx } = makeCtx()
    let nextCalled = false
    await mw(ctx, async () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
  })

  it('uses a custom contextKey when provided', async () => {
    const router = createHonoAgentRouter({ secret: SECRET })
    const { ctx: c1, captured: cap1 } = makeCtx()
    await router.challenge(c1)
    const challenge = cap1.responseBody as SignedChallenge
    const answer = solveChallenge(challenge)

    const { ctx: c2, captured: cap2 } = makeCtx({
      method: 'POST',
      jsonBody: { challenge, answer },
    })
    await router.verify(c2)
    const token = (cap2.responseBody as { proofToken: string }).proofToken

    const mw = requireAgentHono({ secret: SECRET, contextKey: 'myProof' })
    const { ctx: c3, captured: cap3 } = makeCtx({ headers: { 'X-Agent-Proof': token } })
    await mw(c3, async () => {})
    expect(cap3.state.myProof).toBeDefined()
    expect(cap3.state.agentProof).toBeUndefined()
  })

  it('uses a custom headerName when provided', async () => {
    const router = createHonoAgentRouter({ secret: SECRET, proofHeader: 'X-Bot-Proof' })
    const { ctx: c1, captured: cap1 } = makeCtx()
    await router.challenge(c1)
    const challenge = cap1.responseBody as SignedChallenge
    const answer = solveChallenge(challenge)

    const { ctx: c2, captured: cap2 } = makeCtx({
      method: 'POST',
      jsonBody: { challenge, answer },
    })
    await router.verify(c2)
    // response header uses the custom name too
    expect(cap2.responseHeaders['X-Bot-Proof']).toBeDefined()
    const token = (cap2.responseBody as { proofToken: string }).proofToken

    const mw = requireAgentHono({ secret: SECRET, headerName: 'X-Bot-Proof' })
    const { ctx: c3, captured: cap3 } = makeCtx({ headers: { 'X-Bot-Proof': token } })
    let nextCalled = false
    await mw(c3, async () => {
      nextCalled = true
    })
    expect(nextCalled).toBe(true)
    expect(cap3.state.agentVerified).toBe(true)
  })
})
