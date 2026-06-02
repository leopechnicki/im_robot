/**
 * imrobot MCP tool implementations.
 *
 * Each function maps to one MCP tool exposed by createMCPServer().
 * All are pure (no I/O) — they call the existing imrobot core/server APIs
 * directly so they can be fully unit-tested without a running MCP server.
 */

import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { buildDiscoveryDocument } from '../server/discovery'
import { executePipeline } from '../core/operations'
import type { Difficulty } from '../core/types'
import type { DiscoveryConfig } from '../server/discovery'

/** Config passed to the MCP server at creation time */
export interface MCPServerConfig {
  /** Default difficulty for generated challenges */
  defaultDifficulty?: Difficulty
  /** Discovery document config (used by get-discovery-document tool) */
  discovery?: DiscoveryConfig
}

// ---------------------------------------------------------------------------
// Tool: generate-challenge
// ---------------------------------------------------------------------------

export interface GenerateChallengeInput {
  difficulty?: string
}

export interface GenerateChallengeOutput {
  challenge: {
    id: string
    seed: string
    visibleSeed: string
    nonce: string
    pipeline: unknown[]
    difficulty: string
    timestamp: number
    ttl: number
    version: number
    verification: string
  }
  instructions: string
}

/**
 * Generate a new challenge and return it with human-readable instructions.
 *
 * Agents call this to receive a challenge they need to solve.
 */
