/**
 * In-memory sliding window rate limiter for request throttling.
 *
 * Provides request rate limiting without external dependencies.
 * Uses a sliding window algorithm to track requests per client.
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({
 *   windowMs: 60000,     // 1 minute window
 *   maxRequests: 30,     // max 30 requests per window
 *   keyExtractor: (req) => req.ip ?? 'unknown'
 * })
 *
 * if (!limiter.isAllowed('192.168.1.1')) {
 *   res.status(429).json({ error: 'Too many requests' })
 *   return
 * }
 * ```
 */

/**
 * Configuration for the RateLimiter.
 */
export interface RateLimiterConfig {
  /** Time window in milliseconds (default: 60000) */
  windowMs?: number
  /** Maximum requests allowed per window (default: 30) */
  maxRequests?: number
  /** Optional callback when rate limit is exceeded */
  onLimitReached?: (key: string) => void
}

/**
 * Status information for a rate-limited key.
 */
export interface RateLimiterStatus {
  /** Number of requests remaining in current window */
  remaining: number
  /** Timestamp when the current window resets (ms since epoch) */
  resetAt: number
}

/**
 * Internal record tracking requests for a client.
 */
interface RateLimitRecord {
  count: number
  resetAt: number
}

/**
 * In-memory sliding window rate limiter.
 *
 * Tracks requests per key using a sliding window algorithm.
 * Automatically cleans up expired entries to prevent memory leaks.
 */
export class RateLimiter {
  private readonly windowMs: number
  private readonly maxRequests: number
  private readonly onLimitReached?: (key: string) => void
  private readonly store = new Map<string, RateLimitRecord>()
  private cleanupInterval?: NodeJS.Timeout

  constructor(config?: RateLimiterConfig) {
    this.windowMs = config?.windowMs ?? 60_000
    this.maxRequests = config?.maxRequests ?? 30
    this.onLimitReached = config?.onLimitReached

    // Start periodic cleanup of expired entries
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup()
      },
      Math.max(this.windowMs, 60_000),
    )

    // Don't keep the process alive just for cleanup
    this.cleanupInterval.unref?.()
  }

  /**
   * Check if a request is allowed for the given key.
   * Returns true if the request is within the rate limit, false otherwise.
   *
   * @param key - Client identifier (e.g., IP address)
   * @returns true if request is allowed, false if rate limit exceeded
   */
  isAllowed(key: string): boolean {
    const now = Date.now()
    const record = this.store.get(key)

    // No record yet, or window has expired
    if (!record || record.resetAt < now) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs })
      return true
    }

    // Within existing window
    if (record.count < this.maxRequests) {
      record.count++
      return true
    }

    // Rate limit exceeded
    this.onLimitReached?.(key)
    return false
  }

  /**
   * Get the current rate limit status for a key.
   *
   * @param key - Client identifier
   * @returns Status object with remaining requests and reset time
   */
  getStatus(key: string): RateLimiterStatus {
    const now = Date.now()
    const record = this.store.get(key)

    // No record or expired window
    if (!record || record.resetAt < now) {
      return {
        remaining: this.maxRequests,
        resetAt: now + this.windowMs,
      }
    }

    return {
      remaining: Math.max(0, this.maxRequests - record.count),
      resetAt: record.resetAt,
    }
  }

  /**
   * Reset the rate limit for a specific key, or all keys if not specified.
   *
   * @param key - Optional client identifier to reset. If omitted, resets all keys.
   */
  reset(key?: string): void {
    if (key) {
      this.store.delete(key)
    } else {
      this.store.clear()
    }
  }

  /**
   * Clean up expired entries from the store.
   * Called automatically at regular intervals.
   *
   * @private
   */
  private cleanup(): void {
    const now = Date.now()


    for (const [key, record] of this.store.entries()) {
      if (record.resetAt < now) {
        this.store.delete(key)
      }
    }
  }

  /**
   * Destroy the rate limiter and clear all data.
   * Call this before app shutdown to ensure cleanup interval is cleared.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
    this.store.clear()
  }
}
