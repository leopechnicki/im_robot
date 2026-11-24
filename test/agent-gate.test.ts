import { describe, it, expect } from 'vitest'
import {
  GateError,
  imrobotTools,
  passGate,
  solveChallengeInput,
  SOLVE_LIMITS,
  PASS_GATE_TOOL_NAME,
  SOLVE_TOOL_NAME,
} from '../src/agent'
import {
  createHonoAgentRouter,
  requireAgentHono,
  type HonoContext,
  type HonoHandler,
  type HonoRouterLike,
} from '../src/hono'
import { buildDiscoveryDocument } from '../src/server/discovery'
import { createVerifier } from '../src/server/verifier'
import { solveChallenge } from '../src/core/solver'
import { createMCPServer } from '../src/mcp'

const SECRET = 'g'.repeat(8) + '-agent-gate-test-secret'
const SITE = 'https://shop.imrobot-gate.dev'

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Just enough of Hono to run the real imrobot Hono adapter in-process
 * (the suite stays free of a hono dependency, like test/hono.test.ts).
 */
class MiniApp implements HonoRouterLike {
  private routes = new Map<string, HonoHandler>()
  get(path: string, handler: HonoHandler) {
    this.routes.set('GET ' + path, handler)
  }
  post(path: string, handler: HonoHandler) {
    this.routes.set('POST ' + path, handler)
  }
  async fetch(req: Request): Promise<Response> {
    const handler = this.routes.get(req.method + ' ' + new URL(req.url).pathname)
    if (!handler) return new Response('not found', { status: 404 })
    const headers = new Headers()
    const state = new Map<string, unknown>()
    let status = 200
    const ctx: HonoContext = {
      req: {
        header: (name) => req.headers.get(name) ?? undefined,
        json: async <T>() => (await req.clone().json()) as T,
        url: req.url,
        method: req.method,
        raw: req,
      },
      json: (body, s) => Response.json(body, { status: s ?? status, headers }),
      text: (body, s) => new Response(body, { status: s ?? status, headers }),
      status: (s) => {
        status = s
      },
      header: (name, value) => headers.set(name, value),
      set: (key, value) => state.set(key, value),
      get: <T>(key: string) => state.get(key) as T,
    }
    return handler(ctx)
  }
}

/** A real imrobot site (Hono adapter) served in-process. */
function site(opts: { discovery?: boolean; basePath?: string } = {}) {
  const app = new MiniApp()
  const basePath = opts.basePath ?? '/imrobot'
  createHonoAgentRouter({ secret: SECRET }).mount(app, basePath)
  if (opts.discovery !== false) {
    app.get('/.well-known/imrobot.json', (c) =>
      c.json(buildDiscoveryDocument({ challengePath: basePath })),
    )
  }
  const guard = requireAgentHono({ secret: SECRET })
  app.get('/api/data', async (c) => (await guard(c, async () => {})) ?? c.json({ ok: true }))
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchFn: FetchFn = async (input, init) => {
    calls.push({ url: input, init })
    return app.fetch(new Request(input, init))
  }
  return { app, fetch: fetchFn, calls }
}

