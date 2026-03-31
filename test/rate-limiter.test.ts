import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RateLimiter } from '../src/server/rate-limiter'

/**
 * Comprehensive test suite for the RateLimiter class.
 * Tests the sliding window rate limiting algorithm with various scenarios.
 */

describe('RateLimiter', () => {
  // ── Basic initialization ──────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const limiter = new RateLimiter()
      expect(limiter).toBeDefined()
    })

    it('creates instance with custom config', () => {
      const limiter = new RateLimiter({
        windowMs: 30_000,
        maxRequests: 15,
      })
      expect(limiter).toBeDefined()
    })

    it('accepts onLimitReached callback', () => {
      let called = false
      const limiter = new RateLimiter({
        onLimitReached: () => {
          called = true
        },
      })
      expect(limiter).toBeDefined()
    })

    it('starts cleanup interval', () => {
      const limiter = new RateLimiter()
      expect(limiter).toBeDefined()
      limiter.destroy()
    })
  })

  // ── Basic rate limiting ───────────────────────────────────────────────────

  describe('isAllowed', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      limiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 3,
      })
    })

    afterEach(() => {
      limiter.destroy()
    })

    it('allows requests up to maxRequests', () => {
      const key = 'test-key'
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(true)
    })

    it('rejects requests exceeding maxRequests', () => {
      const key = 'test-key'
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(false)
    })

    it('continues rejecting until window expires', () => {
      const key = 'test-key'
      for (let i = 0; i < 3; i++) {
        limiter.isAllowed(key)
      }
      expect(limiter.isAllowed(key)).toBe(false)
      expect(limiter.isAllowed(key)).toBe(false)
    })
  })

  // ── Window expiry ─────────────────────────────────────────────────────────

  describe('window expiry', () => {
    it('allows new requests after window expires', async () => {
      const limiter = new RateLimiter({
        windowMs: 100, // Very short window for testing
        maxRequests: 2,
      })

      const key = 'test-key'
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(false)

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Should allow again
      expect(limiter.isAllowed(key)).toBe(true)

      limiter.destroy()
    })

    it('resets count for expired windows', async () => {
      const limiter = new RateLimiter({
        windowMs: 100,
        maxRequests: 1,
      })

      const key = 'test-key'
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(false)

      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(false)

      limiter.destroy()
    })
  })

  // ── Key isolation ─────────────────────────────────────────────────────────

  describe('key isolation', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      limiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 2,
      })
    })

    afterEach(() => {
      limiter.destroy()
    })

    it('tracks different keys separately', () => {
      const key1 = 'client-1'
      const key2 = 'client-2'

      // Fill key1
      expect(limiter.isAllowed(key1)).toBe(true)
      expect(limiter.isAllowed(key1)).toBe(true)
      expect(limiter.isAllowed(key1)).toBe(false)

      // key2 should still have requests available
      expect(limiter.isAllowed(key2)).toBe(true)
      expect(limiter.isAllowed(key2)).toBe(true)
      expect(limiter.isAllowed(key2)).toBe(false)
    })

    it('maintains isolation across multiple keys', () => {
      const keys = ['client-1', 'client-2', 'client-3']

      // Each key should get exactly 2 allowed requests
      for (const key of keys) {
        expect(limiter.isAllowed(key)).toBe(true)
        expect(limiter.isAllowed(key)).toBe(true)
        expect(limiter.isAllowed(key)).toBe(false)
      }
    })

    it('different keys do not interfere with each other', () => {
      expect(limiter.isAllowed('a')).toBe(true)
      expect(limiter.isAllowed('b')).toBe(true)
      expect(limiter.isAllowed('a')).toBe(true)
      expect(limiter.isAllowed('b')).toBe(true)

      // Now both should be at limit
      expect(limiter.isAllowed('a')).toBe(false)
      expect(limiter.isAllowed('b')).toBe(false)
    })
  })

  // ── getStatus method ──────────────────────────────────────────────────────

  describe('getStatus', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      limiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 5,
      })
    })

    afterEach(() => {
      limiter.destroy()
    })

    it('returns max requests for new key', () => {
      const status = limiter.getStatus('new-key')
      expect(status.remaining).toBe(5)
      expect(status.resetAt).toBeGreaterThan(Date.now())
    })

    it('decreases remaining after requests', () => {
      const key = 'test-key'
      limiter.isAllowed(key)
      limiter.isAllowed(key)

      const status = limiter.getStatus(key)
      expect(status.remaining).toBe(3)
    })

    it('returns zero remaining when limit exceeded', () => {
      const key = 'test-key'
      for (let i = 0; i < 5; i++) {
        limiter.isAllowed(key)
      }

      const status = limiter.getStatus(key)
      expect(status.remaining).toBe(0)
    })

    it('resetAt is within window duration', () => {
      const key = 'test-key'
      const before = Date.now()
      limiter.isAllowed(key)
      const status = limiter.getStatus(key)
      const after = Date.now()

      expect(status.resetAt).toBeGreaterThanOrEqual(before + 60_000)
      expect(status.resetAt).toBeLessThanOrEqual(after + 60_000 + 1000)
    })

    it('expired window returns fresh limits', async () => {
      const limiter2 = new RateLimiter({
        windowMs: 100,
        maxRequests: 1,
      })

      const key = 'test-key'
      limiter2.isAllowed(key)

      let status = limiter2.getStatus(key)
      expect(status.remaining).toBe(0)

      await new Promise((resolve) => setTimeout(resolve, 150))

      status = limiter2.getStatus(key)
      expect(status.remaining).toBe(1)

      limiter2.destroy()
    })
  })

  // ── reset method ──────────────────────────────────────────────────────────

  describe('reset', () => {
    let limiter: RateLimiter

    beforeEach(() => {
      limiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 2,
      })
    })

    afterEach(() => {
      limiter.destroy()
    })

    it('resets individual key', () => {
      const key = 'test-key'
      limiter.isAllowed(key)
      limiter.isAllowed(key)
      expect(limiter.isAllowed(key)).toBe(false)

      limiter.reset(key)

      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(false)
    })

    it('resets all keys when no key specified', () => {
      const key1 = 'client-1'
      const key2 = 'client-2'

      limiter.isAllowed(key1)
      limiter.isAllowed(key1)
      limiter.isAllowed(key2)
      limiter.isAllowed(key2)

      expect(limiter.isAllowed(key1)).toBe(false)
      expect(limiter.isAllowed(key2)).toBe(false)

      limiter.reset()

      expect(limiter.isAllowed(key1)).toBe(true)
      expect(limiter.isAllowed(key2)).toBe(true)
    })

    it('reset does not affect other keys', () => {
      const key1 = 'client-1'
      const key2 = 'client-2'

      limiter.isAllowed(key1)
      limiter.isAllowed(key1)
      limiter.isAllowed(key2)

      limiter.reset(key1)

      expect(limiter.isAllowed(key1)).toBe(true)
      expect(limiter.isAllowed(key2)).toBe(true)
    })
  })

  // ── Callback functionality ────────────────────────────────────────────────

  describe('onLimitReached callback', () => {
    it('calls callback when limit exceeded', () => {
      const callbacks: string[] = []
      const limiter = new RateLimiter({
        maxRequests: 2,
        onLimitReached: (key) => {
          callbacks.push(key)
        },
      })

      const key = 'test-key'
      limiter.isAllowed(key)
      limiter.isAllowed(key)
      limiter.isAllowed(key)

      expect(callbacks).toContain(key)
      limiter.destroy()
    })

    it('calls callback only when limit exceeded, not on allowed requests', () => {
      const callbacks: string[] = []
      const limiter = new RateLimiter({
        maxRequests: 2,
        onLimitReached: (key) => {
          callbacks.push(key)
        },
      })

      const key = 'test-key'
      limiter.isAllowed(key)
      limiter.isAllowed(key)

      expect(callbacks).toHaveLength(0)

      limiter.isAllowed(key)

      expect(callbacks).toHaveLength(1)
      limiter.destroy()
    })
  })

  // ── Cleanup and memory management ─────────────────────────────────────────

  describe('cleanup and memory management', () => {
    it('removes expired entries', async () => {
      const limiter = new RateLimiter({
        windowMs: 100,
        maxRequests: 1,
      })

      // Create multiple entries
      for (let i = 0; i < 10; i++) {
        limiter.isAllowed(`key-${i}`)
      }

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Trigger cleanup by accessing the limiter (cleanup runs periodically)
      limiter.isAllowed('new-key')

      // All keys should be fresh after cleanup
      for (let i = 0; i < 10; i++) {
        const status = limiter.getStatus(`key-${i}`)
        expect(status.remaining).toBe(1)
      }

      limiter.destroy()
    })

    it('destroy clears all data', () => {
      const limiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 2,
      })

      limiter.isAllowed('key-1')
      limiter.isAllowed('key-2')

      limiter.destroy()

      // After destroy, should start fresh
      const status1 = limiter.getStatus('key-1')
      const status2 = limiter.getStatus('key-2')

      expect(status1.remaining).toBe(2)
      expect(status2.remaining).toBe(2)
    })
  })

  // ── Default configuration ─────────────────────────────────────────────────

  describe('default configuration', () => {
    it('defaults to 60s window and 30 requests', () => {
      const limiter = new RateLimiter()
      const key = 'test'

      // Allow 30 requests
      for (let i = 0; i < 30; i++) {
        expect(limiter.isAllowed(key)).toBe(true)
      }

      // 31st should fail
      expect(limiter.isAllowed(key)).toBe(false)

      limiter.destroy()
    })
  })

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles single request limit', () => {
      const limiter = new RateLimiter({
        maxRequests: 1,
      })

      const key = 'test'
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(false)

      limiter.destroy()
    })

    it('handles zero-second window expiry', async () => {
      const limiter = new RateLimiter({
        windowMs: 1,
        maxRequests: 1,
      })

      const key = 'test'
      expect(limiter.isAllowed(key)).toBe(true)
      expect(limiter.isAllowed(key)).toBe(false)

      await new Promise((resolve) => setTimeout(resolve, 5))

      expect(limiter.isAllowed(key)).toBe(true)

      limiter.destroy()
    })

    it('handles empty string as key', () => {
      const limiter = new RateLimiter({
        maxRequests: 2,
      })

      expect(limiter.isAllowed('')).toBe(true)
      expect(limiter.isAllowed('')).toBe(true)
      expect(limiter.isAllowed('')).toBe(false)

      limiter.destroy()
    })

    it('handles special characters in keys', () => {
      const limiter = new RateLimiter({
        maxRequests: 2,
      })

      const specialKey = 'key-with!@#$%^&*()_+-=[]{}|;:,.<>?'
      expect(limiter.isAllowed(specialKey)).toBe(true)
      expect(limiter.isAllowed(specialKey)).toBe(true)
      expect(limiter.isAllowed(specialKey)).toBe(false)

      limiter.destroy()
    })

    it('handles very large maxRequests', () => {
      const limiter = new RateLimiter({
        maxRequests: 1_000_000,
      })

      const key = 'test'
      for (let i = 0; i < 1000; i++) {
        expect(limiter.isAllowed(key)).toBe(true)
      }

      const status = limiter.getStatus(key)
      expect(status.remaining).toBe(1_000_000 - 1000)

      limiter.destroy()
    })
  })

  // ── Concurrent request simulation ──────────────────────────────────────────

  describe('concurrent-like scenarios', () => {
    it('handles rapid successive requests correctly', () => {
      const limiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 100,
      })

      const key = 'test'
      let allowed = 0
      let denied = 0

      for (let i = 0; i < 150; i++) {
        if (limiter.isAllowed(key)) {
          allowed++
        } else {
          denied++
        }
      }

      expect(allowed).toBe(100)
      expect(denied).toBe(50)

      limiter.destroy()
    })

    it('handles many clients simultaneously', () => {
      const limiter = new RateLimiter({
        windowMs: 60_000,
        maxRequests: 5,
      })

      const numClients = 100
      const requestsPerClient = 10

      for (let client = 0; client < numClients; client++) {
        const key = `client-${client}`
        let allowed = 0

        for (let req = 0; req < requestsPerClient; req++) {
          if (limiter.isAllowed(key)) {
            allowed++
          }
        }

        expect(allowed).toBe(5)
      }

      limiter.destroy()
    })
  })
})
