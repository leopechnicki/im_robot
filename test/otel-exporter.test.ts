import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createImRobotMetrics, OtelAnalyticsExporter, bindAnalyticsToOtel } from '../src/server/otel-exporter'
import type { OtelMeter, OtelCounter, OtelHistogram, ImRobotOtelMetrics } from '../src/server/otel-exporter'
import { ChallengeAnalytics } from '../src/server/analytics'

/**
 * Create a mock OTEL meter for testing.
 */
function createMockMeter() {
  const counterAdds: Array<{ name: string; value: number; attrs: Record<string, unknown> }> = []
  const histogramRecords: Array<{ name: string; value: number; attrs: Record<string, unknown> }> = []

  function makeCounter(name: string): OtelCounter {
    return {
      add(value, attrs = {}) {
        counterAdds.push({ name, value, attrs })
      },
    }
  }

  function makeHistogram(name: string): OtelHistogram {
    return {
      record(value, attrs = {}) {
        histogramRecords.push({ name, value, attrs })
      },
    }
  }

  const meter: OtelMeter = {
    createCounter: vi.fn((name) => makeCounter(name)),
    createHistogram: vi.fn((name) => makeHistogram(name)),
    createObservableGauge: vi.fn(() => ({ addCallback: vi.fn() })),
  }

  return { meter, counterAdds, histogramRecords }
}

describe('createImRobotMetrics', () => {
  it('creates all four instruments', () => {
    const { meter } = createMockMeter()
    const m = createImRobotMetrics(meter)

    expect(meter.createCounter).toHaveBeenCalledWith('imrobot.challenges.generated', expect.any(Object))
    expect(meter.createCounter).toHaveBeenCalledWith('imrobot.challenges.solved', expect.any(Object))
    expect(meter.createCounter).toHaveBeenCalledWith('imrobot.challenges.failed', expect.any(Object))
    expect(meter.createHistogram).toHaveBeenCalledWith('imrobot.solve_time_ms', expect.any(Object))
    expect(m.challengesGenerated).toBeDefined()
    expect(m.challengesSolved).toBeDefined()
    expect(m.challengesFailed).toBeDefined()
    expect(m.solveTimeMs).toBeDefined()
  })
})

describe('OtelAnalyticsExporter', () => {
  let analytics: ChallengeAnalytics
  let mockMeter: ReturnType<typeof createMockMeter>
  let otelMetrics: ImRobotOtelMetrics
  let exporter: OtelAnalyticsExporter

  beforeEach(() => {
    analytics = new ChallengeAnalytics()
    mockMeter = createMockMeter()
    otelMetrics = createImRobotMetrics(mockMeter.meter)
    exporter = new OtelAnalyticsExporter(analytics, otelMetrics)
  })

  describe('recordGenerated', () => {
    it('increments the challengesGenerated counter with difficulty attribute', () => {
      exporter.recordGenerated('medium')
      const add = mockMeter.counterAdds.find(a => a.name === 'imrobot.challenges.generated')
      expect(add).toBeDefined()
      expect(add!.value).toBe(1)
      expect(add!.attrs['imrobot.difficulty']).toBe('medium')
    })

    it('also records in the underlying analytics', () => {
      exporter.recordGenerated('hard')
      const stats = analytics.getStats()
      expect(stats.summary.totalGenerated).toBe(1)
      expect(stats.byDifficulty.hard.generated).toBe(1)
    })
  })

  describe('recordVerified', () => {
    it('increments the challengesSolved counter', () => {
      exporter.recordVerified('easy', 150, false)
      const add = mockMeter.counterAdds.find(a => a.name === 'imrobot.challenges.solved')
      expect(add).toBeDefined()
      expect(add!.value).toBe(1)
      expect(add!.attrs['imrobot.difficulty']).toBe('easy')
      expect(add!.attrs['imrobot.suspicious']).toBe(false)
    })

    it('records solve time in the histogram', () => {
      exporter.recordVerified('medium', 250, false)
      const rec = mockMeter.histogramRecords.find(r => r.name === 'imrobot.solve_time_ms')
      expect(rec).toBeDefined()
      expect(rec!.value).toBe(250)
      expect(rec!.attrs['imrobot.difficulty']).toBe('medium')
    })

    it('marks suspicious flag in counter attributes', () => {
      exporter.recordVerified('hard', 5000, true)
      const add = mockMeter.counterAdds.find(a =>
        a.name === 'imrobot.challenges.solved' && a.attrs['imrobot.suspicious'] === true
      )
      expect(add).toBeDefined()
    })
  })

  describe('recordFailed', () => {
    it('increments the challengesFailed counter with reason', () => {
      exporter.recordFailed('medium', 'wrong_answer')
      const add = mockMeter.counterAdds.find(a => a.name === 'imrobot.challenges.failed')
      expect(add).toBeDefined()
      expect(add!.attrs['imrobot.reason']).toBe('wrong_answer')
    })
  })

  describe('exportSnapshot', () => {
    it('records p95 solve time when data is available', () => {
      // Record some solved challenges
      exporter.recordVerified('easy', 100, false)
      exporter.recordVerified('easy', 200, false)
      exporter.recordVerified('easy', 300, false)

      const countBefore = mockMeter.histogramRecords.length
      exporter.exportSnapshot()
      const countAfter = mockMeter.histogramRecords.length

      // Should have added at least one p95 record
      expect(countAfter).toBeGreaterThan(countBefore)
      const p95Record = mockMeter.histogramRecords.find(r => r.attrs['imrobot.percentile'] === 'p95')
      expect(p95Record).toBeDefined()
    })

    it('does not record p95 when no data', () => {
      const countBefore = mockMeter.histogramRecords.length
      exporter.exportSnapshot()
      // No data recorded, p95 is null, no histogram records added
      expect(mockMeter.histogramRecords.length).toBe(countBefore)
    })
  })

  describe('getAnalytics', () => {
    it('returns the underlying ChallengeAnalytics instance', () => {
      expect(exporter.getAnalytics()).toBe(analytics)
    })
  })
})

describe('bindAnalyticsToOtel', () => {
  it('creates an OtelAnalyticsExporter wrapping the provided analytics', () => {
    const analytics = new ChallengeAnalytics()
    const { meter } = createMockMeter()
    const metrics = createImRobotMetrics(meter)

    const exporter = bindAnalyticsToOtel(analytics, metrics)
    expect(exporter).toBeInstanceOf(OtelAnalyticsExporter)
    expect(exporter.getAnalytics()).toBe(analytics)
  })
})
