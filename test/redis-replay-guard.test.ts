import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RedisReplayStore } from '../src/server/redis-replay-guard'
import type { RedisLike } from '../src/server/redis-replay-guard'

// ---------------------------------------------------------------------------
// Mock Redis client
// ---------------------------------------------------------------------------

function createMockRedis(): RedisLike & {
  _store: Map<string, { value: string; expiresAt: number }>
} {
  const store = new Map<string, { value: string; expiresAt: number }>()

  const now = () => Date.now()

  const isExpired = (key: string): boolean => {
    const entry = store.get(key)
    if (!entry) return true
    return entry.expiresAt > 0 && now() > entry.expiresAt
  }

  const live = (key: string) => (!isExpired(key) ? store.get(key) : undefined)

  return {
    _store: store,

    async set(key, value, _expiryMode, time, setMode) {
      // Clean up expired entry before NX check
      if (isExpired(key)) store.delete(key)

      if (setMode === 'NX' && store.has(key)) {
        return null
      }
      store.set(key, { value, expiresAt: now() + time * 1000 })
      return 'OK'
    },

    async exists(key) {
      return live(key) !== undefined ? 1 : 0
    },

    async del(key) {
      return store.delete(key) ? 1 : 0
    },

    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, '')
      return Array.from(store.keys()).filter(
        (k) => k.startsWith(prefix) && !isExpired(k),
      )
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RedisReplayStore', () => {
  let redis: ReturnType<typeof createMockRedis>
  let store: RedisReplayStore

  beforeEach(() => {
    redis = createMockRedis()
    store = new RedisReplayStore(redis, { ttlMs: 300_000 })
  })

  describe('markUsedAsync', () => {
    it('returns true on first use of a challenge ID', async () => {
      const result = await store.markUsedAsync('challenge-abc')
      expect(result).toBe(true)
    })

    it('returns false on second use of the same challenge ID (replay)', async () => {
      await store.markUsedAsync('challenge-abc')
      const result = await store.markUsedAsync('challenge-abc')
      expect(result).toBe(false)
    })

    it('allows different challenge IDs independently', async () => {
      expect(await store.markUsedAsync('challenge-1')).toBe(true)
      expect(await store.markUsedAsync('challenge-2')).toBe(true)
      expect(await store.markUsedAsync('challenge-3')).toBe(true)
    })

    it('rejects the same ID even after other IDs are added', async () => {
      await store.markUsedAsync('challenge-1')
      await store.markUsedAsync('challenge-2')
      expect(await store.markUsedAsync('challenge-1')).toBe(false)
    })

    it('allows re-use of a challenge ID after TTL expiry', async () => {
      const start = Date.now()
      vi.setSystemTime(start)

      const shortStore = new RedisReplayStore(redis, { ttlMs: 1_000 })
      await shortStore.markUsedAsync('challenge-ttl')

      // Advance past the TTL
      vi.setSystemTime(start + 2_000)

      // Should be allowed again since TTL expired
      expect(await shortStore.markUsedAsync('challenge-ttl')).toBe(true)

      vi.useRealTimers()
    })
  })

  describe('isUsedAsync', () => {
    it('returns false for an unseen challenge ID', async () => {
      expect(await store.isUsedAsync('unknown-challenge')).toBe(false)
    })

    it('returns true after a challenge ID is marked used', async () => {
      await store.markUsedAsync('challenge-xyz')
      expect(await store.isUsedAsync('challenge-xyz')).toBe(true)
    })

    it('does not mark the ID as used (read-only)', async () => {
      await store.isUsedAsync('challenge-readonly')
      // After isUsedAsync, should still be markable
      expect(await store.markUsedAsync('challenge-readonly')).toBe(true)
    })

    it('returns false after TTL expiry', async () => {
      // Use vi.setSystemTime to control Date.now() in both the mock and the store
      const start = Date.now()
      vi.setSystemTime(start)

      const shortStore = new RedisReplayStore(redis, { ttlMs: 500 })
      await shortStore.markUsedAsync('challenge-expiry')
      expect(await shortStore.isUsedAsync('challenge-expiry')).toBe(true)

      // Advance system time well past the TTL (ttlMs=500 -> 1s Redis TTL)
      vi.setSystemTime(start + 2_000)

      expect(await shortStore.isUsedAsync('challenge-expiry')).toBe(false)

      vi.useRealTimers()
    })
  })

  describe('deleteAsync', () => {
    it('removes a specific challenge ID', async () => {
      await store.markUsedAsync('challenge-delete')
      expect(await store.isUsedAsync('challenge-delete')).toBe(true)

      await store.deleteAsync('challenge-delete')
      expect(await store.isUsedAsync('challenge-delete')).toBe(false)
    })

    it('allows re-use after deletion', async () => {
      await store.markUsedAsync('challenge-del')
      await store.deleteAsync('challenge-del')
      expect(await store.markUsedAsync('challenge-del')).toBe(true)
    })

    it('is a no-op for non-existent IDs', async () => {
      // Should not throw
      await expect(store.deleteAsync('nonexistent')).resolves.toBeUndefined()
    })
  })

  describe('resetAsync', () => {
    it('removes all tracked challenge IDs', async () => {
      await store.markUsedAsync('c1')
      await store.markUsedAsync('c2')
      await store.markUsedAsync('c3')

      await store.resetAsync()

      expect(await store.isUsedAsync('c1')).toBe(false)
      expect(await store.isUsedAsync('c2')).toBe(false)
      expect(await store.isUsedAsync('c3')).toBe(false)
    })

    it('allows re-use of all IDs after reset', async () => {
      await store.markUsedAsync('challenge-reset')
      await store.resetAsync()
      expect(await store.markUsedAsync('challenge-reset')).toBe(true)
    })

    it('does not affect entries from a different prefix', async () => {
      const otherStore = new RedisReplayStore(redis, { keyPrefix: 'other:' })
      await otherStore.markUsedAsync('shared-id')

      await store.resetAsync() // Only resets 'imrobot:replay:' prefix

      expect(await otherStore.isUsedAsync('shared-id')).toBe(true)
    })
  })

  describe('key prefix', () => {
    it('uses default prefix imrobot:replay:', async () => {
      await store.markUsedAsync('my-challenge')
      expect(redis._store.has('imrobot:replay:my-challenge')).toBe(true)
    })

    it('uses custom prefix when configured', async () => {
      const customStore = new RedisReplayStore(redis, { keyPrefix: 'myapp:guard:' })
      await customStore.markUsedAsync('my-challenge')
      expect(redis._store.has('myapp:guard:my-challenge')).toBe(true)
    })
  })

  describe('destroy', () => {
    it('is a no-op (Redis lifecycle managed externally)', () => {
      expect(() => store.destroy()).not.toThrow()
    })

    it('can be called multiple times without error', () => {
      store.destroy()
      store.destroy()
    })
  })

  describe('concurrency safety (atomic NX)', () => {
    it('only one caller wins when two mark the same ID simultaneously', async () => {
      // Simulate two concurrent calls hitting the same key
      const [r1, r2] = await Promise.all([
        store.markUsedAsync('concurrent-challenge'),
        store.markUsedAsync('concurrent-challenge'),
      ])
      // Exactly one should win (true), one should detect replay (false)
      expect([r1, r2].filter(Boolean).length).toBe(1)
      expect([r1, r2].filter((v) => !v).length).toBe(1)
    })
  })

  describe('TTL configuration', () => {
    it('defaults to 5 minute TTL (300 seconds)', async () => {
      await store.markUsedAsync('ttl-test')
      const entry = redis._store.get('imrobot:replay:ttl-test')
      // TTL should be ~300 seconds from now (within 1 second tolerance)
      const ttlMs = entry!.expiresAt - Date.now()
      expect(ttlMs).toBeGreaterThan(299_000)
      expect(ttlMs).toBeLessThanOrEqual(300_000)
    })

    it('respects custom TTL configuration', async () => {
      const customStore = new RedisReplayStore(redis, { ttlMs: 60_000 })
      await customStore.markUsedAsync('custom-ttl')
      const entry = redis._store.get('imrobot:replay:custom-ttl')
      const ttlMs = entry!.expiresAt - Date.now()
      expect(ttlMs).toBeGreaterThan(59_000)
      expect(ttlMs).toBeLessThanOrEqual(60_000)
    })
  })
})
