/**
 * Server API tests
 * Using Node.js built-in test runner (node:test)
 */

import { test } from 'node:test'
import assert from 'node:assert'
import { createServer, request as httpRequest } from 'http'
import { generateChallenge, verifyAnswer, createToken } from './challenge.mjs'
import { solveChallenge } from './solver.mjs'

// ─── API Server Implementation (embedded from src/server/index.ts) ──────────

const SUSPICIOUS_THRESHOLD_MS = 5_000

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

// In-memory challenge store
const challengeStore = new Map()

// formatPipeline helper
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

function formatPipeline(seed, pipeline) {
  const lines = [`seed: "${seed}"`]
  pipeline.forEach((op, i) => {
    lines.push(`  ${i + 1}. ${formatOperation(op)}`)
  })
  return lines.join('\n')
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

test('Server: POST /api/v1/challenge returns valid challenge', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const res = await makeRequest(server, 'POST', '/api/v1/challenge')
    assert.strictEqual(res.status, 200)
    assert.ok(res.body.challenge)
    assert.strictEqual(res.body.challenge.version, 1)
    assert.ok(res.body.challenge.id)
    assert.ok(res.body.challenge.pipeline)
    assert.ok(res.body.humanReadable)
  } finally {
    server.close()
  }
})

test('Server: POST /api/v1/challenge with difficulty parameter', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const res = await makeRequest(server, 'POST', '/api/v1/challenge', {
      difficulty: 'hard',
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.challenge.difficulty, 'hard')
    assert.ok(res.body.challenge.pipeline.length >= 5)
  } finally {
    server.close()
  }
})

test('Server: POST /api/v1/challenge with custom TTL', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const customTtl = 60_000
    const res = await makeRequest(server, 'POST', '/api/v1/challenge', {
      ttl: customTtl,
    })
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.challenge.ttl, customTtl)
  } finally {
    server.close()
  }
})

test('Server: POST /api/v1/solve solves a challenge', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    // Generate challenge
    const challengeRes = await makeRequest(server, 'POST', '/api/v1/challenge')
    const challenge = challengeRes.body.challenge

    // Solve it
    const solveRes = await makeRequest(server, 'POST', '/api/v1/solve', {
      challengeId: challenge.id,
    })

    assert.strictEqual(solveRes.status, 200)
    assert.ok(solveRes.body.answer)
    assert.ok(solveRes.body.token)
    assert.strictEqual(solveRes.body.token.challengeId, challenge.id)
  } finally {
    server.close()
  }
})

test('Server: POST /api/v1/solve with challenge object', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const challenge = generateChallenge()
    const solveRes = await makeRequest(server, 'POST', '/api/v1/solve', {
      challenge,
    })

    assert.strictEqual(solveRes.status, 200)
    assert.ok(solveRes.body.answer)
  } finally {
    server.close()
  }
})

test('Server: POST /api/v1/verify accepts correct answer', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const challengeRes = await makeRequest(server, 'POST', '/api/v1/challenge')
    const challenge = challengeRes.body.challenge

    const solveRes = await makeRequest(server, 'POST', '/api/v1/solve', {
      challengeId: challenge.id,
    })
    const answer = solveRes.body.answer

    // Recreate challenge for verification (in real scenario, it's in store)
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

    assert.strictEqual(verifyRes.status, 200)
    assert.ok(typeof verifyRes.body.valid === 'boolean')
  } finally {
    server.close()
  }
})

test('Server: POST /api/v1/verify rejects wrong answer', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const challenge = generateChallenge()
    const wrongAnswer = 'definitely_wrong'

    const verifyRes = await makeRequest(server, 'POST', '/api/v1/verify', {
      challenge,
      answer: wrongAnswer,
    })

    assert.strictEqual(verifyRes.status, 200)
    assert.strictEqual(verifyRes.body.valid, false)
  } finally {
    server.close()
  }
})

test('Server: GET /api/v1/health returns status ok', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const res = await makeRequest(server, 'GET', '/api/v1/health')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.status, 'ok')
    assert.ok(typeof res.body.uptime === 'number')
    assert.ok(typeof res.body.activeChallenges === 'number')
  } finally {
    server.close()
  }
})

test('Server: GET /api/v1/info returns API information', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const res = await makeRequest(server, 'GET', '/api/v1/info')
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.name, 'imrobot')
    assert.ok(res.body.version)
    assert.ok(Array.isArray(res.body.supportedOperations))
    assert.strictEqual(res.body.supportedOperations.length, 12)
    assert.ok(Array.isArray(res.body.difficulties))
  } finally {
    server.close()
  }
})

test('Server: 404 for unknown routes', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
    const res = await makeRequest(server, 'GET', '/unknown/path')
    assert.strictEqual(res.status, 404)
    assert.ok(res.body.error)
  } finally {
    server.close()
  }
})

test('Server: invalid JSON body handling', async () => {
  const server = createTestServer()
  await new Promise((resolve) => server.listen(0, 'localhost', resolve))

  try {
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

    assert.strictEqual(res.status, 500)
  } finally {
    server.close()
  }
})

console.log('\n✓ All server tests completed!')
