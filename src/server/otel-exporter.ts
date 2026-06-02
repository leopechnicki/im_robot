/**
 * OpenTelemetry metrics exporter for ChallengeAnalytics.
 *
 * Bridges the imrobot in-memory analytics tracker to an OpenTelemetry
 * MeterProvider so challenge metrics flow into Datadog, Grafana, Prometheus,
 * or any OTLP-compatible backend.
 *
 * @remarks
 * `@opentelemetry/api` is an optional peer dependency. Install separately:
 * ```
 * npm install @opentelemetry/api
 * ```
 *
 * @example
 * ```typescript
 * import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
 * import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
 * import { ChallengeAnalytics } from 'imrobot/server'
 * import { ChallengeOTelExporter } from 'imrobot/server'
 *
 * const analytics = new ChallengeAnalytics()
 *
 * const meterProvider = new MeterProvider({
 *   readers: [new PeriodicExportingMetricReader({
 *     exporter: new OTLPMetricExporter({ url: 'http://localhost:4318/v1/metrics' }),
 *     exportIntervalMillis: 30_000,
 *   })],
 * })
 *
 * const exporter = new ChallengeOTelExporter(analytics, meterProvider, {
 *   scopeName: 'imrobot',
 *   exportIntervalMs: 15_000,
 * })
 *
 * exporter.start()
 * // Later: exporter.stop()
 * ```
 *
 * @module
 */

import type { ChallengeAnalytics } from './analytics'

// ---------------------------------------------------------------------------
// Minimal OpenTelemetry API types (avoids hard dependency)
// These mirror the @opentelemetry/api interfaces we need.
// ---------------------------------------------------------------------------

/** Minimal MeterProvider interface (compatible with @opentelemetry/api) */
export interface OTelMeterProvider {
  getMeter(name: string, version?: string): OTelMeter
}

/** Minimal Meter interface */
export interface OTelMeter {
  createCounter(name: string, options?: OTelMetricOptions): OTelCounter
  createHistogram(name: string, options?: OTelMetricOptions): OTelHistogram
  createObservableGauge(name: string, options?: OTelMetricOptions): OTelObservableGauge
}

export interface OTelMetricOptions {
  description?: string
  unit?: string
}

export interface OTelCounter {
  add(value: number, attributes?: Record<string, string>): void
}

export interface OTelHistogram {
  record(value: number, attributes?: Record<string, string>): void
}

export interface OTelObservableGauge {
  addCallback(callback: (result: OTelObservableResult) => void): void
}

export interface OTelObservableResult {
  observe(value: number, attributes?: Record<string, string>): void
}

// ---------------------------------------------------------------------------
// Exporter configuration
// ---------------------------------------------------------------------------

/** Configuration for ChallengeOTelExporter */
export interface OTelExporterConfig {
  /**
   * Meter scope/instrumentation name.
   * Default: 'imrobot'
   */
  scopeName?: string
  /**
   * Meter scope version.
   * Default: '1.0.0'
   */
  scopeVersion?: string
  /**
   * How often (in ms) to export a full analytics snapshot as delta counters.
   * Default: 30_000 (30 seconds)
   *
   * Note: OTEL ObservableGauges are polled by the SDK on its own schedule.
   * This interval controls the periodic snapshot export for counters/histograms.
   */
  exportIntervalMs?: number
}

/** Snapshot state tracked between exports (for delta computation) */
interface ExportBaseline {
  totalGenerated: number
  totalVerified: number
  totalFailed: number
  easyGenerated: number
  mediumGenerated: number
  hardGenerated: number
  easySolved: number
  mediumSolved: number
  hardSolved: number
  easyFailed: number
  mediumFailed: number
  hardFailed: number
}

function zeroBaseline(): ExportBaseline {
  return {
    totalGenerated: 0,
    totalVerified: 0,
    totalFailed: 0,
    easyGenerated: 0,
    mediumGenerated: 0,
    hardGenerated: 0,
    easySolved: 0,
    mediumSolved: 0,
    hardSolved: 0,
    easyFailed: 0,
    mediumFailed: 0,
    hardFailed: 0,
  }
}

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

