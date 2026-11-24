// @vitest-environment node
/**
 * Web Bot Auth end to end: the `imrobot/agent` signer against our verifier,
 * directory fetch hardening (redirects, size cap, stale cache), SSRF guard,
 * and the "valid signed agent skips the challenge" policy in every adapter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WEB_BOT_AUTH_ACCEPT_SIGNATURE,
  WebBotAuthVerifier,
  evaluateWebBotAuth,
  isPrivateHost,
  normalizeAuthority,
} from '../src/server/web-bot-auth'
import {
  buildKeyDirectory,
  createKeyDirectoryHandler,
  createSignedFetch,
  generateAgentKey,
  signRequest,
} from '../src/agent'
import type { AgentKey } from '../src/agent'
import { requireAgent } from '../src/server/middleware'
import type { MiddlewareRequest, MiddlewareResponse } from '../src/server/middleware'
import { requireAgentHono } from '../src/hono/index'
import type { HonoContext } from '../src/hono/index'
import { createNextMiddleware } from '../src/next/middleware'

// Test-only HMAC key, built at runtime.
const HMAC_KEY = 'k'.repeat(32)
const AGENT = 'https://agent.example'
const SITE = 'https://site.example/api/data?x=1'

/** A fetch that serves the agent's signed key directory from `handler`. */
function agentHost(key: AgentKey, opts: { signed?: boolean } = {}) {
  const handler = createKeyDirectoryHandler({ privateJwks: [key.privateJwk] })
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(String(url))
    const res = await handler(new Request(String(url)))
    if (opts.signed === false) {
      return new Response(await res.text(), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return res
  }) as unknown as typeof fetch
  return { f, calls }
}

async function signedHeaders(key: AgentKey, url = SITE, extra: Record<string, unknown> = {}) {
  return signRequest({ method: 'GET', url }, { privateJwk: key.privateJwk, signatureAgent: AGENT, ...extra })
}

function lower(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('imrobot/agent -> verifier round trip', () => {
  it('a generated key, its published directory and a signed request verify', async () => {
    const key = await generateAgentKey()
    expect(key.publicJwk.kid).toBe(key.keyid)
    expect('d' in key.publicJwk).toBe(false)
    const { f, calls } = agentHost(key)
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: f })
    const r = await v.verify({
      method: 'GET',
      url: '/api/data?x=1',
      headers: { host: 'site.example', ...lower(await signedHeaders(key)) },
    })
    expect(r).toMatchObject({ verified: true, outcome: 'verified', keyid: key.keyid })
    expect(calls[0]).toBe(`${AGENT}/.well-known/http-message-signatures-directory`)
  })

  it('requireSignedDirectory accepts our signed directory and rejects an unsigned one', async () => {
    const key = await generateAgentKey()
    const headers = { host: 'site.example', ...lower(await signedHeaders(key)) }
    const ok = new WebBotAuthVerifier({
      trustedSignatureAgents: [AGENT],
      fetch: agentHost(key).f,
      requireSignedDirectory: true,
    })
    expect((await ok.verify({ headers })).verified).toBe(true)
    const bad = new WebBotAuthVerifier({
      trustedSignatureAgents: [AGENT],
      fetch: agentHost(key, { signed: false }).f,
      requireSignedDirectory: true,
    })
    expect(await bad.verify({ headers })).toMatchObject({ verified: false, reason: 'unknown_key' })
  })

  it('a key that is not in the directory is unknown_key', async () => {
    const published = await generateAgentKey()
    const rogue = await generateAgentKey()
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: agentHost(published).f })
    const r = await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(rogue)) } })
    expect(r).toMatchObject({ verified: false, outcome: 'unverified', reason: 'unknown_key' })
  })

  it('covers extra components when asked and fails on tampering', async () => {
    const key = await generateAgentKey()
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: agentHost(key).f })
    const sig = await signRequest(
      { method: 'POST', url: SITE, headers: { 'content-type': 'application/json' } },
      { privateJwk: key.privateJwk, signatureAgent: AGENT, components: ['@method', '@path', 'content-type'] },
    )
    const base = {
      method: 'POST',
      url: '/api/data?x=1',
      headers: { host: 'site.example', 'content-type': 'application/json', ...lower(sig) },
    }
    expect((await v.verify(base)).verified).toBe(true)
    const v2 = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: agentHost(key).f })
    expect(await v2.verify({ ...base, method: 'PUT' })).toMatchObject({ verified: false, reason: 'bad_signature' })
  })

  it('createSignedFetch signs outgoing requests', async () => {
    const key = await generateAgentKey()
    let seen: Request | undefined
    const sink = (async (r: Request) => {
      seen = r
      return new Response('ok')
    }) as unknown as typeof fetch
    const signedFetch = createSignedFetch({ privateJwk: key.privateJwk, signatureAgent: AGENT, fetch: sink })
    await signedFetch(SITE)
    expect(seen!.headers.get('signature-agent')).toBe(`sig1="${AGENT}"`)
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: agentHost(key).f })
    const headers: Record<string, string> = { host: 'site.example' }
    seen!.headers.forEach((val, k) => {
      headers[k] = val
    })
    expect((await v.verify({ headers })).verified).toBe(true)
  })

  it('buildKeyDirectory strips private material', async () => {
    const key = await generateAgentKey()
    const dir = await buildKeyDirectory([key.privateJwk])
    expect(dir.keys).toHaveLength(1)
    expect(JSON.stringify(dir)).not.toContain(key.privateJwk.d)
  })
})

