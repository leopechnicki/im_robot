import { describe, it, expect } from 'vitest'
import { createVerifier } from '../src/server/verifier'
import { ChallengeAnalytics } from '../src/server/analytics'
import { solveChallenge } from '../src/core/solver'
import type { SignedChallenge } from '../src/core/types'

// Consumer smoke 2026-11-24: the README OTel section wires
// `createVerifier({ secret, analytics })`, but 0.8.0 ignored `analytics`
// (every counter stayed 0) and the snippet did not type-check.
const KEY = 'k'.repeat(32)

describe('createVerifier({ analytics })', () => {
  it('records generated, verified and failed outcomes per difficulty', async () => {
    const analytics = new ChallengeAnalytics()
    const verifier = createVerifier({ secret: KEY, difficulty: 'easy', analytics })

    const ok = await verifier.generate()
    expect((await verifier.verify(ok, solveChallenge(ok))).valid).toBe(true)

    const wrong = await verifier.generate({ difficulty: 'hard' })
    expect((await verifier.verify(wrong, 'nope')).reason).toBe('wrong_answer')

    const stats = analytics.getStats()
    expect(stats.summary.totalGenerated).toBe(2)
    expect(stats.byDifficulty.easy.generated).toBe(1)
    expect(stats.byDifficulty.easy.verified).toBe(1)
    expect(stats.byDifficulty.hard.failed).toBe(1)
    expect(stats.byDifficulty.hard.failureReasons.wrong_answer).toBe(1)
  })

  it('counts a forged challenge with an unknown difficulty under the default, without throwing', async () => {
    const analytics = new ChallengeAnalytics()
    const verifier = createVerifier({ secret: KEY, difficulty: 'medium', analytics })
    const c = await verifier.generate()
    const forged = { ...c, difficulty: '__proto__' } as unknown as SignedChallenge
    expect((await verifier.verify(forged, solveChallenge(c))).reason).toBe('invalid_hmac')
    expect((await verifier.verify(null as unknown as SignedChallenge, 'x')).reason).toBe('invalid_hmac')
    expect(analytics.getStats().byDifficulty.medium.failureReasons.invalid_hmac).toBe(2)
  })

  it('records expired challenges', async () => {
    const analytics = new ChallengeAnalytics()
    const verifier = createVerifier({ secret: KEY, analytics })
    const c = await verifier.generate({ ttl: 1 })
    await new Promise((r) => setTimeout(r, 20))
    expect((await verifier.verify(c, solveChallenge(c))).reason).toBe('expired')
    expect(analytics.getStats().byDifficulty.medium.expired).toBe(1)
  })
})