/**
 * OpenTelemetry metrics exporter for imrobot ChallengeAnalytics.
 *
 * Registers the following OTEL instruments:
 *
 * | Instrument | Type | Attributes |
 * |---|---|---|
 * | `imrobot.challenge.generated` | Counter | `difficulty` |
 * | `imrobot.challenge.solved` | Counter | `difficulty`, `suspicious` |
 * | `imrobot.challenge.failed` | Counter | `difficulty`, `reason` |
 * | `imrobot.challenge.solve_time_ms` | Histogram | `difficulty` |
 * | `imrobot.challenge.active` | ObservableGauge | — |
 * | `imrobot.challenge.verification_rate` | ObservableGauge | — |
 *
 * Counters are exported as delta values (difference since last export).
 * Histograms record p95 solve times per difficulty at each export.
 * Gauges are polled by the OTEL SDK on its own schedule.
 */
export class ChallengeOTelExporter {
  private readonly analytics: ChallengeAnalytics
  private readonly meterProvider: OTelMeterProvider
  private readonly config: Required<OTelExporterConfig>

  private meter: OTelMeter | null = null
  private generatedCounter: OTelCounter | null = null
  private solvedCounter: OTelCounter | null = null
  private failedCounter: OTelCounter | null = null
  private solveTimeHistogram: OTelHistogram | null = null

