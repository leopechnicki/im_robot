/**
 * Tests for Web Bot Auth (RFC 9421 HTTP Message Signatures) verification.
 *
 * Covers:
 * 1. WebBotAuthVerifier — valid Ed25519 signature verifies
 * 2. tampered request / signature → bad_signature
 * 3. timing: expired / not_yet_valid
 * 4. missing headers → no_signature
 * 5. tag mismatch, unsupported alg, unknown key
 * 6. signature base reconstruction (parse + build)
 * 7. createAgentRouter integration — flag stamped into proof token; required mode
 * 8. verifyWebBotAuthSignature standalone
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  WebBotAuthVerifier,
  verifyWebBotAuthSignature,
  parseSignatureInput,
  buildSignatureBase,
} from '../src/server/web-bot-auth'
import { createAgentRouter } from '../src/server/middleware'
import { ProofTokenIssuer } from '../src/server/proof-token'
import type { MiddlewareRequest, MiddlewareResponse } from '../src/server/middleware'
import { solveChallenge } from '../src/core/solver'

const DIRECTORY_URL = 'https://agent.example/.well-known/http-message-signatures-directory'
const SECRET = 'web-bot-auth-test-secret-16chars!!'

// ─── helpers ──────────────────────────────────────────────────────────────

interface PublicJwk {
  kty: string
  crv: string
  x: string
  kid?: string
}

function mockDirectory(...keys: PublicJwk[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ keys }) }),
  )
}

function mockDirectoryError(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
}

function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
}

async function exportJwk(key: CryptoKey, kid?: string): Promise<PublicJwk> {
  const jwk = (await crypto.subtle.exportKey('jwk', key)) as unknown as PublicJwk
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, ...(kid ? { kid } : {}) }
}

interface SignOptions {
  components?: string[]
  keyid?: string
  tag?: string | null
  created?: number
  expires?: number
  alg?: string
  label?: string
  method?: string
  url?: string
  host?: string
}

/**
 * Build a request signed over its own signature base, so the verifier
 * reconstructs exactly what we signed.
 */
async function buildSignedRequest(
  privateKey: CryptoKey,
  opts: SignOptions = {},
): Promise<MiddlewareRequest> {
  const label = opts.label ?? 'sig1'
  const components = opts.components ?? ['@authority', '@method', '@path']
  const created = opts.created ?? Math.floor(Date.now() / 1000)

  const params: string[] = [`created=${created}`]
  if (opts.expires !== undefined) params.push(`expires=${opts.expires}`)
  if (opts.keyid !== undefined) params.push(`keyid="${opts.keyid}"`)
  if (opts.alg !== undefined) params.push(`alg="${opts.alg}"`)
  const tag = opts.tag === undefined ? 'web-bot-auth' : opts.tag
  if (tag !== null) params.push(`tag="${tag}"`)

  const inner = components.map((c) => `"${c}"`).join(' ')
  const signatureInput = `${label}=(${inner});${params.join(';')}`

  const headers: Record<string, string> = {
    host: opts.host ?? 'api.example.com',
    'content-type': 'application/json',
    'signature-input': signatureInput,
  }
  const req: MiddlewareRequest = {
    method: opts.method ?? 'POST',
    url: opts.url ?? '/imrobot/verify?x=1',
    headers,
  }

  const parsed = parseSignatureInput(signatureInput)
  if (!parsed) throw new Error('test setup: failed to parse signature-input')
  const base = buildSignatureBase(parsed, req)
  if (base === null) throw new Error('test setup: failed to build signature base')

  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(base))
  headers['signature'] = `${label}=:${bytesToB64(new Uint8Array(sig))}:`
  return req
}

function createMockRes(): MiddlewareResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    setHeader(_n: string, _v: string | number) {},
    json(body: unknown) {
      res.body = body
    },
  }
  return res
}

// ─── 1. happy path ──────────────────────────────────────────────────────────

