/**
 * Optional OpenTelemetry metrics exporter for ChallengeAnalytics.
 *
 * Exports imrobot challenge metrics to any OpenTelemetry-compatible backend
 * (Datadog, Grafana, Prometheus, etc.) using only @opentelemetry/api as a
 * peer dependency — no bundled OTEL SDK.
 *
 * Install peer dependency:
 *   npm install @opentelemetry/api
 *
 * @example
 * ```typescript
 * import { metrics } from '@opentelemetry/api'
 * import { ChallengeAnalytics } from 'imrobot/server'
 * import { bindAnalyticsToOtel, createImRobotMetrics } from 'imrobot/server'
 *
 * const meter = metrics.getMeter('imrobot')
 * const otelMetrics = createImRobotMetrics(meter)
 * const analytics = new ChallengeAnalytics()
 *
 * // Record events — OTEL metrics update automatically
 * const bound = bindAnalyticsToOtel(analytics, otelMetrics)
 *
 * // Optional: export a periodic snapshot
 * bound.startPeriodicExport(30_000) // every 30s
 * ```
 *
 * @module
 */

import type { ChallengeAnalytics } from './analytics'
import type { Difficulty } from '../core/types'

/**
 * Minimal structural interface for an OTEL Meter.
 * Using structural typing keeps @opentelemetry/api as a true peer dep.
 */
export interface OtelMeter {
  createCounter(name: string, options?: { description?: string; unit?: string }): OtelCounter
  createHistogram(name: string, options?: { description?: string; unit?: string }): OtelHistogram
  createObservableGauge(name: string, options?: { description?: string; unit?: string }): OtelObservableGauge
}

export interface OtelCounter {
  add(value: number, attributes?: Record<string, string | number | boolean>): void
}

export interface OtelHistogram {
  record(value: number, attributes?: Record<string, string | number | boolean>): void
}

export interface OtelObservableGauge {
  addCallback(callback: (result: OtelObservableResult) => void): void
}

export interface OtelObservableResult {
  observe(value: number, attributes?: Record<string, string | number | boolean>): void
}

/**
 * The set of OTEL instruments created for imrobot metrics.
 */
export interface ImRobotOtelMetrics {
  /** Counter: number of challenges generated, by difficulty */
  challengesGenerated: OtelCounter
  /** Counter: number of challenges successfully solved, by difficulty */
  challengesSolved: OtelCounter
  /** Counter: number of challenge verification failures, by difficulty and reason */
  challengesFailed: OtelCounter
  /** Histogram: challenge solve times in milliseconds, by difficulty */
  solveTimeMs: OtelHistogram
}

/**
 * Create the standard set of imrobot OTEL instruments from a Meter.
 *
 * Instrument names follow OTEL semantic conventions:
 * - `imrobot.challenges.generated` (counter)
 * - `imrobot.challenges.solved` (counter)
 * - `imrobot.challenges.failed` (counter)
 * - `imrobot.solve_time_ms` (histogram)
 *
 * @param meter - An OTEL Meter instance
 */
export function createImRobotMetrics(meter: OtelMeter): ImRobotOtelMetrics {
  return {
    challengesGenerated: meter.createCounter('imrobot.challenges.generated', {
      description: 'Number of imrobot challenges generated',
      unit: '{challenge}',
    }),
    challengesSolved: meter.createCounter('imrobot.challenges.solved', {
      description: 'Number of imrobot challenges successfully solved by agents',
      unit: '{challenge}',
    }),
    challengesFailed: meter.createCounter('imrobot.challenges.failed', {
      description: 'Number of failed imrobot challenge verification attempts',
      unit: '{challenge}',
    }),
    solveTimeMs: meter.createHistogram('imrobot.solve_time_ms', {
      description: 'Time taken to solve imrobot challenges in milliseconds',
      unit: 'ms',
    }),
  }
}

/**
 * OTEL-instrumented wrapper around ChallengeAnalytics.
 *
 * Intercepts recordGenerated, recordVerified, and recordFailed calls
 * to emit OTEL metrics in real-time, in addition to in-memory tracking.
 */
export class OtelAnalyticsExporter {
  private readonly analytics: ChallengeAnalytics
  private readonly metrics: ImRobotOtelMetrics
  private periodicTimer: ReturnType<typeof setInterval> | null = null

  constructor(analytics: ChallengeAnalytics, metrics: ImRobotOtelMetrics) {
    this.analytics = analytics
    this.metrics = metrics
  }

  /**
   * Record a generated challenge and emit the OTEL counter.
   */
  recordGenerated(difficulty: Difficulty): void {
    this.analytics.recordGenerated(difficulty)
    this.metrics.challengesGenerated.add(1, { 'imrobot.difficulty': difficulty })
  }

  /**
   * Record a successful verification and emit OTEL counter + histogram.
   */
  recordVerified(difficulty: Difficulty, solveTimeMs: number, suspicious: boolean): void {
    this.analytics.recordVerified(difficulty, solveTimeMs, suspicious)
    this.metrics.challengesSolved.add(1, {
      'imrobot.difficulty': difficulty,
      'imrobot.suspicious': suspicious,
    })
    this.metrics.solveTimeMs.record(solveTimeMs, {
      'imrobot.difficulty': difficulty,
    })
  }

  /**
   * Record a failed verification and emit the OTEL counter.
   */
  recordFailed(difficulty: Difficulty, reason: string): void {
    this.analytics.recordFailed(difficulty, reason as never)
    this.metrics.challengesFailed.add(1, {
      'imrobot.difficulty': difficulty,
      'imrobot.reason': reason,
    })
  }

  /**
   * Start periodic export of the analytics snapshot as OTEL gauge observations.
   * Useful for exporting aggregated stats (p95, rates) on a schedule.
   *
   * @param intervalMs - Export interval in milliseconds. Default: 60_000 (1 min)
   */
  startPeriodicExport(intervalMs = 60_000): void {
    if (this.periodicTimer) return // Already running

    this.periodicTimer = setInterval(() => {
      this.exportSnapshot()
    }, intervalMs)

    this.periodicTimer.unref?.()
  }

  /**
   * Stop the periodic export timer.
   */
  stopPeriodicExport(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer)
      this.periodicTimer = null
    }
  }

  /**
   * Export a one-shot snapshot of all analytics stats as OTEL observations.
   * Records p95 solve time and verification rate as histogram/counter data.
   */
  exportSnapshot(): void {
    const stats = this.analytics.getStats()
    const difficulties: Difficulty[] = ['easy', 'medium', 'hard']

    for (const diff of difficulties) {
      const d = stats.byDifficulty[diff]
      if (d.p95SolveTimeMs !== null) {
        // Record p95 as a histogram observation labeled with the percentile
        this.metrics.solveTimeMs.record(d.p95SolveTimeMs, {
          'imrobot.difficulty': diff,
          'imrobot.percentile': 'p95',
        })
      }
    }
  }

  /**
   * Get the underlying ChallengeAnalytics instance.
   */
  getAnalytics(): ChallengeAnalytics {
    return this.analytics
  }
}

/**
 * Bind a ChallengeAnalytics instance to OTEL metrics and return
 * an OtelAnalyticsExporter that proxies all record calls.
 *
 * @param analytics - The ChallengeAnalytics instance to instrument
 * @param metrics - Pre-created OTEL metrics from createImRobotMetrics()
 */
export function bindAnalyticsToOtel(
  analytics: ChallengeAnalytics,
  metrics: ImRobotOtelMetrics
): OtelAnalyticsExporter {
  return new OtelAnalyticsExporter(analytics, metrics)
}