describe('directory fetch hardening', () => {
  it('does not follow redirects', async () => {
    const key = await generateAgentKey()
    const f = (async () =>
      new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: f })
    const r = await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect(r).toMatchObject({ verified: false, outcome: 'unverified', reason: 'directory_error' })
  })

  it('passes redirect: manual to fetch', async () => {
    const key = await generateAgentKey()
    const inits: RequestInit[] = []
    const handler = createKeyDirectoryHandler({ privateJwks: [key.privateJwk] })
    const f = (async (url: string, init: RequestInit) => {
      inits.push(init)
      return handler(new Request(url))
    }) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: f })
    await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect(inits[0].redirect).toBe('manual')
  })

  it('rejects an oversized directory', async () => {
    const key = await generateAgentKey()
    const huge = JSON.stringify({ keys: [key.publicJwk], pad: 'x'.repeat(70_000) })
    const f = (async () => new Response(huge, { status: 200 })) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: f })
    const r = await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect(r).toMatchObject({ verified: false, reason: 'directory_error' })
  })

  it('a failed refetch keeps the cached keys (no eviction)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-24T12:00:00Z'))
    const key = await generateAgentKey()
    const handler = createKeyDirectoryHandler({ privateJwks: [key.privateJwk], maxAgeSeconds: 60 })
    let up = true
    let fetches = 0
    const f = (async (url: string) => {
      fetches++
      return up ? handler(new Request(url)) : new Response('down', { status: 503 })
    }) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: f, nonceStore: false })
    const verifyNow = async () => v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect((await verifyNow()).verified).toBe(true)
    up = false
    vi.setSystemTime(new Date('2026-11-24T12:05:00Z'))
    expect((await verifyNow()).verified).toBe(true)
    expect(fetches).toBe(2)
  })

  it('negative-caches an unreachable directory', async () => {
    const key = await generateAgentKey()
    let fetches = 0
    const f = (async () => {
      fetches++
      return new Response('down', { status: 503 })
    }) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: f })
    await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect(fetches).toBe(1)
  })
})

describe('Signature-Agent trust', () => {
  it('isPrivateHost flags loopback, private, link-local and internal names', () => {
    const priv = [
      'localhost',
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.1',
      '172.16.5.4',
      '169.254.169.254',
      '[::1]',
      'fd00::1',
      'printer.local',
      'svc.internal',
      '0.0.0.0',
    ]
    for (const h of priv) expect(isPrivateHost(h), h).toBe(true)
    for (const h of ['agent.example', '8.8.8.8', '172.32.0.1', 'example.com']) expect(isPrivateHost(h), h).toBe(false)
  })

  it('allowAnySignatureAgent still refuses private hosts (SSRF)', async () => {
    const key = await generateAgentKey()
    let fetched = false
    const f = (async () => {
      fetched = true
      return new Response('{}')
    }) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ allowAnySignatureAgent: true, fetch: f })
    const sig = await signRequest(
      { url: SITE },
      { privateJwk: key.privateJwk, signatureAgent: 'https://169.254.169.254' },
    )
    const r = await v.verify({ headers: { host: 'site.example', ...lower(sig) } })
    expect(r).toMatchObject({ verified: false, reason: 'untrusted_agent' })
    expect(fetched).toBe(false)
  })

  it('an agent that is not on the allow-list is never fetched', async () => {
    const key = await generateAgentKey()
    let fetched = false
    const f = (async () => {
      fetched = true
      return new Response('{}')
    }) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: ['https://other.example'], fetch: f })
    const r = await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect(r).toMatchObject({ verified: false, outcome: 'unverified', reason: 'untrusted_agent' })
    expect(fetched).toBe(false)
  })

  it('requires a key source', () => {
    expect(() => new WebBotAuthVerifier({})).toThrow()
  })
})