export function toolGenerateChallenge(
  input: GenerateChallengeInput,
  config: MCPServerConfig,
): GenerateChallengeOutput {
  const difficulty = (input.difficulty ?? config.defaultDifficulty ?? 'medium') as Difficulty
  const valid: Difficulty[] = ['easy', 'medium', 'hard']
  if (!valid.includes(difficulty)) {
    throw new Error(`Invalid difficulty "${difficulty}". Must be one of: easy, medium, hard`)
  }

  const challenge = generateChallenge({ difficulty })

  return {
    challenge,
    instructions: [
      'To solve this challenge:',
      '1. Start with the "seed" value.',
      '2. Apply each operation in the "pipeline" array in order.',
      '3. Call the verify-answer tool with the challenge and your computed answer.',
      '4. On success, call create-token to get a proof token.',
      '',
      'Use the solve-challenge tool to auto-solve (if available in your environment).',
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Tool: verify-answer
// ---------------------------------------------------------------------------

export interface VerifyAnswerInput {
  challenge: {
    id: string
    seed: string
    pipeline: unknown[]
    timestamp: number
    ttl: number
    verification: string
    difficulty?: string
    version?: number
    visibleSeed?: string
    nonce?: string
  }
  answer: string
}

export interface VerifyAnswerOutput {
  valid: boolean
  reason?: string
}

/**
 * Verify an answer against a challenge using client-side FNV-1a verification.
 *
 * Note: This uses client-side verification (FNV-1a). For production security,
 * the proof token from create-token must be validated server-side with HMAC.
 */
export function toolVerifyAnswer(input: VerifyAnswerInput): VerifyAnswerOutput {
  try {
    const challenge = input.challenge as unknown as Parameters<typeof verifyAnswer>[0]
    const valid = verifyAnswer(challenge, input.answer)
    return { valid, ...(valid ? {} : { reason: 'wrong_answer_or_expired' }) }
  } catch (err) {
    throw new Error(`Invalid challenge format: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Tool: create-token
// ---------------------------------------------------------------------------

export interface CreateTokenInput {
  challenge: {
    id: string
    seed: string
    pipeline: unknown[]
    timestamp: number
    ttl: number
    verification: string
    difficulty?: string
    version?: number
    visibleSeed?: string
    nonce?: string
  }
  answer: string
  startTime: number
}

export interface CreateTokenOutput {
  token: {
    challengeId: string
    answer: string
    timestamp: number
    elapsed: number
    suspicious: boolean
    signature: string
  }
  note: string
}

/**
 * Create an agent proof token after solving a challenge.
 *
 * The token should be submitted to the server as the X-Agent-Proof header
 * (or whichever header the server expects per the discovery document).
 */
export function toolCreateToken(input: CreateTokenInput): CreateTokenOutput {
  const challenge = input.challenge as unknown as Parameters<typeof verifyAnswer>[0]
  const token = createToken(challenge, input.answer, input.startTime)

  return {
    token,
    note: [
      'Submit this token to the protected endpoint in the X-Agent-Proof header.',
      'The server will verify the token using HMAC-SHA256 (server-side security).',
      `Token ID: ${token.challengeId}`,
      `Suspicious: ${token.suspicious} (fast solve times look less suspicious)`,
    ].join('\n'),
  }
}

// ---------------------------------------------------------------------------
// Tool: solve-challenge (auto-solver)
// ---------------------------------------------------------------------------

export interface SolveChallengeInput {
  challenge: {
    id: string
    seed: string
    pipeline: unknown[]
    timestamp: number
    ttl: number
    verification: string
    difficulty?: string
    version?: number
    visibleSeed?: string
    nonce?: string
  }
}

export interface SolveChallengeOutput {
  answer: string
  valid: boolean
  token: {
    challengeId: string
    answer: string
    timestamp: number
    elapsed: number
    suspicious: boolean
    signature: string
  }
}

/**
 * Auto-solve a challenge and return the answer + proof token in one step.
 *
 * This is the primary tool for agents that want to complete verification
 * automatically. Combines challenge solving, verification, and token creation.
 */
export function toolSolveChallenge(input: SolveChallengeInput): SolveChallengeOutput {
  const challenge = input.challenge as unknown as Parameters<typeof verifyAnswer>[0]
  const startTime = Date.now()

  let answer: string
  try {
    answer = executePipeline(
      challenge.seed,
      challenge.pipeline as Parameters<typeof executePipeline>[1],
    )
  } catch (err) {
    throw new Error(
      `Failed to solve challenge pipeline: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const valid = verifyAnswer(challenge, answer)
  const token = createToken(challenge, answer, startTime)

  return { answer, valid, token }
}

// ---------------------------------------------------------------------------
// Tool: get-discovery-document
// ---------------------------------------------------------------------------

export interface GetDiscoveryDocumentInput {
  challengePath?: string
}

export interface GetDiscoveryDocumentOutput {
  document: ReturnType<typeof buildDiscoveryDocument>
}

/**
 * Return the imrobot discovery document.
 *
 * Agents can call this to understand endpoint paths, protocol version,
 * and available difficulty levels for this server.
 */
export function toolGetDiscoveryDocument(
  input: GetDiscoveryDocumentInput,
  config: MCPServerConfig,
): GetDiscoveryDocumentOutput {
  const document = buildDiscoveryDocument({
    ...config.discovery,
    ...(input.challengePath ? { challengePath: input.challengePath } : {}),
  })
  return { document }
}

// ---------------------------------------------------------------------------
// Tool schemas (for MCP tools/list)
// ---------------------------------------------------------------------------

import type { MCPTool } from './types'

export const TOOL_DEFINITIONS: MCPTool[] = [
  {
    name: 'generate-challenge',
    description:
      'Generate a new imrobot verification challenge. Returns a challenge object with a seed, ' +
      'pipeline of operations to execute, and metadata. Solve the challenge by applying each ' +
      'pipeline operation to the seed in order, then call verify-answer or solve-challenge.',
    inputSchema: {
      type: 'object',
      properties: {
        difficulty: {
          type: 'string',
          description: 'Challenge difficulty level.',
          enum: ['easy', 'medium', 'hard'],
          default: 'medium',
        },
      },
    },
  },
  {
    name: 'solve-challenge',
    description:
      'Auto-solve a challenge by executing its pipeline and return the answer and proof token. ' +
      'This is the primary tool for agents — call generate-challenge first, then pass the result here.',
    inputSchema: {
      type: 'object',
      properties: {
        challenge: {
          type: 'object',
          description: 'The challenge object returned by generate-challenge.',
        },
      },
      required: ['challenge'],
    },
  },
  {
    name: 'verify-answer',
    description:
      'Verify a computed answer against a challenge using client-side FNV-1a verification. ' +
      'Returns valid: true if the answer is correct and the challenge has not expired.',
    inputSchema: {
      type: 'object',
      properties: {
        challenge: {
          type: 'object',
          description: 'The challenge object returned by generate-challenge.',
        },
        answer: {
          type: 'string',
          description: 'The computed answer after applying all pipeline operations to the seed.',
        },
      },
      required: ['challenge', 'answer'],
    },
  },
  {
    name: 'create-token',
    description:
      'Create an agent proof token after solving a challenge. ' +
      'Submit the returned token in the X-Agent-Proof header for subsequent requests.',
    inputSchema: {
      type: 'object',
      properties: {
        challenge: {
          type: 'object',
          description: 'The challenge object returned by generate-challenge.',
        },
        answer: {
          type: 'string',
          description: 'The correct answer computed from the challenge pipeline.',
        },
        startTime: {
          type: 'number',
          description: 'Unix timestamp (ms) when you started solving the challenge.',
        },
      },
      required: ['challenge', 'answer', 'startTime'],
    },
  },
  {
    name: 'get-discovery-document',
    description:
      'Get the imrobot discovery document describing the protocol, endpoints, and available ' +
      'difficulty levels. Call this first to understand how to interact with an imrobot-protected server.',
    inputSchema: {
      type: 'object',
      properties: {
        challengePath: {
          type: 'string',
          description: 'Override the challenge endpoint base path (default: /imrobot).',
        },
      },
    },
  },
]
