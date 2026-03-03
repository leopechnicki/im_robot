/**
 * imrobot REST API Server
 *
 * A lightweight HTTP server that exposes the imrobot core functionality
 * as REST endpoints. No UI needed — pure API for server-side verification.
 *
 * Endpoints:
 *   POST /api/v1/challenge       — Generate a new challenge
 *   POST /api/v1/solve           — Solve a challenge (for testing/demo)
 *   POST /api/v1/verify          — Verify an answer against a challenge
 *   GET  /api/v1/health          — Health check
 *   GET  /api/v1/info            — API info and supported operations
 *
 * Usage:
 *   npx tsx src/server/index.ts
 *   # or
 *   node dist/server/index.js
 */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { generateChallenge, verifyAnswer, createToken } from '../core/challenge'
import { solveChallenge } from '../core/solver'
import { formatPipeline } from '../core/operations'
import type { Challenge, Difficulty } from '../core/types'

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.IMROBOT_PORT ?? '3847', 10)
const HOST = process.env.IMROBOT_HOST ?? '0.0.0.0'
const CORS_ORIGIN = process.env.IMROBOT_CORS_ORIGIN ?? '*'

// In-memory challenge store (for stateful verification)
const challengeStore = new Map<string, Challenge>()

// Cleanup expired challenges every 60s
setInterval(() => {
  const now = Date.now()
  for (const [id, challenge] of challengeStore) {
    if (now - challenge.timestamp > challenge.ttl + 60_000) {
      challengeStore.delete(id)
    }
  }
}, 60_000)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(body))
}

function errorResponse(res: ServerResponse, status: number, message: string) {
  jsonResponse(res, status, { error: message })
}

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    req.on('data', (chunk: Uint8Array) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function isValidDifficulty(val: unknown): val is Difficulty {
  return val === 'easy' || val === 'medium' || val === 'hard'
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/challenge
 * Generate a new challenge.
 *
 * Body (optional):
 *   { "difficulty": "easy" | "medium" | "hard", "ttl": number }
 *
 * Response:
 *   { "challenge": Challenge (without seed — only visibleSeed exposed),
 *     "challengeId": string }
 */
async function handleGenerateChallenge(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req)

  const difficulty: Difficulty = body.difficulty && isValidDifficulty(body.difficulty)
    ? body.difficulty
    : 'medium'

  const ttl = typeof body.ttl === 'number' && body.ttl > 0
    ? body.ttl
    : undefined

  const challenge = generateChallenge({ difficulty, ttl })

  // Store for later verification
  challengeStore.set(challenge.id, challenge)

  // Return challenge data — agents need the full challenge including nonce
  // (which is in the JSON data attribute in DOM mode).
  // For API mode, we return the full challenge so agents can solve it.
  jsonResponse(res, 200, {
    challenge: {
      version: challenge.version,
      id: challenge.id,
      timestamp: challenge.timestamp,
      ttl: challenge.ttl,
      difficulty: challenge.difficulty,
      seed: challenge.seed,
      visibleSeed: challenge.visibleSeed,
      nonce: challenge.nonce,
      pipeline: challenge.pipeline,
      verification: challenge.verification,
    },
    humanReadable: formatPipeline(challenge.visibleSeed, challenge.pipeline),
  })
}

/**
 * POST /api/v1/solve
 * Solve a challenge. Useful for testing and as a reference implementation.
 *
 * Body:
 *   { "challenge": Challenge }
 *   or
 *   { "challengeId": string }  — looks up from store
 *
 * Response:
 *   { "answer": string, "token": ImRobotToken }
 */
async function handleSolve(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req)
  const startTime = Date.now()

  let challenge: Challenge | undefined

  if (body.challengeId && typeof body.challengeId === 'string') {
    challenge = challengeStore.get(body.challengeId)
    if (!challenge) {
      return errorResponse(res, 404, 'Challenge not found or expired')
    }
  } else if (body.challenge && typeof body.challenge === 'object') {
    challenge = body.challenge as Challenge
  } else {
    return errorResponse(res, 400, 'Provide either "challenge" object or "challengeId"')
  }

  try {
    const answer = solveChallenge(challenge)
    const token = createToken(challenge, answer, startTime)

    jsonResponse(res, 200, { answer, token })
  } catch (err) {
    errorResponse(res, 500, `Solve failed: ${(err as Error).message}`)
  }
}