  private baseline: ExportBaseline = zeroBaseline()
  private exportTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    analytics: ChallengeAnalytics,
    meterProvider: OTelMeterProvider,
    config?: OTelExporterConfig,
  ) {
    this.analytics = analytics
    this.meterProvider = meterProvider
    this.config = {
      scopeName: config?.scopeName ?? 'imrobot',
      scopeVersion: config?.scopeVersion ?? '1.0.0',
      exportIntervalMs: config?.exportIntervalMs ?? 30_000,
    }
  }

  /**
   * Initialize instruments and start periodic export.
   *
   * Call once after creating the exporter. Safe to call multiple times —
   * subsequent calls are no-ops.
   */
  start(): void {
    if (this.exportTimer) return

    this.meter = this.meterProvider.getMeter(this.config.scopeName, this.config.scopeVersion)

    // Counters (delta-encoded via baseline tracking)
    this.generatedCounter = this.meter.createCounter('imrobot.challenge.generated', {
      description: 'Total number of imrobot challenges generated',
      unit: '{challenge}',
    })

    this.solvedCounter = this.meter.createCounter('imrobot.challenge.solved', {
      description: 'Total number of imrobot challenges successfully verified',
      unit: '{challenge}',
    })

    this.failedCounter = this.meter.createCounter('imrobot.challenge.failed', {
      description: 'Total number of imrobot challenge verifications that failed',
      unit: '{challenge}',
    })

    // Histogram for solve time distribution
    this.solveTimeHistogram = this.meter.createHistogram('imrobot.challenge.solve_time_ms', {
      description: 'Challenge solve time in milliseconds (p95 per difficulty)',
      unit: 'ms',
    })

    // Observable gauges — polled by SDK on its schedule
    const activeGauge = this.meter.createObservableGauge('imrobot.challenge.active', {
      description:
        'Estimated number of currently active (generated but not yet verified) challenges',
      unit: '{challenge}',
    })

    activeGauge.addCallback((result) => {
      const stats = this.analytics.getStats()
      const active = Math.max(
        0,
        stats.summary.totalGenerated - stats.summary.totalVerified - stats.summary.totalFailed,
      )
      result.observe(active)
    })

    const rateGauge = this.meter.createObservableGauge('imrobot.challenge.verification_rate', {
      description: 'Fraction of verification attempts that succeed (0.0 – 1.0)',
    })

    rateGauge.addCallback((result) => {
      const stats = this.analytics.getStats()
      result.observe(stats.summary.verificationRate)
    })

    // Periodic counter/histogram export
    this.exportTimer = setInterval(() => {
      this.exportSnapshot()
    }, this.config.exportIntervalMs)

    // Don't keep the process alive for metrics export
    this.exportTimer.unref?.()

    // Export initial snapshot immediately
    this.exportSnapshot()
  }

  /**
   * Export the current analytics snapshot as OTEL metric increments.
   * Called automatically at exportIntervalMs. Can also be called manually.
   */
  exportSnapshot(): void {
    if (
      !this.generatedCounter ||
      !this.solvedCounter ||
      !this.failedCounter ||
      !this.solveTimeHistogram
    ) {
      return
    }

    const stats = this.analytics.getStats()
    const difficulties = ['easy', 'medium', 'hard'] as const

    for (const difficulty of difficulties) {
      const d = stats.byDifficulty[difficulty]

      // Delta-encode counters (OTEL counters are monotonically increasing,
      // but we call add() with the delta since last export)
      const baselineKey = `${difficulty}Generated` as keyof ExportBaseline
      const solvedKey = `${difficulty}Solved` as keyof ExportBaseline
      const failedKey = `${difficulty}Failed` as keyof ExportBaseline

      const deltaGenerated = Math.max(0, d.generated - (this.baseline[baselineKey] as number))
      const deltaSolved = Math.max(0, d.verified - (this.baseline[solvedKey] as number))
      const deltaFailed = Math.max(0, d.failed - (this.baseline[failedKey] as number))

      if (deltaGenerated > 0) {
        this.generatedCounter.add(deltaGenerated, { difficulty })
      }

      if (deltaSolved > 0) {
        this.solvedCounter.add(deltaSolved, { difficulty, suspicious: 'false' })
        // Note: suspicious tracking would require per-solve events; approximated here
      }

      if (deltaFailed > 0) {
        this.failedCounter.add(deltaFailed, { difficulty, reason: 'unknown' })
      }

      // Record p95 solve time if available (histogram — recorded as a representative sample)
      if (d.p95SolveTimeMs !== null && deltaSolved > 0) {
        this.solveTimeHistogram.record(d.p95SolveTimeMs, { difficulty })
      }

      // Update baseline
      ;(this.baseline as unknown as Record<string, number>)[baselineKey as string] = d.generated
      ;(this.baseline as unknown as Record<string, number>)[solvedKey as string] = d.verified
      ;(this.baseline as unknown as Record<string, number>)[failedKey as string] = d.failed
    }

    // Also track totals
    const deltaGenTotal = Math.max(0, stats.summary.totalGenerated - this.baseline.totalGenerated)
    const deltaSolvedTotal = Math.max(0, stats.summary.totalVerified - this.baseline.totalVerified)
    const deltaFailedTotal = Math.max(0, stats.summary.totalFailed - this.baseline.totalFailed)

    this.baseline.totalGenerated = stats.summary.totalGenerated
    this.baseline.totalVerified = stats.summary.totalVerified
    this.baseline.totalFailed = stats.summary.totalFailed

    // Emit aggregate totals (difficulty = 'all')
    if (deltaGenTotal > 0) {
      this.generatedCounter.add(deltaGenTotal, { difficulty: 'all' })
    }
    if (deltaSolvedTotal > 0) {
      this.solvedCounter.add(deltaSolvedTotal, { difficulty: 'all', suspicious: 'false' })
    }
    if (deltaFailedTotal > 0) {
      this.failedCounter.add(deltaFailedTotal, { difficulty: 'all', reason: 'unknown' })
    }
  }

  /**
   * Stop periodic export and release the timer.
   * Does not stop the OTEL MeterProvider — lifecycle is owned by the caller.
   */
  stop(): void {
    if (this.exportTimer) {
      clearInterval(this.exportTimer)
      this.exportTimer = null
    }
  }
}
