/**
 * Challenge analytics for the imrobot server SDK.
 *
 * Lightweight, in-memory metrics tracker for monitoring challenge generation,
 * verification rates, solve times, and suspicious activity patterns.
 * Zero external dependencies — follows the same pattern as RateLimiter
 * and ChallengeReplayGuard.
 *
 * @example
 * ```typescript
 * import { ChallengeAnalytics } from 'imrobot/server'
 *
 * const analytics = new ChallengeAnalytics()
 *
 * // Record events as they happen
 * analytics.recordGenerated('medium')
 * analytics.recordVerified('medium', 142, false)   // 142ms, not suspicious
 * analytics.recordFailed('hard', 'wrong_answer')
 *
 * // Get a snapshot of all metrics
 * const stats = analytics.getStats()
 * console.log(stats.summary.verificationRate) // 0.5 (50%)
 * console.log(stats.byDifficulty.medium.avgSolveTimeMs) // 142
 *
 * // Export for dashboards / logging
 * console.log(JSON.stringify(analytics.toJSON(), null, 2))
 * ```
 */

import type { Difficulty, VerifyResult } from '../core/types'

/** Failure reasons from VerifyResult */
export type FailureReason = NonNullable<VerifyResult['reason']>

/** Configuration for ChallengeAnalytics */
export interface AnalyticsConfig {
  /** Maximum number of solve-time samples to keep per difficulty.
   *  Older samples are discarded (sliding window). Default: 1000 */
  maxSamples?: number
  /** If true, track per-reason failure counts. Default: true */
  trackFailureReasons?: boolean
}

/** Per-difficulty metrics */
export interface DifficultyStats {
  generated: number
  verified: number
  failed: number
  expired: number
  suspicious: number
  avgSolveTimeMs: number
  minSolveTimeMs: number | null
  maxSolveTimeMs: number | null
  p95SolveTimeMs: number | null
  failureReasons: Record<string, number>
}

/** Aggregate summary across all difficulties */
export interface AnalyticsSummary {
  totalGenerated: number
  totalVerified: number
  totalFailed: number
  totalExpired: number
  totalSuspicious: number
  verificationRate: number
  avgSolveTimeMs: number
  uptimeMs: number
}

/** Full analytics snapshot */
export interface AnalyticsSnapshot {
  summary: AnalyticsSummary
  byDifficulty: Record<Difficulty, DifficultyStats>
  collectedAt: number
}

/**
 * Internal tracker for a single difficulty level.
 */
class DifficultyTracker {
  generated = 0
  verified = 0
  failed = 0
  expired = 0
  suspicious = 0
  failureReasons: Record<string, number> = {}

  private solveTimes: number[] = []
  private readonly maxSamples: number
  private readonly trackFailureReasons: boolean

  constructor(maxSamples: number, trackFailureReasons: boolean) {
    this.maxSamples = maxSamples
    this.trackFailureReasons = trackFailureReasons
  }

  recordSolveTime(ms: number): void {
    this.solveTimes.push(ms)
    if (this.solveTimes.length > this.maxSamples) {
      // Drop oldest 10% to avoid constant shifting
      const dropCount = Math.floor(this.maxSamples * 0.1)
      this.solveTimes = this.solveTimes.slice(dropCount)
    }
  }

  recordFailure(reason: string): void {
    if (this.trackFailureReasons) {
      this.failureReasons[reason] = (this.failureReasons[reason] ?? 0) + 1
    }
  }

  getAvgSolveTime(): number {
    if (this.solveTimes.length === 0) return 0
    const sum = this.solveTimes.reduce((a, b) => a + b, 0)
    return Math.round(sum / this.solveTimes.length)
  }

  getMinSolveTime(): number | null {
    if (this.solveTimes.length === 0) return null
    return Math.min(...this.solveTimes)
  }

  getMaxSolveTime(): number | null {
    if (this.solveTimes.length === 0) return null
    return Math.max(...this.solveTimes)
  }

  getP95SolveTime(): number | null {
    if (this.solveTimes.length === 0) return null
    const sorted = [...this.solveTimes].sort((a, b) => a - b)
    const idx = Math.ceil(sorted.length * 0.95) - 1
    return sorted[Math.min(idx, sorted.length - 1)]
  }

