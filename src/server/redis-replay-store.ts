/**
 * Redis-backed ReplayGuardStore adapter for ChallengeReplayGuard.
 *
 * Implements the ReplayGuardStore interface using ioredis, enabling
 * challenge replay protection that survives server restarts and works
 * correctly in multi-instance deployments.
 *
 * ioredis is a peer dependency — install it separately:
 *   npm install ioredis
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis'
 * import { ChallengeReplayGuard } from 'imrobot/server'
 * import { RedisReplayStore } from 'imrobot/server'
 *
 * const redis = new Redis({ host: 'localhost', port: 6379 })
 * const store = new RedisReplayStore(redis, { keyPrefix: 'imrobot:replay:' })
 * const guard = new ChallengeReplayGuard({ store })
 *
 * // Use guard exactly as the in-memory version
 * if (!guard.markUsed(challenge.id)) {
 *   res.status(403).json({ error: 'Replay attack detected' })
 *   return
 * }
 * ```
 *
 * @module
 */

/**
 * Minimal interface for the ioredis client methods used by RedisReplayStore.
 * Using a structural type rather than importing ioredis directly keeps ioredis
 * as a peer dependency — no bundled dependency, no version lock-in.
 */
export interface RedisClient {
  /** SET key value EX seconds NX */
  set(key: string, value: string, expiryMode: 'EX', time: number, setMode: 'NX'): Promise<'OK' | null>
  /** EXISTS key */
  exists(key: string): Promise<number>
  /** DEL key [key ...] */
  del(...keys: string[]): Promise<number>
  /** KEYS pattern */
  keys(pattern: string): Promise<string[]>
}

/** Configuration options for RedisReplayStore */
export interface RedisReplayStoreConfig {
  /**
   * Key prefix applied to all Redis keys.
   * Default: `'imrobot:replay:'`
   */
  keyPrefix?: string
  /**
   * Default TTL for challenge entries in milliseconds.
   * Matches ChallengeReplayGuard's maxAge (default 300_000 = 5 minutes).
   * Default: 300_000
   */
  defaultTtlMs?: number
}

/**
 * Redis-backed implementation of ReplayGuardStore.
 *
 * Challenge IDs are stored as Redis keys with TTL expiry, providing:
 * - Persistence across server restarts
 * - Correct behavior in multi-instance / load-balanced deployments
 * - Automatic expiry without manual cleanup timers
 *
 * The `markUsed` method uses SET NX (only-if-not-exists) to atomically
 * check and set — safe for concurrent requests across multiple instances.
 */
export class RedisReplayStore {
  private readonly redis: RedisClient
  private readonly keyPrefix: string
  private readonly defaultTtlMs: number
  private _size: number = 0

  constructor(redis: RedisClient, config?: RedisReplayStoreConfig) {
    this.redis = redis
    this.keyPrefix = config?.keyPrefix ?? 'imrobot:replay:'
    this.defaultTtlMs = config?.defaultTtlMs ?? 300_000
  }

  private toKey(id: string): string {
    return `${this.keyPrefix}${id}`
  }

  private msToSeconds(ms: number): number {
    return Math.max(1, Math.ceil(ms / 1000))
  }

  /**
   * Mark a challenge ID as used and check if it was already used.
   *
   * Uses Redis SET NX for atomic check-and-set — safe across multiple
   * server instances.
   *
   * @param challengeId - The challenge ID to mark as used
   * @returns Promise<true> if this is the first use, Promise<false> if replay detected
   */
  async markUsed(challengeId: string, ttlMs?: number): Promise<boolean> {
    const ttl = ttlMs ?? this.defaultTtlMs
    const result = await this.redis.set(
      this.toKey(challengeId),
      '1',
      'EX',
      this.msToSeconds(ttl),
      'NX'
    )
    if (result === 'OK') {
      this._size++
      return true // First use — allowed
    }
    return false // Replay detected — key already exists
  }

  /**
   * Check if a challenge ID has been used without marking it.
   *
   * @param challengeId - The challenge ID to check
   * @returns Promise<true> if the challenge has been used, Promise<false> otherwise
   */
  async isUsed(challengeId: string): Promise<boolean> {
    const count = await this.redis.exists(this.toKey(challengeId))
    return count > 0
  }

  /**
   * Number of currently tracked challenge IDs.
   * Note: This is an approximate count (incremented on markUsed, reset on reset()).
   * For an exact count, use Redis KEYS or SCAN with the prefix pattern.
   */
  get size(): number {
    return this._size
  }

  /**
   * Clear all tracked challenge IDs matching this store's key prefix.
   *
   * Warning: This uses KEYS which is O(N) — use with caution on large datasets.
   * In production, prefer letting keys expire naturally via TTL.
   */
  async reset(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`)
    if (keys.length > 0) {
      await this.redis.del(...keys)
    }
    this._size = 0
  }

  /**
   * No-op for Redis store — no timers to clean up.
   * Expiry is handled automatically by Redis TTL.
   */
  destroy(): void {
    // Redis handles expiry automatically — nothing to clean up
  }
}
