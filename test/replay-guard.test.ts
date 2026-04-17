import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ChallengeReplayGuard } from '../src/server/replay-guard'

describe('ChallengeReplayGuard', () => {
  let guard: ChallengeReplayGuard

  afterEach(() => {
    guard?.destroy()
  })

  describe('constructor', () => {
    it('creates instance with default config', () => {
      guard = new ChallengeReplayGuard()
      expect(guard).toBeDefined()
      expect(guard.size).toBe(0)
    })

    it('creates instance with custom config', () => {
      guard = new ChallengeReplayGuard({
        maxAge: 10_000,
        cleanupInterval: 5_000,
      })
      expect(guard).toBeDefined()
    })
  })

  describe('markUsed', () => {
    beforeEach(() => {
      guard = new ChallengeReplayGuard()
    })

    it('returns true for first use of a challenge ID', () => {
      expect(guard.markUsed('challenge-1')).toBe(true)
    })

    it('returns false for duplicate challenge ID (replay detected)', () => {
      guard.markUsed('challenge-1')
      expect(guard.markUsed('challenge-1')).toBe(false)
    })

    it('allows different challenge IDs', () => {
      expect(guard.markUsed('challenge-1')).toBe(true)
      expect(guard.markUsed('challenge-2')).toBe(true)
      expect(guard.markUsed('challenge-3')).toBe(true)
      expect(guard.size).toBe(3)
    })

    it('rejects the same ID even after other IDs are added', () => {
      guard.markUsed('challenge-1')
      guard.markUsed('challenge-2')
      expect(guard.markUsed('challenge-1')).toBe(false)
    })
  })

  describe('isUsed', () => {
    beforeEach(() => {
      guard = new ChallengeReplayGuard()
    })

    it('returns false for unseen challenge ID', () => {
      expect(guard.isUsed('unknown')).toBe(false)
    })

    it('returns true for previously marked challenge ID', () => {
      guard.markUsed('challenge-1')
      expect(guard.isUsed('challenge-1')).toBe(true)
    })

    it('does not mark the challenge as used (read-only check)', () => {
      guard.isUsed('challenge-1')
      // Should still be allowed since isUsed doesn't mark it
      expect(guard.markUsed('challenge-1')).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears all tracked challenge IDs', () => {
      guard = new ChallengeReplayGuard()
      guard.markUsed('challenge-1')
      guard.markUsed('challenge-2')
      expect(guard.size).toBe(2)

      guard.reset()
      expect(guard.size).toBe(0)
      // Previously used IDs should be allowed again
      expect(guard.markUsed('challenge-1')).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('removes expired entries after maxAge', () => {
      vi.useFakeTimers()
      guard = new ChallengeReplayGuard({
        maxAge: 1_000,
        cleanupInterval: 500,
      })

      guard.markUsed('challenge-1')
      expect(guard.size).toBe(1)

      // Advance past maxAge + cleanup interval
      vi.advanceTimersByTime(1_500)
      expect(guard.size).toBe(0)

      // The ID should be allowed again after expiry
      expect(guard.markUsed('challenge-1')).toBe(true)

      vi.useRealTimers()
    })

    it('keeps non-expired entries', () => {
      vi.useFakeTimers()
      guard = new ChallengeReplayGuard({
        maxAge: 5_000,
        cleanupInterval: 1_000,
      })

      guard.markUsed('challenge-1')
      vi.advanceTimersByTime(1_000) // Trigger cleanup, but entry is not expired
      expect(guard.size).toBe(1)
      expect(guard.markUsed('challenge-1')).toBe(false) // Still blocked

      vi.useRealTimers()
    })
  })

  describe('destroy', () => {
    it('clears all data and stops cleanup timer', () => {
      guard = new ChallengeReplayGuard()
      guard.markUsed('challenge-1')
      guard.destroy()
      expect(guard.size).toBe(0)
    })

    it('can be called multiple times without error', () => {
      guard = new ChallengeReplayGuard()
      guard.destroy()
      guard.destroy()
      expect(guard.size).toBe(0)
    })
  })
})