  toStats(): DifficultyStats {
    return {
      generated: this.generated,
      verified: this.verified,
      failed: this.failed,
      expired: this.expired,
      suspicious: this.suspicious,
      avgSolveTimeMs: this.getAvgSolveTime(),
      minSolveTimeMs: this.getMinSolveTime(),
      maxSolveTimeMs: this.getMaxSolveTime(),
      p95SolveTimeMs: this.getP95SolveTime(),
      failureReasons: { ...this.failureReasons },
    }
  }

  reset(): void {
    this.generated = 0
    this.verified = 0
    this.failed = 0
    this.expired = 0
    this.suspicious = 0
    this.failureReasons = {}
    this.solveTimes = []
  }
}

/**
 * In-memory challenge analytics tracker.
 *
 * Records challenge generation, verification, and failure events.
 * Provides real-time metrics with per-difficulty breakdowns,
 * solve-time percentiles, and failure-reason distributions.
 *
 * Memory-bounded: solve-time samples are capped per difficulty
 * (default: 1000 samples each) using a sliding window.
 */
export class ChallengeAnalytics {
  private readonly trackers: Record<Difficulty, DifficultyTracker>
  private readonly startedAt: number

  constructor(config?: AnalyticsConfig) {
    const maxSamples = config?.maxSamples ?? 1000
    const trackReasons = config?.trackFailureReasons ?? true
    this.startedAt = Date.now()

    this.trackers = {
      easy: new DifficultyTracker(maxSamples, trackReasons),
      medium: new DifficultyTracker(maxSamples, trackReasons),
      hard: new DifficultyTracker(maxSamples, trackReasons),
    }
  }

  /**
   * Record that a challenge was generated.
   */
  recordGenerated(difficulty: Difficulty): void {
    this.trackers[difficulty].generated++
  }

  /**
   * Record a successful verification.
   *
   * @param difficulty - Challenge difficulty
   * @param solveTimeMs - Time taken to solve in milliseconds
   * @param suspicious - Whether the solve time was suspiciously slow
   */
  recordVerified(difficulty: Difficulty, solveTimeMs: number, suspicious: boolean): void {
    const tracker = this.trackers[difficulty]
    tracker.verified++
    tracker.recordSolveTime(solveTimeMs)
    if (suspicious) {
      tracker.suspicious++
    }
  }

  /**
   * Record a failed verification attempt.
   *
   * @param difficulty - Challenge difficulty
   * @param reason - Failure reason from VerifyResult
   */
  recordFailed(difficulty: Difficulty, reason: FailureReason): void {
    const tracker = this.trackers[difficulty]
    tracker.failed++
    if (reason === 'expired') {
      tracker.expired++
    }
    tracker.recordFailure(reason)
  }

  /**
   * Get a full analytics snapshot.
   *
   * Returns aggregate summary plus per-difficulty breakdowns.
   */
  getStats(): AnalyticsSnapshot {
    const difficulties: Difficulty[] = ['easy', 'medium', 'hard']
    const byDifficulty = {} as Record<Difficulty, DifficultyStats>

    let totalGenerated = 0
    let totalVerified = 0
    let totalFailed = 0
    let totalExpired = 0
    let totalSuspicious = 0
    let totalSolveTime = 0
    let totalSolveCount = 0

    for (const d of difficulties) {
      const stats = this.trackers[d].toStats()
      byDifficulty[d] = stats

      totalGenerated += stats.generated
      totalVerified += stats.verified
      totalFailed += stats.failed
      totalExpired += stats.expired
      totalSuspicious += stats.suspicious

      if (stats.verified > 0) {
        totalSolveTime += stats.avgSolveTimeMs * stats.verified
        totalSolveCount += stats.verified
      }
    }

    const totalAttempts = totalVerified + totalFailed

    return {
      summary: {
        totalGenerated,
        totalVerified,
        totalFailed,
        totalExpired,
        totalSuspicious,
        verificationRate: totalAttempts > 0 ? totalVerified / totalAttempts : 0,
        avgSolveTimeMs: totalSolveCount > 0 ? Math.round(totalSolveTime / totalSolveCount) : 0,
        uptimeMs: Date.now() - this.startedAt,
      },
      byDifficulty,
      collectedAt: Date.now(),
    }
  }

  /**
   * Convenience method: returns stats as a plain JSON-serializable object.
   * Identical to getStats() but explicitly typed for serialization.
   */
  toJSON(): AnalyticsSnapshot {
    return this.getStats()
  }

  /**
   * Reset all analytics data. Useful for periodic rotation.
   */
  reset(): void {
    for (const tracker of Object.values(this.trackers)) {
      tracker.reset()
    }
  }
}