// ---------------------------------------------------------------------------
// Adapters: valid signed agent => skip challenge, else challenge
// ---------------------------------------------------------------------------

function expressRes() {
  const res = {
    statusCode: 0,
    body: null as unknown,
    headers: {} as Record<string, string | number>,
    status(code: number) {
      res.statusCode = code
      return res
    },
    setHeader(name: string, value: string | number) {
      res.headers[name] = value
    },
    json(body: unknown) {
      res.body = body
    },
  }
  return res as MiddlewareResponse & typeof res
}

describe('Express requireAgent + webBotAuth', () => {
  it('a valid signed agent skips the proof token', async () => {
    const key = await generateAgentKey()
    const guard = requireAgent({
      secret: HMAC_KEY,
      webBotAuth: { trustedSignatureAgents: [AGENT], authorities: ['site.example'], fetch: agentHost(key).f },
    })
    const req: MiddlewareRequest = {
      method: 'GET',
      url: '/api/data?x=1',
      headers: { host: 'site.example', ...lower(await signedHeaders(key)) },
    }
    const res = expressRes()
    const next = vi.fn()
    await guard(req, res, next)
    expect(next).toHaveBeenCalledOnce()
    expect(req.agentVerified).toBe(true)
    expect(req.webBotAuth).toMatchObject({ verified: true, keyid: key.keyid })
  })

  it('an unsigned request is challenged, with Accept-Signature', async () => {
    const guard = requireAgent({ secret: HMAC_KEY, webBotAuth: { trustedSignatureAgents: [AGENT] } })
    const req: MiddlewareRequest = { method: 'GET', url: '/', headers: { host: 'site.example' } }
    const res = expressRes()
    const next = vi.fn()
    await guard(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.headers['Accept-Signature']).toBe(WEB_BOT_AUTH_ACCEPT_SIGNATURE)
    expect(req.webBotAuth).toMatchObject({ verified: false, reason: 'no_signature' })
  })

  it('a forged signature does not skip the challenge', async () => {
    const key = await generateAgentKey()
    const guard = requireAgent({
      secret: HMAC_KEY,
      webBotAuth: { trustedSignatureAgents: [AGENT], fetch: agentHost(key).f },
    })
    const headers = lower(await signedHeaders(key))
    headers.signature = headers.signature.replace(/=:(.)/, (_m, c: string) => `=:${c === 'A' ? 'B' : 'A'}`)
    const req: MiddlewareRequest = { method: 'GET', url: '/', headers: { host: 'site.example', ...headers } }
    const res = expressRes()
    const next = vi.fn()
    await guard(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(req.webBotAuth).toMatchObject({ verified: false, outcome: 'invalid' })
  })

  it('accept() can veto a verified agent', async () => {
    const key = await generateAgentKey()
    const guard = requireAgent({
      secret: HMAC_KEY,
      webBotAuth: { trustedSignatureAgents: [AGENT], fetch: agentHost(key).f, accept: () => false },
    })
    const req: MiddlewareRequest = {
      method: 'GET',
      url: '/',
      headers: { host: 'site.example', ...lower(await signedHeaders(key)) },
    }
    const res = expressRes()
    const next = vi.fn()
    await guard(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(req.webBotAuth?.verified).toBe(true)
  })
})

function honoCtx(request: Request) {
  const state: Record<string, unknown> = {}
  const out = { status: 200, headers: {} as Record<string, string> }
  const ctx: HonoContext = {
    req: {
      header: (n: string) => request.headers.get(n) ?? undefined,
      json: async <T,>() => (await request.json()) as T,
      url: request.url,
      method: request.method,
      raw: request,
    },
    json(body: unknown, status?: number) {
      out.status = status ?? 200
      return new Response(JSON.stringify(body), { status: out.status })
    },
    text: (b: string, s?: number) => new Response(b, { status: s ?? 200 }),
    status(s: number) {
      out.status = s
    },
    header(n: string, v: string) {
      out.headers[n] = v
    },
    set(k: string, v: unknown) {
      state[k] = v
    },
    get: <T,>(k: string) => state[k] as T,
  }
  return { ctx, state, out }
}

describe('Hono requireAgentHono + webBotAuth', () => {
  it('a valid signed agent passes without a proof token', async () => {
    const key = await generateAgentKey()
    const mw = requireAgentHono({
      secret: HMAC_KEY,
      webBotAuth: { trustedSignatureAgents: [AGENT], fetch: agentHost(key).f },
    })
    const { ctx, state } = honoCtx(new Request(SITE, { headers: await signedHeaders(key) }))
    const next = vi.fn(async () => {})
    await mw(ctx, next)
    expect(next).toHaveBeenCalledOnce()
    expect(state.agentVerified).toBe(true)
    expect(state.webBotAuth).toMatchObject({ verified: true })
  })

  it('an unsigned request gets 401 + Accept-Signature', async () => {
    const mw = requireAgentHono({ secret: HMAC_KEY, webBotAuth: { trustedSignatureAgents: [AGENT] } })
    const { ctx, out } = honoCtx(new Request(SITE))
    const next = vi.fn(async () => {})
    const res = await mw(ctx, next)
    expect(next).not.toHaveBeenCalled()
    expect((res as Response).status).toBe(401)
    expect(out.headers['Accept-Signature']).toBe(WEB_BOT_AUTH_ACCEPT_SIGNATURE)
  })
})

describe('Next createNextMiddleware + webBotAuth', () => {
  it('a valid signed agent reaches a protected path', async () => {
    const key = await generateAgentKey()
    const mw = createNextMiddleware({
      secret: HMAC_KEY,
      protectedPaths: ['/api/data'],
      webBotAuth: { trustedSignatureAgents: [AGENT], fetch: agentHost(key).f },
    })
    expect(await mw(new Request(SITE, { headers: await signedHeaders(key) }))).toBeNull()
  })

  it('works with a header bag that only has get()', async () => {
    const key = await generateAgentKey()
    const mw = createNextMiddleware({
      secret: HMAC_KEY,
      protectedPaths: ['/api/data'],
      webBotAuth: { trustedSignatureAgents: [AGENT], fetch: agentHost(key).f },
    })
    const real = new Request(SITE, { headers: await signedHeaders(key) })
    const getOnly = {
      method: 'GET',
      url: SITE,
      headers: { get: (n: string) => real.headers.get(n) },
      json: async () => ({}),
    }
    expect(await mw(getOnly)).toBeNull()
  })

  it('an unsigned request to a protected path is challenged', async () => {
    const mw = createNextMiddleware({
      secret: HMAC_KEY,
      protectedPaths: ['/api/data'],
      webBotAuth: { trustedSignatureAgents: [AGENT] },
    })
    const res = await mw(new Request(SITE))
    expect(res?.status).toBe(401)
    expect(res?.headers.get('accept-signature')).toBe(WEB_BOT_AUTH_ACCEPT_SIGNATURE)
  })
})

describe('review hardening (Axon, unit imrobot-wba)', () => {
  it('authorities: a signature made for another site does not verify here', async () => {
    const key = await generateAgentKey()
    const v = new WebBotAuthVerifier({
      trustedSignatureAgents: [AGENT],
      authorities: ['https://site.example', 'site.example:8443'],
      fetch: agentHost(key).f,
    })
    // Signed for evil.example, replayed to us with the matching (spoofed) Host.
    const sig = lower(await signedHeaders(key, 'https://evil.example/x'))
    const r = await v.verify({ headers: { host: 'evil.example', ...sig } })
    expect(r).toMatchObject({ verified: false, outcome: 'invalid', reason: 'wrong_authority' })
    const ok = await v.verify({ headers: { host: 'SITE.example:443', ...lower(await signedHeaders(key, 'https://site.example:443/')) } })
    expect(ok.verified).toBe(true)
  })

  it('normalizeAuthority strips default ports, case and trailing dots', () => {
    expect(normalizeAuthority('Site.Example.:443')).toBe('site.example')
    expect(normalizeAuthority('https://site.example:8443/path')).toBe('site.example:8443')
    expect(normalizeAuthority('[::1]:80')).toBe('[::1]')
    expect(normalizeAuthority('bad host')).toBeUndefined()
    expect(() => new WebBotAuthVerifier({ directoryUrl: 'https://a.example/k', authorities: [] })).toThrow()
  })

  it('requireComponents rejects a signature that binds only the host', async () => {
    const key = await generateAgentKey()
    const v = new WebBotAuthVerifier({
      trustedSignatureAgents: [AGENT],
      requireComponents: ['@method', '@path'],
      fetch: agentHost(key).f,
    })
    const hostOnly = await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect(hostOnly).toMatchObject({ verified: false, reason: 'missing_component' })
    const full = lower(await signedHeaders(key, SITE, { components: ['@method', '@path'] }))
    const r = await v.verify({ method: 'GET', url: '/api/data?x=1', headers: { host: 'site.example', ...full } })
    expect(r.verified).toBe(true)
  })

  it('rejects duplicate component identifiers', async () => {
    const key = await generateAgentKey()
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: agentHost(key).f })
    const h = lower(await signedHeaders(key))
    h['signature-input'] = h['signature-input'].replace('("@authority"', '("@authority" "@authority"')
    expect(await v.verify({ headers: { host: 'site.example', ...h } })).toMatchObject({
      verified: false,
      reason: 'malformed',
    })
  })

  it('the default max age is 5 minutes, whatever expires says', async () => {
    const key = await generateAgentKey()
    const created = Math.floor(Date.now() / 1000) - 400
    const h = lower(await signedHeaders(key, SITE, { created, expires: created + 3600 }))
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: agentHost(key).f })
    expect(await v.verify({ headers: { host: 'site.example', ...h } })).toMatchObject({ reason: 'expired' })
  })

  it('isPrivateHost: trailing dots, numeric hosts and non-global IPv6', () => {
    for (const h of [
      'localhost.',
      'svc.internal.',
      '127.1',
      '2130706433',
      '0x7f000001',
      '[fec0::1]',
      '[64:ff9b::a9fe:a9fe]',
      '[2002:a9fe:a9fe::1]',
      '[2001::1]',
      '[2001:db8::1]',
      '[::a9fe:a9fe]',
      '[::ffff:a9fe:a9fe]',
      '192.0.2.1',
    ]) {
      expect(isPrivateHost(h), h).toBe(true)
    }
    for (const h of ['[2606:4700::1111]', '1.1.1.1', 'agent.example.']) expect(isPrivateHost(h), h).toBe(false)
  })

  it('a pinned directoryUrl must be https unless allowInsecureDirectory', () => {
    expect(() => new WebBotAuthVerifier({ directoryUrl: 'http://a.example/k' })).toThrow(/https/)
    expect(() => new WebBotAuthVerifier({ directoryUrl: 'http://a.example/k', allowInsecureDirectory: true })).not.toThrow()
  })

  it('ignores a directory key spelled non-canonically (test-key dodge)', async () => {
    const key = await generateAgentKey()
    const x = key.publicJwk.x
    // Flip the 2 unused low bits of the last base64url char: same bytes, other string.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const last = alphabet.indexOf(x[x.length - 1])
    const variant = x.slice(0, -1) + alphabet[last ^ 1]
    const f = (async () =>
      new Response(JSON.stringify({ keys: [{ kty: 'OKP', crv: 'Ed25519', x: variant }] }), {
        status: 200,
      })) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ directoryUrl: 'https://agent.example/keys', fetch: f })
    const r = await v.verify({ headers: { host: 'site.example', ...lower(await signedHeaders(key)) } })
    expect(r).toMatchObject({ verified: false, reason: 'unknown_key' })
  })

  it('a throwing accept() challenges instead of throwing', async () => {
    const key = await generateAgentKey()
    const v = new WebBotAuthVerifier({ trustedSignatureAgents: [AGENT], fetch: agentHost(key).f })
    const d = await evaluateWebBotAuth(
      v,
      { headers: { host: 'site.example', ...lower(await signedHeaders(key)) } },
      () => {
        throw new Error('boom')
      },
    )
    expect(d).toMatchObject({ skipChallenge: false, result: { verified: true } })
  })

  it('one request cannot make us fetch more than two directories', async () => {
    const keys = await Promise.all([generateAgentKey(), generateAgentKey(), generateAgentKey()])
    const calls: string[] = []
    const f = (async (url: string) => {
      calls.push(String(url))
      return new Response('{"keys":[]}', { status: 200 })
    }) as unknown as typeof fetch
    const v = new WebBotAuthVerifier({ allowAnySignatureAgent: true, fetch: f })
    const parts = await Promise.all(
      keys.map((k, i) =>
        signRequest({ url: SITE }, { privateJwk: k.privateJwk, signatureAgent: `https://a${i}.example`, label: `s${i}` }),
      ),
    )
    const join = (name: string) => parts.map((p) => p[name]).join(', ')
    await v.verify({
      headers: {
        host: 'site.example',
        'signature-agent': join('Signature-Agent'),
        'signature-input': join('Signature-Input'),
        signature: join('Signature'),
      },
    })
    expect(new Set(calls.map((c) => new URL(c).host)).size).toBe(2)
  })
})
