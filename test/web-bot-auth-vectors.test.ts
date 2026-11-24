// @vitest-environment node
/**
 * Spec test vectors for Web Bot Auth:
 * draft-ietf-webbotauth-httpsig-protocol-01 Appendix E.2.1 / E.2.2 / E.2.3, and
 * the cloudflare/web-bot-auth fixture web_bot_auth_architecture_v2.json (sig2),
 * all signed with the RFC 9421 B.1.4 test key. Every value below is byte-exact.
 */
import { describe, expect, it } from 'vitest'
import {
  WebBotAuthVerifier,
  buildSignatureBase,
  parseSignatureInput,
  verifyDirectoryResponse,
} from '../src/server/web-bot-auth'
import { jwkThumbprint } from '../src/server/wba-crypto'
import { signDirectoryResponse, signRequest } from '../src/agent'

const TEST_KEY = {
  kty: 'OKP' as const,
  crv: 'Ed25519' as const,
  kid: 'test-key-ed25519',
  d: 'n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU',
  x: 'JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs',
}
const THUMB = 'poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U'
const CREATED = 1735689600

const E21 = {
  agent: 'sig2="https://signature-agent.test"',
  input:
    'sig2=("@authority" "signature-agent";key="sig2");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=4889289600;nonce="n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA==";tag="web-bot-auth"',
  signature: 'sig2=:CGokAoY/FrPpyuzTe1Fb2kLTAH9Idw6qSFd1+D77r1firsMRCxeuLu5e6O+ek3zQgDMAzjiXtLVfqE00xnABCQ==:',
  base: [
    '"@authority": example.com',
    '"signature-agent";key="sig2": "https://signature-agent.test"',
    '"@signature-params": ("@authority" "signature-agent";key="sig2");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=4889289600;nonce="n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA==";tag="web-bot-auth"',
  ].join('\n'),
}

const E22 = {
  agent: '"https://signature-agent.test"',
  input:
    'sig2=("@authority" "signature-agent");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=1735693200;nonce="e8N7S2MFd/qrd6T2R3tdfAuuANngKI7LFtKYI/vowzk4lAZYadIX6wW25MwG7DCT9RUKAJ0qVkU0mEeLElW1qg==";tag="web-bot-auth"',
  signature: 'sig2=:jdq0SqOwHdyHr9+r5jw3iYZH6aNGKijYp/EstF4RQTQdi5N5YYKrD+mCT1HA1nZDsi6nJKuHxUi/5Syp3rLWBA==:',
}

// cloudflare/web-bot-auth main@621d96c1, test_data/web_bot_auth_architecture_v2.json (Ed25519 sig2)
const CF_V2 = {
  agent: 'agent2="https://signature-agent.test"',
  input:
    'sig2=("@authority" "signature-agent";key="agent2");created=1735689600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";alg="ed25519";expires=4889289600;nonce="n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA==";tag="web-bot-auth"',
  signature: 'sig2=:RdNFx5Bj6au3YgAMQL/RzmUlZE8QZLIaXGRpw985hWnwPfMxT228NMk6ehRS1PSl4e8PhbNZACSanGdhEwYCCg==:',
}

const E23 = {
  body: '{"keys":[{"kty":"OKP","crv":"Ed25519","kid":"poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U","x":"JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs","use":"sig"}]}',
  digest: 'sha-256=:CADMT2aBdV/rqQr/NIru64ERQkCobVvllA4V0fLFDu0=:',
  input:
    'binding=("@authority";req "content-digest");created=1735689600;expires=4889289600;keyid="poqkLGiymh_W0uP6PZFw-dvez3QJT5SolqXBCW38r0U";tag="http-message-signatures-directory"',
  signature: 'binding=:l6P8R67tm3kujAxbHWio7ll01qrEZ0dKD/WWlGhNYEmTnFZM8Wt0VQ9zqGfvo7T/UMkBxsigzChM1Gpz7gOVBg==:',
}