/**
 * POST /api/v1/verify
 * Verify an answer against a stored challenge.
 *
 * Body:
 *   { "challengeId": string, "answer": string }
 *   or
 *   { "challenge": Challenge, "answer": string }
 *
 * Response:
 *   { "valid": boolean, "token"?: ImRobotToken }
 */
async function handleVerify(req: IncomingMessage, res: ServerResponse) {
  const body = await parseBody(req)
  const startTime = Date.now()

  if (typeof body.answer !== 'string') {
    return errorResponse(res, 400, '"answer" field is required')
  }

  let challenge: Challenge | undefined

  if (body.challengeId && typeof body.challengeId === 'string') {
    challenge = challengeStore.get(body.challengeId)
    if (!challenge) {
      return errorResponse(res, 404, 'Challenge not found or expired')
    }
  } else if (body.challenge && typeof body.challenge === 'object') {
    challenge = body.challenge as Challenge
  } else {
    return errorResponse(res, 400, 'Provide either "challenge" object or "challengeId"')
  }

  const valid = verifyAnswer(challenge, body.answer)
  const response: Record<string, unknown> = { valid }

  if (valid) {
    response.token = createToken(challenge, body.answer, startTime)
    // Remove from store after successful verification (one-time use)
    if (body.challengeId) {
      challengeStore.delete(body.challengeId as string)
    }
  }

  jsonResponse(res, 200, response)
}

/**
 * GET /api/v1/health
 * Health check endpoint.
 */
function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  jsonResponse(res, 200, {
    status: 'ok',
    uptime: process.uptime(),
    activeChallenges: challengeStore.size,
  })
}

/**
 * GET /api/v1/info
 * API information and supported operations.
 */
function handleInfo(_req: IncomingMessage, res: ServerResponse) {
  jsonResponse(res, 200, {
    name: 'imrobot',
    version: '0.1.0',
    description: 'Reverse-CAPTCHA API — verifies AI agents, not humans',
    endpoints: {
      'POST /api/v1/challenge': 'Generate a new challenge',
      'POST /api/v1/solve': 'Solve a challenge (reference/testing)',
      'POST /api/v1/verify': 'Verify an answer',
      'GET /api/v1/health': 'Health check',
      'GET /api/v1/info': 'This endpoint',
    },
    supportedOperations: [
      'reverse', 'base64_encode', 'to_upper', 'to_lower',
      'rot13', 'hex_encode', 'sort_chars', 'char_code_sum',
      'substring', 'repeat', 'replace', 'pad_start',
    ],
    difficulties: ['easy', 'medium', 'hard'],
  })
}

// ─── Router ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const path = url.pathname
  const method = req.method?.toUpperCase()

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  try {
    if (path === '/api/v1/challenge' && method === 'POST') {
      await handleGenerateChallenge(req, res)
    } else if (path === '/api/v1/solve' && method === 'POST') {
      await handleSolve(req, res)
    } else if (path === '/api/v1/verify' && method === 'POST') {
      await handleVerify(req, res)
    } else if (path === '/api/v1/health' && method === 'GET') {
      handleHealth(req, res)
    } else if (path === '/api/v1/info' && method === 'GET') {
      handleInfo(req, res)
    } else {
      errorResponse(res, 404, `Not found: ${method} ${path}`)
    }
  } catch (err) {
    console.error('Request error:', err)
    errorResponse(res, 500, (err as Error).message)
  }
})

server.listen(PORT, HOST, () => {
  console.log(`🤖 imrobot API server running at http://${HOST}:${PORT}`)
  console.log(`   Endpoints:`)
  console.log(`     POST /api/v1/challenge  — Generate challenge`)
  console.log(`     POST /api/v1/solve      — Solve challenge`)
  console.log(`     POST /api/v1/verify     — Verify answer`)
  console.log(`     GET  /api/v1/health     — Health check`)
  console.log(`     GET  /api/v1/info       — API info`)
})

export { server }
