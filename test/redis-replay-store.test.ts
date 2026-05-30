import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RedisReplayStore } from '../src/server/redis-replay-store'
import type { RedisClient } from '../src/server/redis-replay-store'

/**
 * Mock Redis client for testing RedisReplayStore without a real Redis instance.
 */
function createMockRedis(): RedisClient & {
  _store: Map<string, string>
} {
  const store = new Map<string, string>()

  return {
    _store: store,

    async set(key: string, value: string, _expiryMode: 'EX', _time: number, setMode: 'NX'): Promise<'OK' | null> {
      if (setMode === 'NX') {
        if (store.has(key)) return null // Key exists — NX fails
        store.set(key, value)
        return 'OK'
      }
      store.set(key, value)
      return 'OK'
    },

    async exists(key: string): Promise<number> {
      return store.has(key) ? 1 : 0
    },

    async del(...keys: string[]): Promise<number> {
      let deleted = 0
      for (const key of keys) {
        if (store.delete(key)) deleted++
      }
      return deleted
    },

    async keys(pattern: string): Promise<string[]> {
      const prefix = pattern.replace('*', '')
      return [...store.keys()].filter(k => k.startsWith(prefix))
    },
  }
}

describe('RedisReplayStore', () => {
  let redis: ReturnType<typeof createMockRedis>
  let store: RedisReplayStore

  beforeEach(() => {
    redis = createMockRedis()
    store = new RedisReplayStore(redis, { keyPrefix: 'test:replay:', defaultTtlMs: 300_000 })
  })

  describe('markUsed', () => {
    it('returns true on first use of a challenge ID', async () => {
      const result = await store.markUsed('challenge-1')
      expect(result).toBe(true)
    })

    it('returns false on subsequent use of the same challenge ID (replay)', async () => {
      await store.markUsed('challenge-1')
      const result = await store.markUsed('challenge-1')
      expect(result).toBe(false)
    })

    it('allows different challenge IDs independently', async () => {
      const r1 = await store.markUsed('challenge-1')
      const r2 = await store.markUsed('challenge-2')
      expect(r1).toBe(true)
      expect(r2).toBe(true)
    })

    it('stores key with correct prefix', async () => {
      await store.markUsed('abc123')
      expect(redis._store.has('test:replay:abc123')).toBe(true)
    })

    it('increments size on successful mark', async () => {
      expect(store.size).toBe(0)
      await store.markUsed('ch-1')
      expect(store.size).toBe(1)
      await store.markUsed('ch-2')
      expect(store.size).toBe(2)
    })

    it('does not increment size on replay (already used)', async () => {
      await store.markUsed('ch-1')
      await store.markUsed('ch-1') // replay
      expect(store.size).toBe(1)
    })
  })

  describe('isUsed', () => {
    it('returns false for unused challenge ID', async () => {
      const result = await store.isUsed('unused-challenge')
      expect(result).toBe(false)
    })

    it('returns true for previously used challenge ID', async () => {
      await store.markUsed('used-challenge')
      const result = await store.isUsed('used-challenge')
      expect(result).toBe(true)
    })

    it('does not mark the challenge as used', async () => {
      await store.isUsed('check-only')
      // Should still be usable after isUsed check
      const markResult = await store.markUsed('check-only')
      expect(markResult).toBe(true)
    })
  })

  describe('reset', () => {
    it('clears all tracked challenge IDs', async () => {
      await store.markUsed('ch-1')
      await store.markUsed('ch-2')
      await store.reset()

      expect(store.size).toBe(0)
      expect(await store.isUsed('ch-1')).toBe(false)
      expect(await store.isUsed('ch-2')).toBe(false)
    })

    it('only clears keys with matching prefix', async () => {
      // Add a key with different prefix directly
      redis._store.set('other:key', '1')
      await store.markUsed('ch-1')
      await store.reset()

      // Other prefix key should remain
      expect(redis._store.has('other:key')).toBe(true)
    })
  })

  describe('destroy', () => {
    it('is a no-op (Redis handles expiry via TTL)', () => {
      // Should not throw
      expect(() => store.destroy()).not.toThrow()
    })
  })

  describe('key prefix', () => {
    it('uses default prefix when none specified', async () => {
      const defaultStore = new RedisReplayStore(redis)
      await defaultStore.markUsed('test-id')
      expect(redis._store.has('imrobot:replay:test-id')).toBe(true)
    })

    it('uses custom prefix when specified', async () => {
      const customStore = new RedisReplayStore(redis, { keyPrefix: 'myapp:guard:' })
      await customStore.markUsed('test-id')
      expect(redis._store.has('myapp:guard:test-id')).toBe(true)
    })
  })

  describe('TTL calculation', () => {
    it('converts ms to seconds (rounding up)', async () => {
      const setMock = vi.fn().mockResolvedValue('OK')
      const mockRedis: RedisClient = {
        set: setMock,
        exists: vi.fn().mockResolvedValue(0),
        del: vi.fn().mockResolvedValue(0),
        keys: vi.fn().mockResolvedValue([]),
      }
      const ttlStore = new RedisReplayStore(mockRedis, { defaultTtlMs: 5 * 60 * 1000 })
      await ttlStore.markUsed('ch')
      expect(setMock).toHaveBeenCalledWith(
        expect.any(String),
        '1',
        'EX',
        300, // 300_000ms -> 300s
        'NX'
      )
    })

    it('uses per-call TTL override when provided', async () => {
      const setMock = vi.fn().mockResolvedValue('OK')
      const mockRedis: RedisClient = {
        set: setMock,
        exists: vi.fn().mockResolvedValue(0),
        del: vi.fn().mockResolvedValue(0),
        keys: vi.fn().mockResolvedValue([]),
      }
      const ttlStore = new RedisReplayStore(mockRedis)
      await ttlStore.markUsed('ch', 60_000) // 60s override
      expect(setMock).toHaveBeenCalledWith(
        expect.any(String),
        '1',
        'EX',
        60,
        'NX'
      )
    })
  })
})
