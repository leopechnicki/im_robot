/**
 * In-memory **sliding-window** rate limiter for request throttling.
 *
 * Each key stores the timestamps of recent requests. On every check, requests
 * older than `now - windowMs` are evicted, then the remaining count is compared
 * against `maxRequests`. Unlike a fixed-window counter, this prevents the
 * end-of-window + start-of-window 2× burst that fixed-window limiters allow.
 *
 * Time:  O(k) per request, where k = recent requests for the key (≤ maxRequests).
 * Space: O(maxRequests) per active key.
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({
 *   windowMs: 60000,     // 1 minute window
 *   maxRequests: 30,     // max 30 requests per rolling window
 * })
 *
 * if (!limiter.isAllowed(req.ip)) {
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
  /** Number of requests remaining in the current rolling window */
  remaining: number
  /**
   * Wall-clock time (ms since epoch) at which the window's oldest request
   * ages out — i.e. when at least one slot becomes available again.
   * For a key with no recent requests this is `now + windowMs`.
   */
  resetAt: number
}

/**
 * In-memory sliding-window rate limiter.
 *
 * Tracks request timestamps per key in chronological order.
 * Automatically evicts timestamps outside the rolling window on every check,
 * and runs periodic cleanup to drop empty entries.
 */
export class RateLimiter {
  private readonly windowMs: number
  private readonly _maxRequests: number
  private readonly onLimitReached?: (key: string) => void
  /** key → array of request timestamps (ms), oldest first */
  private readonly store = new Map<string, number[]>()
  private cleanupInterval?: NodeJS.Timeout

  constructor(config?: RateLimiterConfig) {
    this.windowMs = config?.windowMs ?? 60_000
    this._maxRequests = config?.maxRequests ?? 30
    this.onLimitReached = config?.onLimitReached

    this.cleanupInterval = setInterval(
      () => {
        this.cleanup()
      },
      Math.max(this.windowMs, 60_000),
    )

    this.cleanupInterval.unref?.()
  }

  /**
   * Drop timestamps older than `now - windowMs` from the head of the array.
   * Mutates and returns the same array. The store always keeps the array
   * in chronological order (push appends to the tail), so we only need to
   * scan from the front.
   */
  private prune(timestamps: number[], now: number): number[] {
    // A request at time T0 stays in the window until `now - T0 >= windowMs`,
    // i.e. drop when T0 + windowMs <= now (equivalently T0 < cutoff).
    // Strict-less-than matches the previous fixed-window semantic at the
    // 1ms boundary.
    const cutoff = now - this.windowMs
    let drop = 0
    while (drop < timestamps.length && timestamps[drop] < cutoff) {
      drop++
    }
    if (drop > 0) timestamps.splice(0, drop)
    return timestamps
  }

  /** The configured maximum requests per window. */
  get maxRequests(): number {
    return this._maxRequests
  }

  /**
   * Check if a request is allowed for the given key.
   * Returns true if the request is within the rate limit, false otherwise.
   *
   * Side effect: when `true`, the current timestamp is recorded.
   *
   * @param key - Client identifier (e.g., IP address)
   * @returns true if request is allowed, false if rate limit exceeded
   */
  isAllowed(key: string): boolean {
    const now = Date.now()
    let timestamps = this.store.get(key)
    if (!timestamps) {
      timestamps = []
      this.store.set(key, timestamps)
    }

    this.prune(timestamps, now)

    if (timestamps.length < this._maxRequests) {
      timestamps.push(now)
      return true
    }

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
    const timestamps = this.store.get(key)
    if (!timestamps || timestamps.length === 0) {
      return { remaining: this._maxRequests, resetAt: now + this.windowMs }
    }

    this.prune(timestamps, now)

    const remaining = Math.max(0, this._maxRequests - timestamps.length)
    const oldest = timestamps[0]
    const resetAt = oldest !== undefined ? oldest + this.windowMs : now + this.windowMs
    return { remaining, resetAt }
  }

  /**
   * Reset the rate limit for a specific key, or all keys if not specified.
   */
  reset(key?: string): void {
    if (key) {
      this.store.delete(key)
    } else {
      this.store.clear()
    }
  }

  /**
   * Drop empty/expired entries from the store. Called automatically on a timer
   * and as a side-effect of any read.
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, timestamps] of this.store.entries()) {
      this.prune(timestamps, now)
      if (timestamps.length === 0) {
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