describe('WebBotAuthVerifier — valid signature', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('verifies a correctly signed request', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1' })

    const verifier = new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL })
    const result = await verifier.verify(req)

    expect(result.verified).toBe(true)
    expect(result.keyid).toBe('key-1')
    expect(result.tag).toBe('web-bot-auth')
  })

  it('falls back to the sole directory key when no keyid is provided', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey)) // no kid
    const req = await buildSignedRequest(kp.privateKey) // no keyid

    const verifier = new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL })
    expect((await verifier.verify(req)).verified).toBe(true)
  })

  it('caches the directory between verifications', async () => {
    const kp = await generateKeyPair()
    const fetchSpy = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ keys: [await exportJwk(kp.publicKey, 'k')] }) })
    vi.stubGlobal('fetch', fetchSpy)

    const verifier = new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL })
    await verifier.verify(await buildSignedRequest(kp.privateKey, { keyid: 'k' }))
    await verifier.verify(await buildSignedRequest(kp.privateKey, { keyid: 'k' }))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

// ─── 2. failure paths ─────────────────────────────────────────────────────

describe('WebBotAuthVerifier — failures', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns no_signature when headers are missing', async () => {
    const verifier = new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL })
    const result = await verifier.verify({ method: 'POST', url: '/', headers: { host: 'x' } })
    expect(result).toEqual({ verified: false, reason: 'no_signature' })
  })

  it('rejects a tampered request (covered @path changed after signing)', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1' })
    req.url = '/imrobot/HACKED?x=1' // tamper a signed component (@path)

    const verifier = new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL })
    const result = await verifier.verify(req)
    expect(result.verified).toBe(false)
    expect(result.reason).toBe('bad_signature')
  })

  it('ignores tampering of an un-covered component (query not signed)', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    // Only @authority/@method/@path are covered by default — not @query.
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1' })
    req.url = '/imrobot/verify?x=999'

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.verified).toBe(true)
  })

  it('rejects a corrupted signature value', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1' })
    req.headers['signature'] = 'sig1=:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=:'

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.verified).toBe(false)
    expect(result.reason).toBe('bad_signature')
  })

  it('rejects an expired signature', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const past = Math.floor(Date.now() / 1000) - 10_000
    const req = await buildSignedRequest(kp.privateKey, {
      keyid: 'key-1',
      created: past,
      expires: past + 60,
    })

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.verified).toBe(false)
    expect(result.reason).toBe('expired')
  })

  it('rejects via maxAgeSeconds when no expires is present', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const old = Math.floor(Date.now() / 1000) - 1000
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1', created: old })

    const result = await new WebBotAuthVerifier({
      directoryUrl: DIRECTORY_URL,
      maxAgeSeconds: 60,
    }).verify(req)
    expect(result.reason).toBe('expired')
  })

  it('rejects a not-yet-valid signature', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const future = Math.floor(Date.now() / 1000) + 10_000
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1', created: future })

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.reason).toBe('not_yet_valid')
  })

  it('rejects a tag mismatch', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1', tag: 'something-else' })

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.reason).toBe('tag_mismatch')
  })

  it('skips the tag check when expectedTag is null', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1', tag: null })

    const result = await new WebBotAuthVerifier({
      directoryUrl: DIRECTORY_URL,
      expectedTag: null,
    }).verify(req)
    expect(result.verified).toBe(true)
  })

  it('rejects an unsupported algorithm', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1', alg: 'rsa-v1_5-sha256' })

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.reason).toBe('unsupported_alg')
  })

  it('returns unknown_key when keyid is absent from a multi-key directory', async () => {
    const kp = await generateKeyPair()
    const other = await generateKeyPair()
    mockDirectory(
      await exportJwk(kp.publicKey, 'key-1'),
      await exportJwk(other.publicKey, 'key-2'),
    )
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'missing' })

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.reason).toBe('unknown_key')
  })

  it('returns directory_error when the directory fetch fails', async () => {
    const kp = await generateKeyPair()
    mockDirectoryError()
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1' })

    const result = await new WebBotAuthVerifier({ directoryUrl: DIRECTORY_URL }).verify(req)
    expect(result.reason).toBe('directory_error')
  })
})

// ─── 3. signature-base reconstruction ───────────────────────────────────────

