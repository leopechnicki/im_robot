import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256Hex, sha256BytesHex } from '../src/core/sha256'
import { constantTimeEqual } from '../src/core/hmac'
import { executeOperation, formatOperation, formatOperationNL } from '../src/core/operations'
import { generateChallenge } from '../src/core/challenge'
import { createVerifier } from '../src/server/verifier'
import { solveChallenge } from '../src/core/solver'
import type { SignedChallenge } from '../src/core/types'

const SECRET = 's'.repeat(8) + '-hardening-v09-secret'
const nodeSha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sha256 (pure JS, FIPS 180-4)', () => {
  it('matches the published vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('matches node:crypto across block-boundary lengths and non-ASCII', () => {
    for (const n of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const s = 'x'.repeat(n)
      expect(sha256Hex(s)).toBe(nodeSha(s))
    }
    for (const s of ['zażółć gęślą jaźń', '日本語テキスト', '🤖 robot', 'mixed ✓ ascii']) {
      expect(sha256Hex(s)).toBe(nodeSha(s))
    }
  })

  it('hashes raw bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 255])
    expect(sha256BytesHex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
  })
})

describe('sha256 operation', () => {
  it('runs, formats and reads naturally', () => {
    expect(executeOperation('1', { op: 'sha256' })).toBe(nodeSha('1'))
    expect(formatOperation({ op: 'sha256' })).toBe('sha256()')
    expect(formatOperationNL({ op: 'sha256' }).toLowerCase()).toContain('sha-256')
  })

  it('is off by default and present exactly once when enabled', () => {
    for (let i = 0; i < 30; i++) {
      expect(
        generateChallenge({ difficulty: 'medium' }).pipeline.some((o) => o.op === 'sha256'),
      ).toBe(false)
      const on = generateChallenge({ difficulty: 'medium', sha256: true }).pipeline
      expect(on.filter((o) => o.op === 'sha256')).toHaveLength(1)
    }
  })

  it('a verifier with sha256 issues solvable challenges', async () => {
    const v = createVerifier({ secret: SECRET, sha256: true })
    for (let i = 0; i < 10; i++) {
      const c = await v.generate()
      expect(c.pipeline.some((o) => o.op === 'sha256')).toBe(true)
      expect((await v.verify(c, solveChallenge(c))).valid).toBe(true)
    }
  })
})

describe('constantTimeEqual', () => {
  it('compares like ===', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
    expect(constantTimeEqual('ż', 'ż')).toBe(true)
    expect(constantTimeEqual('ż', 'z')).toBe(false)
  })

  it('refuses non-strings', () => {
    expect(constantTimeEqual(undefined as unknown as string, 'a')).toBe(false)
    expect(constantTimeEqual(1 as unknown as string, '1')).toBe(false)
  })
})

describe('timing gate', () => {
  it('rejects answers faster than minSolveMs', async () => {
    const v = createVerifier({ secret: SECRET, minSolveMs: 60_000 })
    const c = await v.generate()
    const r = await v.verify(c, solveChallenge(c))
    expect(r.valid).toBe(false)
    expect(r.reason).toBe('too_fast')
  })

  it('rejects answers slower than maxSolveMs and accepts inside the window', async () => {
    const v = createVerifier({ secret: SECRET, minSolveMs: 100, maxSolveMs: 5_000 })
    const c = await v.generate()
    const answer = solveChallenge(c)
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(c.timestamp + 6_000)
    expect((await v.verify(c, answer)).reason).toBe('too_slow')
    now.mockReturnValue(c.timestamp + 1_000)
    const ok = await v.verify(c, answer)
    expect(ok.valid).toBe(true)
    expect(ok.elapsed).toBe(1_000)
  })

  it('validates the window', () => {
    expect(() => createVerifier({ secret: SECRET, minSolveMs: -1 })).toThrow()
    expect(() => createVerifier({ secret: SECRET, minSolveMs: 500, maxSolveMs: 500 })).toThrow()
  })
})

describe('HMAC v2 covers timestamp and seed', () => {
  async function fresh(): Promise<{
    c: SignedChallenge
    answer: string
    v: ReturnType<typeof createVerifier>
  }> {
    const v = createVerifier({ secret: SECRET, minSolveMs: 1_000 })
    const c = await v.generate()
    return { c, answer: solveChallenge(c), v }
  }

  it('a back-dated timestamp (to dodge the timing gate) breaks the HMAC', async () => {
    const { c, answer, v } = await fresh()
    expect((await v.verify({ ...c, timestamp: c.timestamp - 10_000 }, answer)).reason).toBe(
      'invalid_hmac',
    )
  })

  it('a swapped seed breaks the HMAC', async () => {
    const { c, answer, v } = await fresh()
    expect(
      (
        await v.verify(
          {
            ...c,
            seed: c.seed + '0',
          },
          answer,
        )
      ).reason,
    ).toBe('invalid_hmac')
  })

  it('a malformed challenge is refused, not thrown', async () => {
    const v = createVerifier({ secret: SECRET })
    expect((await v.verify({} as SignedChallenge, 'x')).valid).toBe(false)
  })
})
