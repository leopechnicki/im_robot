import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { ProofTokenIssuer } from '../src/server/proof-token'

// Consumer smoke 2026-11-24: 0.8.0 tokens put base64url(hex string) in the
// signature segment (86 chars), so jose / PyJWT / jsonwebtoken rejected them
// although the README and JSDoc promise RFC 7519 compatibility.
const KEY_A = 'a'.repeat(32)
const KEY_B = 'b'.repeat(32)

function rfcSignature(key: string, signingInput: string): string {
  return createHmac('sha256', key).update(signingInput).digest('base64url')
}

async function issueOne(): Promise<string> {
  return new ProofTokenIssuer({ secret: KEY_A }).issue({
    agentId: 'agent_1',
    challengeId: 'ch_1',
    difficulty: 'easy',
    solveTimeMs: 5,
    suspicious: false,
  })
}

describe('ProofTokenIssuer -- RFC 7515 HS256 signature segment', () => {
  it('issues the signature as base64url of the 32 raw HMAC bytes', async () => {
    const [h, p, s] = (await issueOne()).split('.')
    expect(s).toHaveLength(43)
    expect(s).toBe(rfcSignature(KEY_A, `${h}.${p}`))
  })

  it('verifies a token signed by a standard HS256 implementation (node:crypto)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const p = Buffer.from(
      JSON.stringify({
        iss: 'imrobot',
        sub: 'agent_x',
        iat: now,
        nbf: now,
        exp: now + 60,
        jti: 'j1',
      }),
    ).toString('base64url')
    const token = `${h}.${p}.${rfcSignature(KEY_A, `${h}.${p}`)}`
    const r = await new ProofTokenIssuer({ secret: KEY_A }).verify(token)
    expect(r.valid).toBe(true)
    expect(r.payload?.sub).toBe('agent_x')
  })

  it('still accepts legacy (<= 0.8.0) tokens whose segment is base64url(hex)', async () => {
    const [h, p] = (await issueOne()).split('.')
    const hex = createHmac('sha256', KEY_A).update(`${h}.${p}`).digest('hex')
    const legacy = `${h}.${p}.${Buffer.from(hex).toString('base64url')}`
    expect((await new ProofTokenIssuer({ secret: KEY_A }).verify(legacy)).valid).toBe(true)
  })

  it('rejects a flipped byte, a wrong key in both forms, and a non-base64url segment', async () => {
    const issuer = new ProofTokenIssuer({ secret: KEY_A })
    const [h, p, s] = (await issueOne()).split('.')
    const raw = Buffer.from(s, 'base64url')
    raw[0] ^= 0x01
    expect((await issuer.verify(`${h}.${p}.${raw.toString('base64url')}`)).reason).toBe(
      'invalid_signature',
    )
    const wrongRfc = `${h}.${p}.${rfcSignature(KEY_B, `${h}.${p}`)}`
    expect((await issuer.verify(wrongRfc)).reason).toBe('invalid_signature')
    const wrongHex = createHmac('sha256', KEY_B).update(`${h}.${p}`).digest('hex')
    const wrongLegacy = `${h}.${p}.${Buffer.from(wrongHex).toString('base64url')}`
    expect((await issuer.verify(wrongLegacy)).reason).toBe('invalid_signature')
    expect((await issuer.verify(`${h}.${p}.not*base64`)).reason).toBe('malformed')
  })
})
