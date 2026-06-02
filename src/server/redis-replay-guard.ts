/**
 * Redis-backed challenge replay guard adapter.
 *
 * Implements a distributed, persistent replay guard for multi-instance
 * deployments. Uses Redis SET with NX (set-if-not-exists) and TTL to
 * atomically detect and prevent challenge replay without race conditions.
 *
 * Unlike the in-memory ChallengeReplayGuard, this adapter:
 * - Survives server restarts (challenges stay marked across deploys)
 * - Works across multiple server instances (no shared memory required)
 * - Auto-expires entries via Redis TTL (no cleanup interval needed)
 *
 * @example
 * ```typescript
 * import Redis from 'ioredis'
 * import { RedisReplayStore } from 'imrobot/server'
 *
 * const redis = new Redis({ host: 'localhost', port: 6379 })
 * const guard = new RedisReplayStore(redis, { ttlMs: 5 * 60 * 1000 })
 *
 * // Returns true if challenge hasn't been used (marks it as used atomically)
 * const allowed = await guard.markUsedAsync('challenge-id-123')
 * if (!allowed) {
 *   res.status(403).json({ error: 'Replay attack detected' })
 *   return
 * }
 * ```
 *
 * @remarks
 * `ioredis` is an optional peer dependency. Install it separately:
 * ```
 * npm install ioredis
 * ```
 *
 * @module
 */

/** Minimal Redis interface required by RedisReplayStore (compatible with ioredis) */
export interface RedisLike {
  /** SET key value EX seconds NX — returns 'OK' on success, null if key exists */
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    time: number,
    setMode: 'NX',
  ): Promise<'OK' | null>
  /** EXISTS key — returns number of existing keys (0 or 1) */
  exists(key: string): Promise<number>
  /** DEL key — returns number of deleted keys */
  del(key: string): Promise<number>
  /** KEYS pattern — returns matching keys (use with caution in production) */
  keys(pattern: string): Promise<string[]>
}

/** Configuration for RedisReplayStore */
export interface RedisReplayStoreConfig {
  /**
   * How long a used challenge ID stays in Redis (in milliseconds).
   * Entries older than this are automatically expired by Redis.
   * Default: 300_000 (5 minutes)
   */
  ttlMs?: number
  /**
   * Redis key prefix to namespace challenge IDs.
   * Default: 'imrobot:replay:'
   */
  keyPrefix?: string
}

/**
 * Redis-backed async replay guard store.
 *
 * All operations are async because Redis I/O is inherently async.
 * Use markUsedAsync / isUsedAsync / resetAsync instead of the
 * synchronous ReplayGuardStore interface methods.
 *
 * The synchronous ReplayGuardStore interface methods (markUsed, isUsed,
 * reset, destroy) throw a descriptive error to prevent accidental misuse —
 * the in-memory ChallengeReplayGuard should be used for synchronous contexts.
 */
export class RedisReplayStore {
  private readonly redis: RedisLike
  private readonly ttlSeconds: number
  private readonly keyPrefix: string

  constructor(redis: RedisLike, config?: RedisReplayStoreConfig) {
    this.redis = redis
    this.ttlSeconds = Math.ceil((config?.ttlMs ?? 300_000) / 1000)
    this.keyPrefix = config?.keyPrefix ?? 'imrobot:replay:'
  }

  private key(challengeId: string): string {
    return `${this.keyPrefix}${challengeId}`
  }

  /**
   * Atomically mark a challenge ID as used.
   *
   * Uses Redis SET NX (set-if-not-exists) with TTL for atomic check-and-set.
   * Returns true if the challenge ID was NOT previously used (first use).
   * Returns false if replay detected (challenge already used).
   *
   * This operation is race-condition-safe across multiple server instances.
   *
   * @param challengeId - The challenge ID to mark as used
   * @returns Promise resolving to true on first use, false on replay
   */
  async markUsedAsync(challengeId: string): Promise<boolean> {
    const result = await this.redis.set(this.key(challengeId), '1', 'EX', this.ttlSeconds, 'NX')
    // 'OK' = key was set (first use), null = key already existed (replay)
    return result === 'OK'
  }

  /**
   * Check if a challenge ID has been used without marking it.
   *
   * @param challengeId - The challenge ID to check
   * @returns Promise resolving to true if the challenge has been used
   */
  async isUsedAsync(challengeId: string): Promise<boolean> {
    const count = await this.redis.exists(this.key(challengeId))
    return count > 0
  }

  /**
   * Delete a specific challenge ID from the store.
   *
   * Useful for testing or manual invalidation. In normal operation,
   * entries expire automatically via Redis TTL.
   *
   * @param challengeId - The challenge ID to remove
   */
  async deleteAsync(challengeId: string): Promise<void> {
    await this.redis.del(this.key(challengeId))
  }

  /**
   * Remove all replay guard entries for this key prefix from Redis.
   *
   * WARNING: Uses KEYS command — do not use in production under high load.
   * Prefer per-key deleteAsync for individual invalidations.
   *
   * @returns Promise resolving when all matching keys are deleted
   */
  async resetAsync(): Promise<void> {
    const keys = await this.redis.keys(`${this.keyPrefix}*`)
    if (keys.length > 0) {
      await Promise.all(keys.map((k) => this.redis.del(k)))
    }
  }

  /**
   * No-op: Redis connections are managed externally and closed by the caller.
   *
   * Call `redis.quit()` or `redis.disconnect()` on your ioredis instance
   * when shutting down the server.
   */
  destroy(): void {
    // Redis lifecycle is owned by the caller; nothing to clean up here.
  }
}
