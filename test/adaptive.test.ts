import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AdaptiveDifficulty } from '../src/core/adaptive'

describe('AdaptiveDifficulty', () => {
  let adaptive: AdaptiveDifficulty

  beforeEach(() => {
    adaptive = new AdaptiveDifficulty({
      initialDifficulty: 'medium',
      escalateAfterFailures: 2,
      relaxAfterSuccesses: 3,
    })
  })

  describe('getDifficulty', () => {
    it('returns initial difficulty for unknown agents', () => {
      expect(adaptive.getDifficulty('new_agent')).toBe('medium')
    })

    it('escalates after consecutive failures', () => {
      adaptive.recordAttempt('agent1', { success: false, solveTimeMs: 100 })
      expect(adaptive.getDifficulty('agent1')).toBe('medium') // not yet

      adaptive.recordAttempt('agent1', { success: false, solveTimeMs: 100 })
      expect(adaptive.getDifficulty('agent1')).toBe('hard') // now escalated
    })

    it('relaxes after consecutive successes', () => {
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 })
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 })
      expect(adaptive.getDifficulty('agent1')).toBe('medium') // not yet

      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 })
      expect(adaptive.getDifficulty('agent1')).toBe('easy') // now relaxed
    })

    it('does not go below easy', () => {
      const a = new AdaptiveDifficulty({
        initialDifficulty: 'easy',
        relaxAfterSuccesses: 1,
      })
      a.recordAttempt('agent1', { success: true, solveTimeMs: 50 })
      expect(a.getDifficulty('agent1')).toBe('easy')
    })

    it('does not go above hard', () => {
      const a = new AdaptiveDifficulty({
        initialDifficulty: 'hard',
        escalateAfterFailures: 1,
      })
      a.recordAttempt('agent1', { success: false, solveTimeMs: 50 })
      expect(a.getDifficulty('agent1')).toBe('hard')
    })

    it('resets consecutive counter on mixed results', () => {
      adaptive.recordAttempt('agent1', { success: false, solveTimeMs: 100 })
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 }) // resets failures
      adaptive.recordAttempt('agent1', { success: false, solveTimeMs: 100 })
      // Only 1 consecutive failure, not enough to escalate
      expect(adaptive.getDifficulty('agent1')).toBe('medium')
    })
  })

  describe('getRiskScore', () => {
    it('returns 0 for unknown agents', () => {
      expect(adaptive.getRiskScore('unknown')).toBe(0)
    })

    it('increases with failures', () => {
      for (let i = 0; i < 5; i++) {
        adaptive.recordAttempt('failing_agent', { success: false, solveTimeMs: 100 })
      }
      expect(adaptive.getRiskScore('failing_agent')).toBeGreaterThan(0.2)
    })

    it('stays low for consistent successes', () => {
      for (let i = 0; i < 5; i++) {
        adaptive.recordAttempt('good_agent', { success: true, solveTimeMs: 100 })
      }
      expect(adaptive.getRiskScore('good_agent')).toBeLessThan(0.2)
    })
  })

  describe('getRiskAssessment', () => {
    it('returns structured assessment', () => {
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 })
      const assessment = adaptive.getRiskAssessment('agent1')
      expect(assessment).toHaveProperty('score')
      expect(assessment).toHaveProperty('factors')
      expect(assessment).toHaveProperty('level')
      expect(['low', 'medium', 'high', 'critical']).toContain(assessment.level)
    })

    it('flags suspicious timing', () => {
      // Very slow attempts
      for (let i = 0; i < 5; i++) {
        adaptive.recordAttempt('slow_agent', { success: true, solveTimeMs: 10_000 })
      }
      const assessment = adaptive.getRiskAssessment('slow_agent')
      expect(assessment.factors.abnormalTiming).toBeGreaterThan(0)
    })
  })

  describe('getProfile', () => {
    it('returns undefined for unknown agents', () => {
      expect(adaptive.getProfile('unknown')).toBeUndefined()
    })

    it('returns profile with correct stats', () => {
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 })
      adaptive.recordAttempt('agent1', { success: false, solveTimeMs: 200 })

      const profile = adaptive.getProfile('agent1')
      expect(profile).toBeDefined()
      expect(profile!.totalAttempts).toBe(2)
      expect(profile!.totalSuccesses).toBe(1)
      expect(profile!.consecutiveFailures).toBe(1)
      expect(profile!.consecutiveSuccesses).toBe(0)
    })
  })

  describe('reset', () => {
    it('resets a specific agent', () => {
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 })
      adaptive.reset('agent1')
      expect(adaptive.getProfile('agent1')).toBeUndefined()
    })

    it('resets all agents when no key provided', () => {
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 100 })
      adaptive.recordAttempt('agent2', { success: true, solveTimeMs: 100 })
      adaptive.reset()
      expect(adaptive.size).toBe(0)
    })
  })

  describe('listAgents', () => {
    it('returns empty array when no agents are tracked', () => {
      expect(adaptive.listAgents()).toEqual([])
    })

    it('returns the tracked agent ids', () => {
      adaptive.recordAttempt('agent-a', { success: true, solveTimeMs: 50 })
      adaptive.recordAttempt('agent-b', { success: false, solveTimeMs: 200 })
      const agents = adaptive.listAgents()
      expect(agents).toHaveLength(2)
      expect(agents).toContain('agent-a')
      expect(agents).toContain('agent-b')
    })

    it('reflects additions and removals', () => {
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 50 })
      expect(adaptive.listAgents()).toContain('agent1')
      adaptive.reset('agent1')
      expect(adaptive.listAgents()).not.toContain('agent1')
    })

    it('returns a snapshot — mutations to the returned array do not affect internal state', () => {
      adaptive.recordAttempt('agent1', { success: true, solveTimeMs: 50 })
      const agents = adaptive.listAgents()
      agents.push('injected')
      expect(adaptive.size).toBe(1)
    })
  })

  describe('maxAgents eviction (LRU)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('tracks up to maxAgents without eviction', () => {
      const a = new AdaptiveDifficulty({ maxAgents: 3 })
      a.recordAttempt('x', { success: true, solveTimeMs: 10 })
      a.recordAttempt('y', { success: true, solveTimeMs: 10 })
      a.recordAttempt('z', { success: true, solveTimeMs: 10 })
      expect(a.size).toBe(3)
      expect(a.getProfile('x')).toBeDefined()
      expect(a.getProfile('y')).toBeDefined()
      expect(a.getProfile('z')).toBeDefined()
    })

    it('caps size at maxAgents when new agents arrive', () => {
      const a = new AdaptiveDifficulty({ maxAgents: 3 })
      a.recordAttempt('x', { success: true, solveTimeMs: 10 })
      a.recordAttempt('y', { success: true, solveTimeMs: 10 })
      a.recordAttempt('z', { success: true, solveTimeMs: 10 })
      a.recordAttempt('w', { success: true, solveTimeMs: 10 })
      expect(a.size).toBe(3)
    })

    it('evicts the least-recently-seen agent when at capacity', () => {
      vi.useFakeTimers()
      const a = new AdaptiveDifficulty({ maxAgents: 3 })

      vi.setSystemTime(1_000)
      a.recordAttempt('agent-a', { success: true, solveTimeMs: 10 })
      vi.setSystemTime(2_000)
      a.recordAttempt('agent-b', { success: true, solveTimeMs: 10 })
      vi.setSystemTime(3_000)
      a.recordAttempt('agent-c', { success: true, solveTimeMs: 10 })
      // agent-a is now the LRU (lastSeen = 1000)

      vi.setSystemTime(4_000)
      a.recordAttempt('agent-d', { success: true, solveTimeMs: 10 })

      expect(a.size).toBe(3)
      expect(a.getProfile('agent-a')).toBeUndefined()
      expect(a.getProfile('agent-b')).toBeDefined()
      expect(a.getProfile('agent-c')).toBeDefined()
      expect(a.getProfile('agent-d')).toBeDefined()
    })

    it('updates lastSeen on subsequent recordAttempt calls, promoting agent in LRU order', () => {
      vi.useFakeTimers()
      const a = new AdaptiveDifficulty({ maxAgents: 3 })

      vi.setSystemTime(1_000)
      a.recordAttempt('agent-a', { success: true, solveTimeMs: 10 })
      vi.setSystemTime(2_000)
      a.recordAttempt('agent-b', { success: true, solveTimeMs: 10 })
      vi.setSystemTime(3_000)
      a.recordAttempt('agent-c', { success: true, solveTimeMs: 10 })

      // Re-access agent-a, making it the most recently seen
      vi.setSystemTime(4_000)
      a.recordAttempt('agent-a', { success: true, solveTimeMs: 10 })
      // agent-b is now the LRU (lastSeen = 2000)

      vi.setSystemTime(5_000)
      a.recordAttempt('agent-d', { success: true, solveTimeMs: 10 })

      expect(a.size).toBe(3)
      expect(a.getProfile('agent-b')).toBeUndefined()
      expect(a.getProfile('agent-a')).toBeDefined()
      expect(a.getProfile('agent-c')).toBeDefined()
      expect(a.getProfile('agent-d')).toBeDefined()
    })

    it('newly added agent is immediately available after eviction', () => {
      vi.useFakeTimers()
      const a = new AdaptiveDifficulty({ maxAgents: 2 })

      vi.setSystemTime(1_000)
      a.recordAttempt('old', { success: true, solveTimeMs: 10 })
      vi.setSystemTime(2_000)
      a.recordAttempt('recent', { success: true, solveTimeMs: 10 })

      vi.setSystemTime(3_000)
      a.recordAttempt('new-agent', { success: false, solveTimeMs: 10 })

      const profile = a.getProfile('new-agent')
      expect(profile).toBeDefined()
      expect(profile!.totalAttempts).toBe(1)
      expect(profile!.totalSuccesses).toBe(0)
    })
  })
})
