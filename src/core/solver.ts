import type { Challenge } from './types'
import { executePipeline } from './operations'

/**
 * Reference solver for AI agents.
 * Parses a challenge and computes the correct answer by executing the pipeline.
 */
export function solveChallenge(challenge: Challenge): string {
  return executePipeline(challenge.seed, challenge.pipeline)
}