function directoryFetch(body: string = E23.body) {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(String(url))
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { f, calls }
}

function req(agent: string, input: string, signature: string) {
  return {
    method: 'POST',
    url: '/foo?param=Value&Pet=dog',
    headers: { host: 'example.com', 'signature-agent': agent, 'signature-input': input, signature },
  }
}

function verifier(f: typeof fetch, extra: Record<string, unknown> = {}) {
  return new WebBotAuthVerifier({
    trustedSignatureAgents: ['https://signature-agent.test'],
    rejectTestKeys: false,
    now: () => CREATED,
    fetch: f,
    ...extra,
  })
}

describe('RFC 7638 thumbprint', () => {
  it('matches the draft keyid for the RFC 9421 test key', async () => {
    expect(await jwkThumbprint(TEST_KEY)).toBe(THUMB)
  })
  it('matches the RFC 8037 A.3 vector', async () => {
    expect(await jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' })).toBe(
      'kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k',
    )
  })
})

describe('draft -01 E.2.1 (dictionary Signature-Agent)', () => {
  it('rebuilds the exact signature base', () => {
    const parsed = parseSignatureInput(E21.input)!
    expect(buildSignatureBase(parsed, req(E21.agent, E21.input, E21.signature))).toBe(E21.base)
  })

  it('verifies, resolving the bare origin to the well-known directory', async () => {
    const { f, calls } = directoryFetch()
    const r = await verifier(f).verify(req(E21.agent, E21.input, E21.signature))
    expect(r).toMatchObject({ verified: true, outcome: 'verified', keyid: THUMB, label: 'sig2' })
    expect(r.agent).toBe('https://signature-agent.test/')
    expect(calls[0]).toBe('https://signature-agent.test/.well-known/http-message-signatures-directory')
  })

  it('our signer reproduces the draft signature byte for byte (Ed25519 is deterministic)', async () => {
    const headers = await signRequest(
      { method: 'POST', url: 'https://example.com/foo?param=Value&Pet=dog' },
      {
        privateJwk: TEST_KEY,
        signatureAgent: 'https://signature-agent.test',
        label: 'sig2',
        created: CREATED,
        expires: 4889289600,
        nonce: 'n9p433xm+NJ3ph3upfBIGmsuwHw387YV7Q/F+6BSpGCVjYCqQw6rznNA8PVVLySrAWsv0hQtFioQb6E1YsauiA==',
      },
    )
    expect(headers['Signature-Agent']).toBe(E21.agent)
    expect(headers['Signature-Input']).toBe(E21.input)
    expect(headers.Signature).toBe(E21.signature)
  })

  it('rejects the published test key by default', async () => {
    const { f } = directoryFetch()
    const r = await verifier(f, { rejectTestKeys: undefined }).verify(req(E21.agent, E21.input, E21.signature))
    expect(r).toMatchObject({ verified: false, reason: 'test_key', outcome: 'invalid' })
  })

  it('rejects a changed @authority', async () => {
    const { f } = directoryFetch()
    const r = await verifier(f).verify({ ...req(E21.agent, E21.input, E21.signature), headers: { ...req(E21.agent, E21.input, E21.signature).headers, host: 'evil.example' } })
    expect(r.reason).toBe('bad_signature')
  })

  it('rejects a swapped Signature-Agent URL as untrusted before fetching anything', async () => {
    const { f, calls } = directoryFetch()
    const r = await verifier(f).verify(req('sig2="https://other.test"', E21.input, E21.signature))
    expect(r).toMatchObject({ verified: false, reason: 'untrusted_agent', outcome: 'unverified' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a replayed nonce', async () => {
    const { f } = directoryFetch()
    const v = verifier(f)
    expect((await v.verify(req(E21.agent, E21.input, E21.signature))).verified).toBe(true)
    expect(await v.verify(req(E21.agent, E21.input, E21.signature))).toMatchObject({
      verified: false,
      reason: 'replayed_nonce',
    })
  })

  it('is not yet valid before created - skew, expired after maxAge', async () => {
    const { f } = directoryFetch()
    expect((await verifier(f, { now: () => CREATED - 61 }).verify(req(E21.agent, E21.input, E21.signature))).reason).toBe(
      'not_yet_valid',
    )
    expect(
      (await verifier(f, { now: () => CREATED + 86_400 + 61 }).verify(req(E21.agent, E21.input, E21.signature))).reason,
    ).toBe('expired')
  })
})

describe('key directory rules', () => {
  it('skips a well-known directory entry whose kid is not its thumbprint (draft -01 5.5)', async () => {
    const { f } = directoryFetch(JSON.stringify({ keys: [TEST_KEY] }))
    const r = await verifier(f).verify(req(E21.agent, E21.input, E21.signature))
    expect(r).toMatchObject({ verified: false, reason: 'unknown_key', outcome: 'unverified' })
  })
})

describe('draft -01 E.2.2 (legacy sf-string Signature-Agent)', () => {
  it('verifies', async () => {
    const { f } = directoryFetch()
    const r = await verifier(f).verify(req(E22.agent, E22.input, E22.signature))
    expect(r).toMatchObject({ verified: true, keyid: THUMB })
  })
  it('expires after its own expires + skew', async () => {
    const { f } = directoryFetch()
    const r = await verifier(f, { now: () => 1735693200 + 61 }).verify(req(E22.agent, E22.input, E22.signature))
    expect(r.reason).toBe('expired')
  })
})

describe('cloudflare/web-bot-auth fixture (architecture v2, sig2)', () => {
  it('verifies the covered member even though its key is not the label', async () => {
    const { f } = directoryFetch()
    const r = await verifier(f).verify(req(CF_V2.agent, CF_V2.input, CF_V2.signature))
    expect(r).toMatchObject({ verified: true, keyid: THUMB })
  })
})

describe('draft -01 E.2.3 (signed directory response)', () => {
  const headers = new Headers({ 'content-digest': E23.digest, 'signature-input': E23.input, signature: E23.signature })

  it('verifies the per-key directory signature', async () => {
    const ok = await verifyDirectoryResponse({
      body: E23.body,
      headers,
      authority: 'signature-agent.test',
      keys: new Map([[THUMB, TEST_KEY.x]]),
      now: CREATED,
    })
    expect([...ok]).toEqual([THUMB])
  })

  it('rejects a body that does not match Content-Digest', async () => {
    const ok = await verifyDirectoryResponse({
      body: E23.body.replace('sig', 'enc'),
      headers,
      authority: 'signature-agent.test',
      keys: new Map([[THUMB, TEST_KEY.x]]),
      now: CREATED,
    })
    expect(ok.size).toBe(0)
  })

  it('our directory signer reproduces the draft signature', async () => {
    const h = await signDirectoryResponse(E23.body, {
      privateJwks: [TEST_KEY],
      authority: 'signature-agent.test',
      created: CREATED,
      expiresInSeconds: 4889289600 - CREATED,
    })
    expect(h['Content-Digest']).toBe(E23.digest)
    expect(h['Signature-Input']).toBe(E23.input)
    expect(h.Signature).toBe(E23.signature)
  })

  it('requireSignedDirectory keeps only signed keys', async () => {
    const signedFetch = (async () =>
      new Response(E23.body, { status: 200, headers })) as unknown as typeof fetch
    const unsignedFetch = (async () => new Response(E23.body, { status: 200 })) as unknown as typeof fetch
    expect(
      (await verifier(signedFetch, { requireSignedDirectory: true }).verify(req(E21.agent, E21.input, E21.signature)))
        .verified,
    ).toBe(true)
    expect(
      await verifier(unsignedFetch, { requireSignedDirectory: true }).verify(req(E21.agent, E21.input, E21.signature)),
    ).toMatchObject({ verified: false, reason: 'unknown_key' })
  })
})