describe('passGate', () => {
  it('discovers, solves and returns a token the site accepts', async () => {
    const s = site({ basePath: '/agents' })
    const r = await passGate(SITE + '/some/page', { fetch: s.fetch })
    expect(r.source).toBe('discovery')
    expect(r.proofHeader).toBe('X-Agent-Proof')
    expect(r.verifyUrl).toBe(SITE + '/agents/verify')
    const res = await s.app.fetch(
      new Request(SITE + '/api/data', { headers: { [r.proofHeader]: r.proofToken } }),
    )
    expect(res.status).toBe(200)
    // No redirects are followed.
    expect(s.calls.every((c) => c.init?.redirect === 'manual')).toBe(true)
  })

  it('accepts the challenge endpoint itself', async () => {
    const s = site({ discovery: false, basePath: '/x/gate' })
    const r = await passGate(SITE + '/x/gate/challenge', { fetch: s.fetch })
    expect(r.source).toBe('url')
    expect(r.verifyUrl).toBe(SITE + '/x/gate/verify')
  })

  it('falls back to the default mount without a discovery document', async () => {
    const s = site({ discovery: false })
    const r = await passGate(SITE, { fetch: s.fetch })
    expect(r.source).toBe('default')
    expect(r.proofToken.split('.')).toHaveLength(3)
  })

  it('forwards agentId', async () => {
    const s = site()
    await passGate(SITE, { fetch: s.fetch, agentId: 'my-agent' })
    const post = s.calls.find((c) => c.init?.method === 'POST')
    expect(JSON.parse(String(post?.init?.body)).agentId).toBe('my-agent')
  })

  it('refuses private and local hosts unless allowed', async () => {
    const s = site()
    for (const url of [
      'http://127.0.0.1:3000',
      'http://localhost',
      'http://10.0.0.5',
      'http://[::1]/',
    ]) {
      await expect(passGate(url, { fetch: s.fetch })).rejects.toMatchObject({
        code: 'private_host',
      })
    }
    const r = await passGate('http://localhost:3000', { fetch: s.fetch, allowPrivateHosts: true })
    expect(r.proofToken).toBeTruthy()
  })

  it('refuses non-http(s) URLs and credentials', async () => {
    await expect(passGate('file:///etc/passwd')).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(passGate('not a url')).rejects.toMatchObject({ code: 'invalid_url' })
    await expect(passGate('https://u:p@shop.imrobot-gate.dev')).rejects.toMatchObject({
      code: 'invalid_url',
    })
  })

  it('refuses discovery endpoints on another origin', async () => {
    for (const challenge of ['https://evil.example/c', '//evil.example/c', 'relative/c']) {
      const fetchFn: FetchFn = async () =>
        Response.json({
          protocol: 'imrobot',
          endpoints: { challenge, verify: '/v', proofHeader: 'X-Agent-Proof' },
        })
      await expect(passGate(SITE, { fetch: fetchFn })).rejects.toMatchObject({
        code: 'bad_response',
      })
    }
  })

  it('reports the server reason when the answer is refused', async () => {
    const v = createVerifier({ secret: SECRET })
    const fetchFn: FetchFn = async (input, init) => {
      if (input.endsWith('/.well-known/imrobot.json')) return new Response('nope', { status: 404 })
      if (init?.method === 'POST')
        return Response.json({ valid: false, reason: 'too_fast' }, { status: 400 })
      return Response.json(await v.generate())
    }
    const err = await passGate(SITE, { fetch: fetchFn }).catch((e) => e)
    expect(err).toBeInstanceOf(GateError)
    expect(err.code).toBe('rejected')
    expect(err.reason).toBe('too_fast')
    expect(err.status).toBe(400)
  })

  it('refuses a redirect instead of following it', async () => {
    const fetchFn: FetchFn = async (input) => {
      if (input.endsWith('/.well-known/imrobot.json')) return new Response(null, { status: 404 })
      return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
    }
    await expect(passGate(SITE, { fetch: fetchFn })).rejects.toMatchObject({
      code: 'bad_response',
      status: 302,
    })
  })

  it('caps response size', async () => {
    let enqueued = 0
    const endless = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          enqueued += 64 * 1024
          controller.enqueue(new Uint8Array(64 * 1024).fill(0x78))
        },
      })
    const fetchFn: FetchFn = async (input) => {
      if (input.endsWith('/.well-known/imrobot.json')) return new Response(null, { status: 404 })
      return new Response(endless(), { status: 200 })
    }
    await expect(passGate(SITE, { fetch: fetchFn })).rejects.toMatchObject({
      code: 'bad_response',
      message: expect.stringContaining('too large'),
    })
    // Stopped reading soon after the 256 kB cap instead of draining the stream.
    expect(enqueued).toBeLessThan(1024 * 1024)
    // A declared Content-Length over the cap is refused before reading.
    const declared: FetchFn = async (input) => {
      if (input.endsWith('/.well-known/imrobot.json')) return new Response(null, { status: 404 })
      return new Response('{}', { status: 200, headers: { 'content-length': '999999999' } })
    }
    await expect(passGate(SITE, { fetch: declared })).rejects.toMatchObject({
      message: expect.stringContaining('too large'),
    })
  })

  it('times out', async () => {
    const fetchFn: FetchFn = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    await expect(passGate(SITE, { fetch: fetchFn, timeoutMs: 20 })).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('times out on a body that stalls after the headers', async () => {
    const fetchFn: FetchFn = async (input) => {
      if (input.endsWith('/.well-known/imrobot.json')) return new Response(null, { status: 404 })
      // Headers arrive, then one byte and nothing more (a slow-loris body).
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{'))
        },
      })
      return new Response(body, { status: 200 })
    }
    const started = Date.now()
    await expect(passGate(SITE, { fetch: fetchFn, timeoutMs: 50 })).rejects.toMatchObject({
      code: 'timeout',
    })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('refuses a hostile pipeline instead of hanging or allocating', async () => {
    for (const pipeline of [
      [{ op: 'repeat', times: 500_000_000 }],
      [{ op: 'hash_chain', rounds: 10_000_000_000 }],
      [{ op: 'pad_start', length: 1e9, fill: 'x' }],
      [{ op: 'replace', search: '', replacement: 'x'.repeat(100_000) }],
      [{ op: 'byte_xor', key: new Array(5000).fill(1) }],
      // Each step doubles: refused once a value passes the limit.
      new Array(30).fill({ op: 'repeat', times: 2 }),
      new Array(40).fill({ op: 'reverse' }),
    ]) {
      const fetchFn: FetchFn = async (input) => {
        if (input.endsWith('/.well-known/imrobot.json')) return new Response(null, { status: 404 })
        return Response.json({ id: 'x', seed: 'abcdefgh', pipeline })
      }
      const started = Date.now()
      await expect(passGate(SITE, { fetch: fetchFn })).rejects.toMatchObject({
        code: 'unsupported_challenge',
      })
      expect(Date.now() - started).toBeLessThan(2000)
    }
  })

  it('rejects a non-challenge body', async () => {
    const fetchFn: FetchFn = async (input) => {
      if (input.endsWith('/.well-known/imrobot.json')) return new Response(null, { status: 404 })
      return Response.json({ hello: 'world' })
    }
    await expect(passGate(SITE, { fetch: fetchFn })).rejects.toMatchObject({
      code: 'bad_response',
    })
  })
})

