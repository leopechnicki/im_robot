/**
 * Challenge replay protection.
 *
 * Tracks used challenge IDs and rejects duplicates.
 * Uses automatic expiry to prevent unbounded memory growth.
 *
 * @example
 * ```typescript
 * import { ChallengeReplayGuard } from 'imrobot/server'
 *
 * const guard = new ChallengeReplayGuard({
 *   maxAge: 5 * 60 * 1000,  // 5 minutes
 * })
 *
 * // Returns true if challenge hasn't been used (marks it as used)
 * if (!guard.markUsed(challenge.id)) {
 *   // Challenge was already verified — reject
 *   res.status(403).json({ error: 'Replay attack detected' })
 *   return
 * }
 * ```
 */

/**
 * Configuration for the ChallengeReplayGuard.
 */
export interface ReplayGuardConfig {
  /** Maximum age of tracked challenge IDs in ms. Default: 300_000 (5 min) */
  maxAge?: number
  /** Cleanup interval in ms. Default: 60_000 (1 min) */
  cleanupInterval?: number
}

/**
 * In-memory challenge replay guard.
 *
 * Tracks used challenge IDs with automatic expiry cleanup.
 * Prevents the same challenge from being verified more than once.
 */
export class ChallengeReplayGuard {
  private used: Map<string, number> // challengeId -> timestamp
  private maxAge: number
  private cleanupTimer: ReturnType<typeof setInterval> | null

  constructor(config?: ReplayGuardConfig) {
    this.used = new Map()
    this.maxAge = config?.maxAge ?? 300_000 // 5 minutes default
    const cleanupInterval = config?.cleanupInterval ?? 60_000 // 1 minute default

    // Start periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, cleanupInterval)

    // Don't keep the process alive just for cleanup
    this.cleanupTimer.unref?.()
  }

  /**
   * Mark a challenge ID as used and check if it was already used.
   *
   * Returns true if the challenge ID has NOT been used before (first time).
   * Returns false if replay detected (challenge already used).
   *
   * @param challengeId - The challenge ID to mark as used
   * @returns true if this is the first use, false if replay detected
   */
  markUsed(challengeId: string): boolean {
    const now = Date.now()

    // Check if already used
    if (this.used.has(challengeId)) {
      return false // Replay detected
    }

    // Mark as used
    this.used.set(challengeId, now)
    return true // First use allowed
  }

  /**
   * Check if a challenge ID has been used without marking it.
   *
   * @param challengeId - The challenge ID to check
   * @returns true if the challenge has been used, false otherwise
   */
  isUsed(challengeId: string): boolean {
    return this.used.has(challengeId)
  }

  /**
   * Get the number of tracked challenge IDs.
   *
   * @returns Current size of the used set
   */
  get size(): number {
    return this.used.size
  }

  /**
   * Clear all tracked challenge IDs.
   */
  reset(): void {
    this.used.clear()
  }

  /**
   * Clean up expired entries from the store.
   * Called automatically at regular intervals.
   *
   * @private
   */
  private cleanup(): void {
    const now = Date.now()

    for (const [challengeId, timestamp] of this.used.entries()) {
      if (now - timestamp > this.maxAge) {
        this.used.delete(challengeId)
      }
    }
  }

  /**
   * Destroy the replay guard and clear all data.
   * Call this before app shutdown to ensure cleanup interval is cleared.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.used.clear()
  }
}
