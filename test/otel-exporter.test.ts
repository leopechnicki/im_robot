import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ChallengeAnalytics } from '../src/server/analytics'
import { ChallengeOTelExporter } from '../src/server/otel-exporter'
import type {
  OTelMeterProvider,
  OTelMeter,
  OTelCounter,
  OTelHistogram,
  OTelObservableGauge,
  OTelObservableResult,
} from '../src/server/otel-exporter'

// ---------------------------------------------------------------------------
// Mock OTEL meter provider
// ---------------------------------------------------------------------------

interface CounterCall {
  value: number
  attributes: Record<string, string>
}

interface HistogramCall {
  value: number
  attributes: Record<string, string>
}

interface GaugeObservation {
  value: number
  attributes: Record<string, string>
}

function createMockMeterProvider() {
  const counterCalls: Record<string, CounterCall[]> = {}
  const histogramCalls: Record<string, HistogramCall[]> = {}
  const gaugeCallbacks: Record<string, Array<(result: OTelObservableResult) => void>> = {}
  const gaugeObservations: Record<string, GaugeObservation[]> = {}

  const makeCounter = (name: string): OTelCounter => ({
    add(value, attributes = {}) {
      if (!counterCalls[name]) counterCalls[name] = []
      counterCalls[name].push({ value, attributes: attributes as Record<string, string> })
    },
  })

  const makeHistogram = (name: string): OTelHistogram => ({
    record(value, attributes = {}) {
      if (!histogramCalls[name]) histogramCalls[name] = []
      histogramCalls[name].push({ value, attributes: attributes as Record<string, string> })
    },
  })

  const makeGauge = (name: string): OTelObservableGauge => ({
    addCallback(callback) {
      if (!gaugeCallbacks[name]) gaugeCallbacks[name] = []
      gaugeCallbacks[name].push(callback)
    },
  })

  const meter: OTelMeter = {
    createCounter: (name) => makeCounter(name),
    createHistogram: (name) => makeHistogram(name),
    createObservableGauge: (name) => makeGauge(name),
  }

  const provider: OTelMeterProvider = {
    getMeter: () => meter,
  }

  /** Trigger all registered gauge callbacks and collect observations */
  function triggerGauges() {
    for (const [name, callbacks] of Object.entries(gaugeCallbacks)) {
      if (!gaugeObservations[name]) gaugeObservations[name] = []
      const result: OTelObservableResult = {
        observe(value, attributes = {}) {
          gaugeObservations[name].push({ value, attributes: attributes as Record<string, string> })
        },
      }
      for (const cb of callbacks) cb(result)
    }
  }

  return { provider, counterCalls, histogramCalls, gaugeObservations, triggerGauges }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChallengeOTelExporter', () => {
  let analytics: ChallengeAnalytics
  let mock: ReturnType<typeof createMockMeterProvider>
  let exporter: ChallengeOTelExporter

  beforeEach(() => {
    analytics = new ChallengeAnalytics()
    mock = createMockMeterProvider()
  })

  afterEach(() => {
    exporter?.stop()
  })

  describe('start()', () => {
    it('initializes without error', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider)
      expect(() => exporter.start()).not.toThrow()
    })

    it('is idempotent — calling start() multiple times is safe', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider)
      exporter.start()
      exporter.start() // should not throw or double-register
    })
  })

  describe('exportSnapshot() — counters', () => {
    it('exports zero delta when no events have been recorded', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      // No events recorded — counters should not have been called with non-zero values
      const generated = mock.counterCalls['imrobot.challenge.generated'] ?? []
      const nonZero = generated.filter((c) => c.value > 0)
      expect(nonZero.length).toBe(0)
    })

    it('exports challenge.generated counter after recordGenerated', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      analytics.recordGenerated('easy')
      analytics.recordGenerated('easy')
      analytics.recordGenerated('medium')

      exporter.exportSnapshot()

      const calls = mock.counterCalls['imrobot.challenge.generated'] ?? []
      const easyCalls = calls.filter((c) => c.attributes.difficulty === 'easy')
      const totalEasyDelta = easyCalls.reduce((sum, c) => sum + c.value, 0)
      // 2 easy generated + 'all' includes them too
      expect(totalEasyDelta).toBeGreaterThanOrEqual(2)
    })

    it('exports challenge.solved counter after recordVerified', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      analytics.recordVerified('medium', 200, false)
      analytics.recordVerified('medium', 150, false)

      exporter.exportSnapshot()

      const calls = mock.counterCalls['imrobot.challenge.solved'] ?? []
      const mediumCalls = calls.filter((c) => c.attributes.difficulty === 'medium')
      const totalDelta = mediumCalls.reduce((sum, c) => sum + c.value, 0)
      expect(totalDelta).toBeGreaterThanOrEqual(2)
    })

    it('exports challenge.failed counter after recordFailed', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      analytics.recordFailed('hard', 'wrong_answer')
      analytics.recordFailed('hard', 'expired')

      exporter.exportSnapshot()

      const calls = mock.counterCalls['imrobot.challenge.failed'] ?? []
      const hardCalls = calls.filter((c) => c.attributes.difficulty === 'hard')
      const totalDelta = hardCalls.reduce((sum, c) => sum + c.value, 0)
      expect(totalDelta).toBeGreaterThanOrEqual(2)
    })

    it('delta-encodes counters — no double-counting across exports', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      analytics.recordGenerated('easy')
      exporter.exportSnapshot() // exports delta=1

      // Count before second event
      const callsBefore = (mock.counterCalls['imrobot.challenge.generated'] ?? []).length

      // No new events — second export should not add more easy delta
      exporter.exportSnapshot()

      const callsAfter = (mock.counterCalls['imrobot.challenge.generated'] ?? []).length
      // No new easy events, so call count for easy should be unchanged
      const newEasyCalls = (mock.counterCalls['imrobot.challenge.generated'] ?? [])
        .slice(callsBefore)
        .filter((c) => c.attributes.difficulty === 'easy' && c.value > 0)

      expect(newEasyCalls.length).toBe(0)
    })
  })

  describe('exportSnapshot() — histogram', () => {
    it('records solve time histogram for difficulty with solved challenges', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      analytics.recordVerified('easy', 300, false)
      analytics.recordVerified('easy', 250, false)

      exporter.exportSnapshot()

      const calls = mock.histogramCalls['imrobot.challenge.solve_time_ms'] ?? []
      const easyCalls = calls.filter((c) => c.attributes.difficulty === 'easy')
      expect(easyCalls.length).toBeGreaterThan(0)
      expect(easyCalls[0].value).toBeGreaterThan(0)
    })

    it('does not record histogram when no challenges have been solved', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      // No recordVerified calls
      exporter.exportSnapshot()

      const calls = mock.histogramCalls['imrobot.challenge.solve_time_ms'] ?? []
      expect(calls.length).toBe(0)
    })
  })

  describe('ObservableGauge — active challenges', () => {
    it('reports active challenges (generated minus verified minus failed)', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      analytics.recordGenerated('medium')
      analytics.recordGenerated('medium')
      analytics.recordGenerated('medium')
      analytics.recordVerified('medium', 100, false)

      mock.triggerGauges()

      const obs = mock.gaugeObservations['imrobot.challenge.active'] ?? []
      expect(obs.length).toBeGreaterThan(0)
      // 3 generated - 1 verified = 2 active
      expect(obs[obs.length - 1].value).toBe(2)
    })

    it('never reports negative active count', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      // More verified than generated (shouldn't happen, but guard anyway)
      analytics.recordVerified('easy', 100, false)

      mock.triggerGauges()

      const obs = mock.gaugeObservations['imrobot.challenge.active'] ?? []
      for (const o of obs) {
        expect(o.value).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('ObservableGauge — verification rate', () => {
    it('reports 0 verification rate when no attempts', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      mock.triggerGauges()

      const obs = mock.gaugeObservations['imrobot.challenge.verification_rate'] ?? []
      expect(obs.length).toBeGreaterThan(0)
      expect(obs[0].value).toBe(0)
    })

    it('reports correct verification rate after events', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 60_000 })
      exporter.start()

      analytics.recordVerified('medium', 100, false)
      analytics.recordVerified('medium', 150, false)
      analytics.recordFailed('medium', 'wrong_answer')

      mock.triggerGauges()

      const obs = mock.gaugeObservations['imrobot.challenge.verification_rate'] ?? []
      // 2 verified / 3 total = 0.666...
      const last = obs[obs.length - 1]
      expect(last.value).toBeCloseTo(2 / 3, 5)
    })
  })

  describe('stop()', () => {
    it('stops the periodic export timer', () => {
      vi.useFakeTimers()
      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 1_000 })
      exporter.start()

      analytics.recordGenerated('easy')
      const countBefore = (mock.counterCalls['imrobot.challenge.generated'] ?? []).length

      exporter.stop()

      // Advance time — timer should not fire after stop
      vi.advanceTimersByTime(5_000)
      const countAfter = (mock.counterCalls['imrobot.challenge.generated'] ?? []).length

      expect(countAfter).toBe(countBefore)

      vi.useRealTimers()
    })

    it('can be called multiple times without error', () => {
      exporter = new ChallengeOTelExporter(analytics, mock.provider)
      exporter.start()
      exporter.stop()
      expect(() => exporter.stop()).not.toThrow()
    })
  })

  describe('configuration', () => {
    it('uses custom scopeName for getMeter', () => {
      let capturedName = ''
      const customProvider: OTelMeterProvider = {
        getMeter(name) {
          capturedName = name
          return mock.provider.getMeter(name)
        },
      }

      exporter = new ChallengeOTelExporter(analytics, customProvider, {
        scopeName: 'my-service',
      })
      exporter.start()
      expect(capturedName).toBe('my-service')
    })

    it('respects exportIntervalMs for periodic export timing', () => {
      vi.useFakeTimers()

      exporter = new ChallengeOTelExporter(analytics, mock.provider, { exportIntervalMs: 5_000 })
      exporter.start()

      analytics.recordGenerated('hard')
      const countAfterStart = (mock.counterCalls['imrobot.challenge.generated'] ?? []).length

      // Advance less than interval — should not export again
      vi.advanceTimersByTime(4_000)
      expect((mock.counterCalls['imrobot.challenge.generated'] ?? []).length).toBe(countAfterStart)

      // Advance past interval — should export
      vi.advanceTimersByTime(1_001)
      expect((mock.counterCalls['imrobot.challenge.generated'] ?? []).length).toBeGreaterThan(countAfterStart)

      vi.useRealTimers()
    })
  })
})
