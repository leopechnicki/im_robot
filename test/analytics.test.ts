import { describe, it, expect, beforeEach } from 'vitest'
import { ChallengeAnalytics } from '../src/server/analytics'

/**
 * Comprehensive test suite for the ChallengeAnalytics class.
 * Tests metrics tracking, per-difficulty breakdowns, solve-time percentiles,
 * failure-reason distributions, and memory bounding.
 */

describe('ChallengeAnalytics', () => {
  // ── Basic initialization ──────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const analytics = new ChallengeAnalytics()
      expect(analytics).toBeDefined()
    })

    it('creates instance with custom config', () => {
      const analytics = new ChallengeAnalytics({
        maxSamples: 500,
        trackFailureReasons: false,
      })
      expect(analytics).toBeDefined()
    })

    it('starts with all zeroes', () => {
      const analytics = new ChallengeAnalytics()
      const stats = analytics.getStats()
      expect(stats.summary.totalGenerated).toBe(0)
      expect(stats.summary.totalVerified).toBe(0)
      expect(stats.summary.totalFailed).toBe(0)
      expect(stats.summary.totalExpired).toBe(0)
      expect(stats.summary.totalSuspicious).toBe(0)
      expect(stats.summary.verificationRate).toBe(0)
      expect(stats.summary.avgSolveTimeMs).toBe(0)
    })
  })

  // ── Recording events ─────────────────────────────────────────────────────

  describe('recordGenerated', () => {
    it('increments generated count for the specified difficulty', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordGenerated('easy')
      analytics.recordGenerated('easy')
      analytics.recordGenerated('medium')

      const stats = analytics.getStats()
      expect(stats.byDifficulty.easy.generated).toBe(2)
      expect(stats.byDifficulty.medium.generated).toBe(1)
      expect(stats.byDifficulty.hard.generated).toBe(0)
      expect(stats.summary.totalGenerated).toBe(3)
    })
  })

  describe('recordVerified', () => {
    it('increments verified count and records solve time', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordVerified('medium', 142, false)

      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.verified).toBe(1)
      expect(stats.byDifficulty.medium.avgSolveTimeMs).toBe(142)
      expect(stats.byDifficulty.medium.suspicious).toBe(0)
      expect(stats.summary.totalVerified).toBe(1)
    })

    it('tracks suspicious verifications', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordVerified('hard', 6000, true)

      const stats = analytics.getStats()
      expect(stats.byDifficulty.hard.suspicious).toBe(1)
      expect(stats.summary.totalSuspicious).toBe(1)
    })

    it('computes average solve time across multiple verifications', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordVerified('easy', 100, false)
      analytics.recordVerified('easy', 200, false)
      analytics.recordVerified('easy', 300, false)

      const stats = analytics.getStats()
      expect(stats.byDifficulty.easy.avgSolveTimeMs).toBe(200)
    })
  })

  describe('recordFailed', () => {
    it('increments failed count', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordFailed('medium', 'wrong_answer')

      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.failed).toBe(1)
      expect(stats.summary.totalFailed).toBe(1)
    })

    it('tracks expired as both failed and expired', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordFailed('hard', 'expired')

      const stats = analytics.getStats()
      expect(stats.byDifficulty.hard.failed).toBe(1)
      expect(stats.byDifficulty.hard.expired).toBe(1)
      expect(stats.summary.totalExpired).toBe(1)
    })

    it('tracks failure reasons', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordFailed('medium', 'wrong_answer')
      analytics.recordFailed('medium', 'wrong_answer')
      analytics.recordFailed('medium', 'invalid_hmac')
      analytics.recordFailed('medium', 'expired')

      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.failureReasons).toEqual({
        wrong_answer: 2,
        invalid_hmac: 1,
        expired: 1,
      })
    })

    it('does not track failure reasons when disabled', () => {
      const analytics = new ChallengeAnalytics({ trackFailureReasons: false })
      analytics.recordFailed('medium', 'wrong_answer')

      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.failureReasons).toEqual({})
    })
  })

  // ── Verification rate ────────────────────────────────────────────────────

  describe('verification rate', () => {
    it('calculates verification rate correctly', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordVerified('medium', 100, false)
      analytics.recordVerified('medium', 150, false)
      analytics.recordFailed('medium', 'wrong_answer')

      const stats = analytics.getStats()
      // 2 verified out of 3 attempts
      expect(stats.summary.verificationRate).toBeCloseTo(2 / 3, 5)
    })

    it('returns 0 when no attempts', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordGenerated('medium') // generation != attempt

      const stats = analytics.getStats()
      expect(stats.summary.verificationRate).toBe(0)
    })

    it('returns 1 when all succeed', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordVerified('easy', 50, false)
      analytics.recordVerified('hard', 200, false)

      const stats = analytics.getStats()
      expect(stats.summary.verificationRate).toBe(1)
    })
  })

  // ── Solve time statistics ────────────────────────────────────────────────

  describe('solve time statistics', () => {
    let analytics: ChallengeAnalytics

    beforeEach(() => {
      analytics = new ChallengeAnalytics()
    })

    it('returns null for min/max/p95 when no samples', () => {
      const stats = analytics.getStats()
      expect(stats.byDifficulty.easy.minSolveTimeMs).toBeNull()
      expect(stats.byDifficulty.easy.maxSolveTimeMs).toBeNull()
      expect(stats.byDifficulty.easy.p95SolveTimeMs).toBeNull()
    })

    it('computes min solve time', () => {
      analytics.recordVerified('medium', 100, false)
      analytics.recordVerified('medium', 50, false)
      analytics.recordVerified('medium', 200, false)

      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.minSolveTimeMs).toBe(50)
    })

    it('computes max solve time', () => {
      analytics.recordVerified('medium', 100, false)
      analytics.recordVerified('medium', 50, false)
      analytics.recordVerified('medium', 200, false)

      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.maxSolveTimeMs).toBe(200)
    })

    it('computes p95 solve time', () => {
      // Add 20 samples: 10, 20, 30, ..., 200
      for (let i = 1; i <= 20; i++) {
        analytics.recordVerified('hard', i * 10, false)
      }

      const stats = analytics.getStats()
      // p95 of 20 samples: index = ceil(20 * 0.95) - 1 = 18
      // sorted[18] = 190
      expect(stats.byDifficulty.hard.p95SolveTimeMs).toBe(190)
    })

    it('handles single sample', () => {
      analytics.recordVerified('easy', 42, false)

      const stats = analytics.getStats()
      expect(stats.byDifficulty.easy.minSolveTimeMs).toBe(42)
      expect(stats.byDifficulty.easy.maxSolveTimeMs).toBe(42)
      expect(stats.byDifficulty.easy.p95SolveTimeMs).toBe(42)
      expect(stats.byDifficulty.easy.avgSolveTimeMs).toBe(42)
    })
  })

  // ── Cross-difficulty aggregation ─────────────────────────────────────────

  describe('cross-difficulty aggregation', () => {
    it('aggregates across all difficulties', () => {
      const analytics = new ChallengeAnalytics()

      analytics.recordGenerated('easy')
      analytics.recordGenerated('medium')
      analytics.recordGenerated('hard')
      analytics.recordVerified('easy', 50, false)
      analytics.recordVerified('medium', 150, false)
      analytics.recordFailed('hard', 'wrong_answer')

      const stats = analytics.getStats()
      expect(stats.summary.totalGenerated).toBe(3)
      expect(stats.summary.totalVerified).toBe(2)
      expect(stats.summary.totalFailed).toBe(1)
    })

    it('computes weighted average solve time across difficulties', () => {
      const analytics = new ChallengeAnalytics()

      // 2 easy verifications averaging 100ms
      analytics.recordVerified('easy', 80, false)
      analytics.recordVerified('easy', 120, false)
      // 1 hard verification at 300ms
      analytics.recordVerified('hard', 300, false)

      const stats = analytics.getStats()
      // weighted: (100 * 2 + 300 * 1) / 3 = 500/3 ≈ 167
      expect(stats.summary.avgSolveTimeMs).toBe(Math.round((100 * 2 + 300 * 1) / 3))
    })
  })

  // ── Memory bounding ──────────────────────────────────────────────────────

  describe('memory bounding', () => {
    it('caps solve-time samples at maxSamples', () => {
      const analytics = new ChallengeAnalytics({ maxSamples: 20 })

      // Add 30 samples
      for (let i = 0; i < 30; i++) {
        analytics.recordVerified('medium', i * 10, false)
      }

      // Should still produce valid stats without growing unbounded
      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.verified).toBe(30) // count is always accurate
      // avg will be based on the retained samples (after trimming oldest)
      expect(stats.byDifficulty.medium.avgSolveTimeMs).toBeGreaterThan(0)
    })
  })

  // ── Reset ────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears all tracked data', () => {
      const analytics = new ChallengeAnalytics()

      analytics.recordGenerated('medium')
      analytics.recordVerified('medium', 100, false)
      analytics.recordFailed('hard', 'expired')

      analytics.reset()
      const stats = analytics.getStats()

      expect(stats.summary.totalGenerated).toBe(0)
      expect(stats.summary.totalVerified).toBe(0)
      expect(stats.summary.totalFailed).toBe(0)
      expect(stats.summary.totalExpired).toBe(0)
      expect(stats.byDifficulty.medium.failureReasons).toEqual({})
    })
  })

  // ── toJSON ───────────────────────────────────────────────────────────────

  describe('toJSON', () => {
    it('returns a JSON-serializable snapshot', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordGenerated('easy')
      analytics.recordVerified('easy', 55, false)

      const json = analytics.toJSON()
      const serialized = JSON.stringify(json)
      const parsed = JSON.parse(serialized)

      expect(parsed.summary.totalGenerated).toBe(1)
      expect(parsed.summary.totalVerified).toBe(1)
      expect(parsed.byDifficulty.easy.avgSolveTimeMs).toBe(55)
      expect(parsed.collectedAt).toBeTypeOf('number')
    })
  })

  // ── Uptime tracking ──────────────────────────────────────────────────────

  describe('uptime', () => {
    it('tracks uptime from creation', () => {
      const analytics = new ChallengeAnalytics()
      const stats = analytics.getStats()
      expect(stats.summary.uptimeMs).toBeGreaterThanOrEqual(0)
      expect(stats.summary.uptimeMs).toBeLessThan(1000) // should be near-instant in test
    })
  })

  // ── Edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles all failure reasons', () => {
      const analytics = new ChallengeAnalytics()
      const reasons = ['expired', 'invalid_hmac', 'wrong_answer', 'tampered', 'replay'] as const
      for (const reason of reasons) {
        analytics.recordFailed('medium', reason)
      }

      const stats = analytics.getStats()
      expect(stats.byDifficulty.medium.failed).toBe(5)
      expect(Object.keys(stats.byDifficulty.medium.failureReasons)).toHaveLength(5)
    })

    it('handles zero solve time', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordVerified('easy', 0, false)

      const stats = analytics.getStats()
      expect(stats.byDifficulty.easy.avgSolveTimeMs).toBe(0)
      expect(stats.byDifficulty.easy.minSolveTimeMs).toBe(0)
    })

    it('all difficulties are independent', () => {
      const analytics = new ChallengeAnalytics()
      analytics.recordVerified('easy', 50, false)
      analytics.recordFailed('hard', 'wrong_answer')

      const stats = analytics.getStats()
      expect(stats.byDifficulty.easy.verified).toBe(1)
      expect(stats.byDifficulty.easy.failed).toBe(0)
      expect(stats.byDifficulty.hard.verified).toBe(0)
      expect(stats.byDifficulty.hard.failed).toBe(1)
      expect(stats.byDifficulty.medium.verified).toBe(0)
      expect(stats.byDifficulty.medium.failed).toBe(0)
    })
  })
})
