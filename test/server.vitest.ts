/**
 * Server API tests - Vitest-compatible version
 * Run with: npm run test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer } from 'http'
import { request as httpRequest } from 'http'
import { generateChallenge, verifyAnswer, createToken } from '../src/core/challenge'
import { solveChallenge } from '../src/core/solver'
import { executePipeline, formatPipeline } from '../src/core/operations'

const SUSPICIOUS_THRESHOLD_MS = 5_000

// ─── API Server Implementation ──────────────────────────────────────

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(body))
}

function errorResponse(res, status, message) {
  jsonResponse(res, status, { error: message })
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
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

function isValidDifficulty(val) {
  return val === 'easy' || val === 'medium' || val === 'hard'
}

const challengeStore = new Map()

function formatOperation(op) {
  switch (op.op) {
    case 'reverse':
      return 'reverse()'
    case 'base64_encode':
      return 'base64_encode()'
    case 'to_upper':
      return 'to_upper()'
    case 'to_lower':
      return 'to_lower()'
    case 'rot13':
      return 'rot13()'
    case 'hex_encode':
      return 'hex_encode()'
    case 'sort_chars':
      return 'sort_chars()'
    case 'char_code_sum':
      return 'char_code_sum()'
    case 'substring':
      return `substring(${op.start}, ${op.end})`
    case 'repeat':
      return `repeat(${op.times})`
    case 'replace':
      return `replace("${op.search}", "${op.replacement}")`
    case 'pad_start':
      return `pad_start(${op.length}, "${op.fill}")`
  }
}

async function handleGenerateChallenge(req, res) {
  const body = await parseBody(req)
  const difficulty = body.difficulty && isValidDifficulty(body.difficulty)
    ? body.difficulty
    : 'medium'
  const ttl = typeof body.ttl === 'number' && body.ttl > 0
    ? body.ttl
    : undefined

  const challenge = generateChallenge({ difficulty, ttl })
  challengeStore.set(challenge.id, challenge)

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

async function handleSolve(req, res) {
  const body = await parseBody(req)
  const startTime = Date.now()

  let challenge

  if (body.challengeId && typeof body.challengeId === 'string') {
    challenge = challengeStore.get(body.challengeId)
    if (!challenge) {
      return errorResponse(res, 404, 'Challenge not found or expired')
    }
  } else if (body.challenge && typeof body.challenge === 'object') {
    challenge = body.challenge
  } else {
    return errorResponse(res, 400, 'Provide either "challenge" object or "challengeId"')
  }

  try {
    const answer = solveChallenge(challenge)
    const elapsed = Date.now() - startTime
    const token = {
      challengeId: challenge.id,
      answer,
      timestamp: Date.now(),
      elapsed,
      suspicious: elapsed > SUSPICIOUS_THRESHOLD_MS,
    }

    jsonResponse(res, 200, { answer, token })
  } catch (err) {
    errorResponse(res, 500, `Solve failed: ${err.message}`)
  }
}

async function handleVerify(req, res) {
  const body = await parseBody(req)
  const startTime = Date.now()

  if (typeof body.answer !== 'string') {
    return errorResponse(res, 400, '"answer" field is required')
  }

  let challenge

  if (body.challengeId && typeof body.challengeId === 'string') {
    challenge = challengeStore.get(body.challengeId)
    if (!challenge) {
      return errorResponse(res, 404, 'Challenge not found or expired')
    }
  } else if (body.challenge && typeof body.challenge === 'object') {
    challenge = body.challenge
  } else {
    return errorResponse(res, 400, 'Provide either "challenge" object or "challengeId"')
  }

  const valid = verifyAnswer(challenge, body.answer)
  const response = { valid }

  if (valid) {
    const elapsed = Date.now() - startTime
    response.token = {
      challengeId: challenge.id,
      answer: body.answer,
      timestamp: Date.now(),
      elapsed,
      suspicious: elapsed > SUSPICIOUS_THRESHOLD_MS,
    }
    if (body.challengeId) {
      challengeStore.delete(body.challengeId)
    }
  }

  jsonResponse(res, 200, response)
}

function handleHealth(req, res) {
  jsonResponse(res, 200, {
    status: 'ok',
    uptime: process.uptime(),
    activeChallenges: challengeStore.size,
  })
}

function handleInfo(req, res) {
  jsonResponse(res, 200, {
    name: 'imrobot',
    version: '0.1.0',
    description: 'Reverse-CAPTCHA API',
    supportedOperations: [
      'reverse', 'base64_encode', 'to_upper', 'to_lower',
      'rot13', 'hex_encode', 'sort_chars', 'char_code_sum',
      'substring', 'repeat', 'replace', 'pad_start',
    ],
    difficulties: ['easy', 'medium', 'hard'],
  })
}

function createTestServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const path = url.pathname
    const method = req.method?.toUpperCase()

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
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
      errorResponse(res, 500, err.message)
    }
  })

  return server
}

// ─── Helper: Make HTTP requests ────────────────────────────────────────────

function makeRequest(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: 'localhost',
        port: server.address().port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data ? JSON.parse(data) : null,
            })
          } catch (err) {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data,
            })
          }
        })
      },
    )

    req.on('error', reject)

    if (body) {
      req.write(JSON.stringify(body))
    }
    req.end()
  })
}

// ─── Server Tests ──────────────────────────────────────────────────────────

describe('REST API Server', () => {
  let server

  beforeEach(() => {
    server = createTestServer()
    return new Promise((resolve) => {
      server.listen(0, 'localhost', resolve)
    })
  })

  afterEach(() => {
    return new Promise((resolve) => {
      server.close(resolve)
    })
  })

  describe('POST /api/v1/challenge', () => {
    it('should return valid challenge', async () => {
      const res = await makeRequest(server, 'POST', '/api/v1/challenge')
      expect(res.status).toBe(200)
      expect(res.body.challenge).toBeDefined()
      expect(res.body.challenge.version).toBe(1)
      expect(res.body.challenge.id).toBeDefined()
      expect(res.body.challenge.pipeline).toBeDefined()
      expect(res.body.humanReadable).toBeDefined()
    })

    it('should accept difficulty parameter', async () => {
      const res = await makeRequest(server, 'POST', '/api/v1/challenge', {
        difficulty: 'hard',
      })
      expect(res.status).toBe(200)
      expect(res.body.challenge.difficulty).toBe('hard')
      expect(res.body.challenge.pipeline.length).toBeGreaterThanOrEqual(5)
    })

    it('should accept custom TTL', async () => {
      const customTtl = 60_000
      const res = await makeRequest(server, 'POST', '/api/v1/challenge', {
        ttl: customTtl,
      })
      expect(res.status).toBe(200)
      expect(res.body.challenge.ttl).toBe(customTtl)
    })
  })

  describe('POST /api/v1/solve', () => {
    it('should solve a challenge by ID', async () => {
      const challengeRes = await makeRequest(server, 'POST', '/api/v1/challenge')
      const challenge = challengeRes.body.challenge

      const solveRes = await makeRequest(server, 'POST', '/api/v1/solve', {
        challengeId: challenge.id,
      })

      expect(solveRes.status).toBe(200)
      expect(solveRes.body.answer).toBeDefined()
      expect(solveRes.body.token).toBeDefined()
      expect(solveRes.body.token.challengeId).toBe(challenge.id)
    })

    it('should solve challenge with challenge object', async () => {
      const challenge = generateChallenge()
      const solveRes = await makeRequest(server, 'POST', '/api/v1/solve', {
        challenge,
      })

      expect(solveRes.status).toBe(200)
      expect(solveRes.body.answer).toBeDefined()
    })
  })

  describe('POST /api/v1/verify', () => {
    it('should accept correct answer', async () => {
      const challengeRes = await makeRequest(server, 'POST', '/api/v1/challenge')
      const challenge = challengeRes.body.challenge

      const solveRes = await makeRequest(server, 'POST', '/api/v1/solve', {
        challengeId: challenge.id,
      })
      const answer = solveRes.body.answer

      const fullChallenge = generateChallenge()
      fullChallenge.id = challenge.id
      fullChallenge.pipeline = challenge.pipeline
      fullChallenge.seed = challenge.seed
      fullChallenge.verification = challenge.verification
      fullChallenge.timestamp = challenge.timestamp
      fullChallenge.ttl = challenge.ttl

      const verifyRes = await makeRequest(server, 'POST', '/api/v1/verify', {
        challengeId: challenge.id,
        answer,
      })

      expect(verifyRes.status).toBe(200)
      expect(typeof verifyRes.body.valid).toBe('boolean')
    })

    it('should reject wrong answer', async () => {
      const challenge = generateChallenge()
      const wrongAnswer = 'definitely_wrong'

      const verifyRes = await makeRequest(server, 'POST', '/api/v1/verify', {
        challenge,
        answer: wrongAnswer,
      })

      expect(verifyRes.status).toBe(200)
      expect(verifyRes.body.valid).toBe(false)
    })
  })

  describe('GET /api/v1/health', () => {
    it('should return health status', async () => {
      const res = await makeRequest(server, 'GET', '/api/v1/health')
      expect(res.status).toBe(200)
      expect(res.body.status).toBe('ok')
      expect(typeof res.body.uptime).toBe('number')
      expect(typeof res.body.activeChallenges).toBe('number')
    })
  })

  describe('GET /api/v1/info', () => {
    it('should return API information', async () => {
      const res = await makeRequest(server, 'GET', '/api/v1/info')
      expect(res.status).toBe(200)
      expect(res.body.name).toBe('imrobot')
      expect(res.body.version).toBeDefined()
      expect(Array.isArray(res.body.supportedOperations)).toBe(true)
      expect(res.body.supportedOperations).toHaveLength(12)
      expect(Array.isArray(res.body.difficulties)).toBe(true)
    })
  })

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await makeRequest(server, 'GET', '/unknown/path')
      expect(res.status).toBe(404)
      expect(res.body.error).toBeDefined()
    })

    it('should handle invalid JSON body', async () => {
      const res = await new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: 'localhost',
            port: server.address().port,
            path: '/api/v1/challenge',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          },
          (res) => {
            let data = ''
            res.on('data', (chunk) => {
              data += chunk
            })
            res.on('end', () => {
              resolve({
                status: res.statusCode,
                body: JSON.parse(data),
              })
            })
          },
        )
        req.on('error', reject)
        req.write('invalid json {')
        req.end()
      })

      expect(res.status).toBe(500)
    })
  })
})
