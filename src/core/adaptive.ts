/**
 * Adaptive difficulty engine — auto-adjusts challenge difficulty
 * based on agent behavior patterns and solve history.
 *
 * Inspired by Arkose Labs (FunCaptcha) progressive difficulty and
 * reCAPTCHA v3's risk scoring, this module tracks agent performance
 * and adjusts challenges accordingly.
 *
 * @example
 * ```typescript
 * import { AdaptiveDifficulty } from 'imrobot/core'
 *
 * const adaptive = new AdaptiveDifficulty({
 *   initialDifficulty: 'medium',
 *   escalateAfterFailures: 2,
 *   relaxAfterSuccesses: 3,
 * })
 *
 * // Record outcomes
 * adaptive.recordAttempt('agent_123', { success: true, solveTimeMs: 42 })
 * adaptive.recordAttempt('agent_123', { success: true, solveTimeMs: 38 })
 *
 * // Get recommended difficulty for next challenge
 * const diff = adaptive.getDifficulty('agent_123') // may downgrade to 'easy'
 *
 * // Get risk score (0-1, higher = more suspicious)
 * const risk = adaptive.getRiskScore('agent_123') // 0.15
 * ```
 */

import type { Difficulty } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdaptiveConfig {
  /** Starting difficulty for new agents (default: 'medium') */
  initialDifficulty?: Difficulty
  /** Escalate difficulty after N consecutive failures (default: 2) */
  escalateAfterFailures?: number
  /** Relax difficulty after N consecutive successes (default: 5) */
  relaxAfterSuccesses?: number
  /** Maximum history entries to keep per agent (default: 50) */
  maxHistory?: number
  /** Time window for behavioral analysis in ms (default: 5 minutes) */
  analysisWindowMs?: number
  /** Solve time thresholds per difficulty in ms */
  solveTimeThresholds?: {
    /** Expected max solve time for bots (above this = suspicious) */
    suspiciousMs?: number
    /** Below this = unusually fast (may indicate replay) */
    tooFastMs?: number
  }
}

export interface AttemptRecord {
  /** Whether the challenge was solved correctly */
  success: boolean
  /** Time taken to solve in ms */
  solveTimeMs: number
  /** Difficulty of the challenge that was attempted */
  difficulty?: Difficulty
  /** Timestamp of the attempt */
  timestamp?: number
}

/** Per-agent behavioral profile */
export interface AgentProfile {
  /** Current recommended difficulty */
  currentDifficulty: Difficulty
  /** Consecutive successes */
  consecutiveSuccesses: number
  /** Consecutive failures */
  consecutiveFailures: number
  /** Total attempts */
  totalAttempts: number
  /** Total successes */
  totalSuccesses: number
  /** Average solve time in ms */
  avgSolveTimeMs: number
  /** Risk score (0-1, higher = more suspicious) */
  riskScore: number
  /** When the agent was first seen */
  firstSeen: number
  /** When the agent was last seen */
  lastSeen: number
  /** Recent attempt history */
  history: Array<AttemptRecord & { timestamp: number }>
}

export interface RiskAssessment {
  /** Overall risk score (0-1) */
  score: number
  /** Individual risk factors */
  factors: {
    /** High failure rate */
    failureRate: number
    /** Abnormal solve times (too fast or too slow) */
    abnormalTiming: number
    /** Rapid-fire attempts (possible brute force) */
    rapidAttempts: number
    /** Inconsistent solve times (high variance) */
    inconsistentTiming: number
  }
  /** Human-readable risk level */
  level: 'low' | 'medium' | 'high' | 'critical'
}

// ---------------------------------------------------------------------------
// Difficulty ordering helpers
// ---------------------------------------------------------------------------

const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard']

function escalate(d: Difficulty): Difficulty {
  const idx = DIFFICULTY_ORDER.indexOf(d)
  return DIFFICULTY_ORDER[Math.min(idx + 1, DIFFICULTY_ORDER.length - 1)]
}

function relax(d: Difficulty): Difficulty {
  const idx = DIFFICULTY_ORDER.indexOf(d)
  return DIFFICULTY_ORDER[Math.max(idx - 1, 0)]
}

// ---------------------------------------------------------------------------
// Adaptive Difficulty Engine
// ---------------------------------------------------------------------------

export class AdaptiveDifficulty {
  private readonly config: Required<
    Pick<AdaptiveConfig, 'initialDifficulty' | 'escalateAfterFailures' | 'relaxAfterSuccesses' | 'maxHistory' | 'analysisWindowMs'>
  > & { solveTimeThresholds: Required<NonNullable<AdaptiveConfig['solveTimeThresholds']>> }

  private readonly agents = new Map<string, AgentProfile>()

  constructor(config?: AdaptiveConfig) {
    this.config = {
      initialDifficulty: config?.initialDifficulty ?? 'medium',
      escalateAfterFailures: config?.escalateAfterFailures ?? 2,
      relaxAfterSuccesses: config?.relaxAfterSuccesses ?? 5,
      maxHistory: config?.maxHistory ?? 50,
      analysisWindowMs: config?.analysisWindowMs ?? 300_000, // 5 min
      solveTimeThresholds: {
        suspiciousMs: config?.solveTimeThresholds?.suspiciousMs ?? 5_000,
        tooFastMs: config?.solveTimeThresholds?.tooFastMs ?? 5,
      },
    }
  }