describe('parseSignatureInput / buildSignatureBase', () => {
  it('parses components and params', () => {
    const parsed = parseSignatureInput(
      'sig1=("@authority" "@method" "@path");created=1700000000;keyid="abc";alg="ed25519";tag="web-bot-auth"',
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.components).toEqual(['@authority', '@method', '@path'])
    expect(parsed!.params).toMatchObject({
      created: 1700000000,
      keyid: 'abc',
      alg: 'ed25519',
      tag: 'web-bot-auth',
    })
  })

  it('reconstructs the RFC 9421 signature base', () => {
    const sigInput = 'sig1=("@authority" "@method" "@path");created=1700000000;keyid="abc"'
    const parsed = parseSignatureInput(sigInput)!
    const base = buildSignatureBase(parsed, {
      method: 'post',
      url: '/api/data?q=1',
      headers: { host: 'API.example.com' },
    })
    expect(base).toBe(
      [
        '"@authority": api.example.com',
        '"@method": POST',
        '"@path": /api/data',
        `"@signature-params": (\"@authority\" \"@method\" \"@path\");created=1700000000;keyid=\"abc\"`,
      ].join('\n'),
    )
  })

  it('returns null for unsupported derived components', () => {
    const parsed = parseSignatureInput('sig1=("@status");created=1')!
    expect(buildSignatureBase(parsed, { method: 'GET', url: '/', headers: {} })).toBeNull()
  })

  it('returns null for missing header components', () => {
    const parsed = parseSignatureInput('sig1=("x-custom");created=1')!
    expect(buildSignatureBase(parsed, { method: 'GET', url: '/', headers: {} })).toBeNull()
  })
})

// ─── 4. createAgentRouter integration ────────────────────────────────────────

async function buildRouterVerifyRequest(
  privateKey: CryptoKey,
  keyid: string,
): Promise<MiddlewareRequest & { body?: { challenge: unknown; answer: string; agentId?: string } }> {
  const { ImRobotVerifier } = await import('../src/server/verifier')
  const verifier = new ImRobotVerifier({ secret: SECRET })
  const challenge = await verifier.generate()
  const answer = solveChallenge(challenge)

  const signed = await buildSignedRequest(privateKey, { keyid, url: '/imrobot/verify', method: 'POST' })
  return {
    method: 'POST',
    url: '/imrobot/verify',
    headers: signed.headers,
    body: { challenge, answer, agentId: 'signed-agent' },
  }
}

describe('createAgentRouter — Web Bot Auth integration', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stamps web_bot_auth_verified:true into the proof token', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'router-key'))

    const router = createAgentRouter({
      secret: SECRET,
      webBotAuth: { directoryUrl: DIRECTORY_URL },
    })
    const req = await buildRouterVerifyRequest(kp.privateKey, 'router-key')
    const res = createMockRes()

    await router.verify(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.body as { valid: boolean; proofToken: string }
    expect(body.valid).toBe(true)
    const decoded = ProofTokenIssuer.decode(body.proofToken)
    expect(decoded?.imr.web_bot_auth_verified).toBe(true)
  })

  it('returns 400 when required and no signature is present', async () => {
    mockDirectory()
    const { ImRobotVerifier } = await import('../src/server/verifier')
    const verifier = new ImRobotVerifier({ secret: SECRET })
    const challenge = await verifier.generate()
    const answer = solveChallenge(challenge)

    const router = createAgentRouter({
      secret: SECRET,
      webBotAuth: { directoryUrl: DIRECTORY_URL, required: true },
    })
    const res = createMockRes()
    await router.verify(
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: { challenge, answer } },
      res,
    )

    expect(res.statusCode).toBe(400)
    expect((res.body as { code: string }).code).toBe('WEB_BOT_AUTH_REQUIRED')
  })

  it('issues a token without the flag when not configured', async () => {
    const { ImRobotVerifier } = await import('../src/server/verifier')
    const verifier = new ImRobotVerifier({ secret: SECRET })
    const challenge = await verifier.generate()
    const answer = solveChallenge(challenge)

    const router = createAgentRouter({ secret: SECRET })
    const res = createMockRes()
    await router.verify(
      { method: 'POST', headers: {}, body: { challenge, answer } },
      res,
    )

    expect(res.statusCode).toBe(200)
    const decoded = ProofTokenIssuer.decode((res.body as { proofToken: string }).proofToken)
    expect(decoded?.imr.web_bot_auth_verified).toBeUndefined()
  })
})

// ─── 5. standalone function ──────────────────────────────────────────────────

describe('verifyWebBotAuthSignature', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('verifies without holding a verifier instance', async () => {
    const kp = await generateKeyPair()
    mockDirectory(await exportJwk(kp.publicKey, 'key-1'))
    const req = await buildSignedRequest(kp.privateKey, { keyid: 'key-1' })

    const result = await verifyWebBotAuthSignature(req, { directoryUrl: DIRECTORY_URL })
    expect(result.verified).toBe(true)
  })
})