describe('solveChallengeInput', () => {
  it('solves an object or its JSON text', async () => {
    const c = await createVerifier({ secret: SECRET }).generate()
    expect(solveChallengeInput(c)).toBe(solveChallenge(c))
    expect(solveChallengeInput(JSON.stringify(c))).toBe(solveChallenge(c))
  })

  it('solves real pipelines of every difficulty within SOLVE_LIMITS', async () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const v = createVerifier({ secret: SECRET, difficulty, sha256: true })
      for (let i = 0; i < 30; i++) {
        const c = await v.generate()
        expect(solveChallengeInput(c)).toBe(solveChallenge(c))
      }
    }
    expect(SOLVE_LIMITS.maxOperations).toBeGreaterThanOrEqual(8)
  })

  it('names an unknown operation', () => {
    expect(() =>
      solveChallengeInput({ id: 'a', seed: 'b', pipeline: [{ op: 'quantum_teleport' }] }),
    ).toThrow(GateError)
  })
})

describe('imrobotTools', () => {
  it('exposes two tools with JSON Schemas', () => {
    const tools = imrobotTools()
    expect(tools.map((t) => t.name)).toEqual([PASS_GATE_TOOL_NAME, SOLVE_TOOL_NAME])
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(t.inputSchema.type).toBe('object')
      expect(t.description.length).toBeGreaterThan(40)
    }
  })

  it('pass-gate returns the token as JSON and errors as JSON (never throws)', async () => {
    const s = site()
    const [pass] = imrobotTools({ fetch: s.fetch })
    const ok = JSON.parse(await pass.execute({ url: SITE }))
    expect(ok.proofToken).toBeTruthy()
    expect(ok.proofHeader).toBe('X-Agent-Proof')
    const bad = JSON.parse(await pass.execute({ url: 'http://127.0.0.1' }))
    expect(bad.error).toBe('private_host')
    const missing = JSON.parse(await pass.execute({}))
    expect(missing.error).toBe('invalid_url')
  })

  it('solve returns the answer', async () => {
    const c = await createVerifier({ secret: SECRET }).generate()
    const [, solve] = imrobotTools()
    expect(JSON.parse(await solve.execute({ challenge: c })).answer).toBe(solveChallenge(c))
    expect(JSON.parse(await solve.execute({ challenge: '{' })).error).toBe('bad_response')
  })
})

describe('MCP pass-gate tool', () => {
  it('is listed and passes a site', async () => {
    const s = site()
    const server = createMCPServer({ gate: { fetch: s.fetch } })
    const list = JSON.parse(
      await server.handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })),
    )
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('pass-gate')
    const call = JSON.parse(
      await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'pass-gate', arguments: { url: SITE } },
        }),
      ),
    )
    expect(call.result.isError).toBeFalsy()
    expect(JSON.parse(call.result.content[0].text).proofToken).toBeTruthy()
  })

  it('returns a tool error for a private host by default', async () => {
    const server = createMCPServer()
    const call = JSON.parse(
      await server.handleMessage(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'pass-gate', arguments: { url: 'http://localhost:8080' } },
        }),
      ),
    )
    expect(call.result.isError).toBe(true)
    expect(call.result.content[0].text).toContain('private')
  })
})