  /**
   * Record a challenge attempt for an agent.
   * Updates the agent's profile and adjusts difficulty.
   */
  recordAttempt(agentId: string, attempt: AttemptRecord): void {
    const profile = this.getOrCreateProfile(agentId)
    const now = Date.now()

    const record = {
      ...attempt,
      timestamp: attempt.timestamp ?? now,
    }

    // Update history
    profile.history.push(record)
    if (profile.history.length > this.config.maxHistory) {
      profile.history.shift()
    }

    // Update counters
    profile.totalAttempts++
    profile.lastSeen = now

    if (attempt.success) {
      profile.totalSuccesses++
      profile.consecutiveSuccesses++
      profile.consecutiveFailures = 0
    } else {
      profile.consecutiveFailures++
      profile.consecutiveSuccesses = 0
    }

    // Update average solve time
    const solveTimes = profile.history.filter((h) => h.success).map((h) => h.solveTimeMs)
    if (solveTimes.length > 0) {
      profile.avgSolveTimeMs = solveTimes.reduce((a, b) => a + b, 0) / solveTimes.length
    }

    // Adjust difficulty
    if (profile.consecutiveFailures >= this.config.escalateAfterFailures) {
      profile.currentDifficulty = escalate(profile.currentDifficulty)
      profile.consecutiveFailures = 0 // Reset after escalation
    } else if (profile.consecutiveSuccesses >= this.config.relaxAfterSuccesses) {
      profile.currentDifficulty = relax(profile.currentDifficulty)
      profile.consecutiveSuccesses = 0 // Reset after relaxation
    }

    // Update risk score
    profile.riskScore = this.computeRiskScore(profile).score
  }

  /**
   * Get the recommended difficulty for an agent's next challenge.
   */
  getDifficulty(agentId: string): Difficulty {
    const profile = this.agents.get(agentId)
    return profile?.currentDifficulty ?? this.config.initialDifficulty
  }

  /**
   * Get the full risk assessment for an agent.
   */
  getRiskAssessment(agentId: string): RiskAssessment {
    const profile = this.agents.get(agentId)
    if (!profile) {
      return {
        score: 0,
        factors: { failureRate: 0, abnormalTiming: 0, rapidAttempts: 0, inconsistentTiming: 0 },
        level: 'low',
      }
    }
    return this.computeRiskScore(profile)
  }

  /**
   * Get the risk score (0-1) for an agent. Shorthand for getRiskAssessment().score.
   */
  getRiskScore(agentId: string): number {
    return this.getRiskAssessment(agentId).score
  }

  /**
   * Get the full profile for an agent.
   */
  getProfile(agentId: string): AgentProfile | undefined {
    return this.agents.get(agentId)
  }

  /**
   * Reset an agent's profile.
   */
  reset(agentId?: string): void {
    if (agentId) {
      this.agents.delete(agentId)
    } else {
      this.agents.clear()
    }
  }

  /** Number of tracked agents */
  get size(): number {
    return this.agents.size
  }

  // ---- Private helpers ----

  private getOrCreateProfile(agentId: string): AgentProfile {
    let profile = this.agents.get(agentId)
    if (!profile) {
      const now = Date.now()
      profile = {
        currentDifficulty: this.config.initialDifficulty,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        totalAttempts: 0,
        totalSuccesses: 0,
        avgSolveTimeMs: 0,
        riskScore: 0,
        firstSeen: now,
        lastSeen: now,
        history: [],
      }
      this.agents.set(agentId, profile)
    }
    return profile
  }

  private computeRiskScore(profile: AgentProfile): RiskAssessment {
    const now = Date.now()
    const recentHistory = profile.history.filter(
      (h) => now - h.timestamp < this.config.analysisWindowMs,
    )

    // Factor 1: Failure rate (0-1)
    const failureRate =
      profile.totalAttempts > 0
        ? 1 - profile.totalSuccesses / profile.totalAttempts
        : 0

    // Factor 2: Abnormal timing (too fast or too slow)
    const successfulTimes = recentHistory.filter((h) => h.success).map((h) => h.solveTimeMs)
    let abnormalTiming = 0
    if (successfulTimes.length > 0) {
      const tooFast = successfulTimes.filter(
        (t) => t < this.config.solveTimeThresholds.tooFastMs,
      ).length
      const tooSlow = successfulTimes.filter(
        (t) => t > this.config.solveTimeThresholds.suspiciousMs,
      ).length
      abnormalTiming = (tooFast + tooSlow) / successfulTimes.length
    }

    // Factor 3: Rapid-fire attempts (many attempts in short window)
    let rapidAttempts = 0
    if (recentHistory.length >= 10) {
      const timeSpan = recentHistory[recentHistory.length - 1].timestamp - recentHistory[0].timestamp
      if (timeSpan > 0) {
        const rate = recentHistory.length / (timeSpan / 1000) // attempts per second
        rapidAttempts = Math.min(1, rate / 2) // >2 per second = max risk
      }
    }

    // Factor 4: Inconsistent timing (high coefficient of variation)
    let inconsistentTiming = 0
    if (successfulTimes.length >= 3) {
      const mean = successfulTimes.reduce((a, b) => a + b, 0) / successfulTimes.length
      const variance =
        successfulTimes.reduce((sum, t) => sum + (t - mean) ** 2, 0) / successfulTimes.length
      const stdDev = Math.sqrt(variance)
      const cv = mean > 0 ? stdDev / mean : 0
      inconsistentTiming = Math.min(1, cv / 2) // CV > 2 = max risk
    }

    // Weighted composite score
    const score = Math.min(
      1,
      failureRate * 0.35 +
        abnormalTiming * 0.25 +
        rapidAttempts * 0.25 +
        inconsistentTiming * 0.15,
    )

    const level: RiskAssessment['level'] =
      score >= 0.75 ? 'critical' : score >= 0.5 ? 'high' : score >= 0.25 ? 'medium' : 'low'

    return {
      score,
      factors: { failureRate, abnormalTiming, rapidAttempts, inconsistentTiming },
      level,
    }
  }
}
