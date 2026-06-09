import type { Challenge, Operation, Difficulty, ImRobotToken, ImRobotConfig } from './types'
import { SUSPICIOUS_THRESHOLD_MS } from './types'
import { executePipeline } from './operations'
import { fnv1a } from './hash'

function randomHex(length: number): string {
  const chars = '0123456789abcdef'
  let result = ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = crypto.getRandomValues(new Uint8Array(length))
    for (let i = 0; i < length; i++) result += chars[values[i] % 16]
  } else {
    throw new Error(
      'randomHex: crypto.getRandomValues is not available — cannot generate secure random values',
    )
  }
  return result
}

function randomInt(min: number, max: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const range = max - min + 1
    const bytes = crypto.getRandomValues(new Uint32Array(1))
    return min + (bytes[0] % range)
  }
  throw new Error(
    'randomInt: crypto.getRandomValues is not available — cannot generate secure random values',
  )
}

function pickRandom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]
}

/** Default TTL per difficulty — shorter windows prevent human relay */
function getDefaultTtl(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'easy':
      return 30_000
    case 'medium':
      return 20_000
    case 'hard':
      return 15_000
  }
}

/** Nonce length increases with difficulty */
function getNonceLength(difficulty: Difficulty): number {
  switch (difficulty) {
    case 'easy':
      return 4
    case 'medium':
      return 6
    case 'hard':
      return 8
  }
}

type OpFactory = (currentValue: string) => Operation

const EASY_OPS: OpFactory[] = [
  () => ({ op: 'reverse' }),
  () => ({ op: 'to_upper' }),
  () => ({ op: 'to_lower' }),
  () => ({ op: 'sort_chars' }),
  // New: simple operations for variety
  () => ({ op: 'length' }),
  () => ({ op: 'slice_alternate' }),
  () => ({ op: 'vowel_count' }),
  () => ({ op: 'atbash' }),
]

const MEDIUM_OPS: OpFactory[] = [
  ...EASY_OPS,
  () => ({ op: 'base64_encode' }),
  () => ({ op: 'rot13' }),
  () => ({ op: 'hex_encode' }),
  () => ({ op: 'char_code_sum' }),
  (val) => {
    const maxEnd = Math.min(val.length, 16)
    if (maxEnd < 5) return { op: 'reverse' }
    const start = randomInt(0, Math.floor(maxEnd / 3))
    const end = randomInt(start + 4, maxEnd)
    return { op: 'substring', start, end }
  },
  // New: parameterized operations
  () => ({ op: 'consonant_extract' }),
  () => ({ op: 'run_length_encode' }),
  () => ({ op: 'caesar', shift: randomInt(1, 25) }),
  (val) => {
    const chars = Array.from(new Set(Array.from(val)))
    if (chars.length === 0) return { op: 'length' }
    return { op: 'count_chars', char: pickRandom(chars) }
  },
]

const HARD_OPS: OpFactory[] = [
  ...MEDIUM_OPS,
  () => ({ op: 'repeat', times: randomInt(2, 3) }),
  (val) => {
    if (val.length === 0) return { op: 'reverse' }
    const idx = randomInt(0, val.length - 1)
    return { op: 'replace', search: val[idx], replacement: randomHex(1) }
  },
  (val) => ({
    op: 'pad_start',
    length: Math.max(val.length, 1) + randomInt(2, 6),
    fill: randomHex(1),
  }),
  // XOR and hash operations
  () => ({ op: 'xor_encode', key: randomInt(1, 127) }),
  () => ({ op: 'fnv1a_hash' }),
  // Crypto-grade operations (v0.4) — hash_chain replaces sha256_hash for new challenges
  () => ({ op: 'hash_chain', rounds: randomInt(2, 5) }),
  () => ({
    op: 'byte_xor',
    key: Array.from({ length: randomInt(2, 8) }, () => randomInt(1, 255)),
  }),
  () => ({ op: 'nibble_swap' }),
  () => ({ op: 'bit_rotate', bits: randomInt(1, 7) }),
]

function getOpsForDifficulty(difficulty: Difficulty) {
  switch (difficulty) {
    case 'easy':
      return { ops: EASY_OPS, count: [2, 3] as const }
    case 'medium':
      return { ops: MEDIUM_OPS, count: [3, 5] as const }
    case 'hard':
      return { ops: HARD_OPS, count: [5, 7] as const }
  }
}

function buildPipeline(seed: string, difficulty: Difficulty): Operation[] {
  const { ops, count } = getOpsForDifficulty(difficulty)
  const numOps = randomInt(count[0], count[1])
  const pipeline: Operation[] = []
  let currentValue = seed

  for (let i = 0; i < numOps; i++) {
    const factory = pickRandom(ops)
    const op = factory(currentValue)
    pipeline.push(op)
    currentValue = executePipeline(currentValue, [op])
  }

  return pipeline
}

export function generateChallenge(config?: Partial<ImRobotConfig>, _depth = 0): Challenge {
  if (_depth > 10) throw new Error('Failed to generate valid challenge')

  const difficulty = config?.difficulty ?? 'medium'
  const ttl = config?.ttl ?? getDefaultTtl(difficulty)

  // Split seed into visible part (displayed) + hidden nonce (only in JSON)
  const visibleSeed = randomHex(16)
  const nonce = randomHex(getNonceLength(difficulty))
  const seed = visibleSeed + nonce

  const pipeline = buildPipeline(seed, difficulty)

  let answer: string
  try {
    answer = executePipeline(seed, pipeline)
  } catch {
    return generateChallenge(config, _depth + 1)
  }

  if (!answer || answer.length === 0 || answer.length > 10_000) {
    return generateChallenge(config, _depth + 1)
  }

  const id = randomHex(16)
  const verification = fnv1a(answer + ':' + id)

  return {
    version: 1,
    id,
    timestamp: Date.now(),
    ttl,
    difficulty,
    seed,
    visibleSeed,
    nonce,
    pipeline,
    verification,
  }
}

/**
 * Client-side answer verification using FNV-1a hash.
 *
 * **Security note**: FNV-1a is a fast, non-cryptographic 32-bit hash.
 * It is trivially collision-prone and MUST NOT be used as a sole security gate.
 * This function is intended only for client-side UX feedback (instant pass/fail).
 * All security-critical verification MUST go through the server-side
 * `ImRobotVerifier.verify()` which uses HMAC-SHA256 + pipeline re-execution.
 *
 * **Configuration guard**: This function performs client-side-only verification.
 * For production, always pair it with server-side `ImRobotVerifier.verify()` which
 * requires a properly configured HMAC secret. Using this function as the sole
 * verification gate is a security misconfiguration.
 */
export function verifyAnswer(challenge: Challenge, answer: string): boolean {
  if (Date.now() - challenge.timestamp > challenge.ttl) return false
  return fnv1a(answer + ':' + challenge.id) === challenge.verification
}

/**
 * Guard that throws if `verifyAnswer` is called in a context where the
 * caller appears to be relying on it as the sole security gate (i.e.,
 * when running in a Node.js / server-side environment without a registered
 * server-side HMAC verifier).
 *
 * Usage: call this at the top of any server-side route that should use
 * `ImRobotVerifier.verify()` instead of the client-side `verifyAnswer()`.
 *
 * @throws {Error} If invoked in an environment where `verifyAnswer` should
 *   not be used as a security gate.
 *
 * @example
 * ```typescript
 * // In an Express route handler:
 * import { assertServerSideOnly } from 'imrobot/core'
 *
 * app.post('/api/verify', (req, res) => {
 *   assertServerSideOnly() // throws if misconfigured
 *   // ... rest of handler should use ImRobotVerifier, not verifyAnswer
 * })
 * ```
 */
export function assertServerSideOnly(context?: string): void {
  const isNodeLike =
    typeof process !== 'undefined' &&
    typeof process.versions !== 'undefined' &&
    typeof process.versions.node !== 'undefined'

  if (isNodeLike) {
    throw new Error(
      `[im_robot] ${context ?? 'verifyAnswer()'} must not be used as a server-side security gate. ` +
      'It uses FNV-1a (non-cryptographic, collision-prone) and has no HMAC validation. ' +
      'Use ImRobotVerifier.verify() from imrobot/server instead, which uses HMAC-SHA256 ' +
      'and re-executes the pipeline. See https://github.com/leopechnicki/im_robot#server-verification',
    )
  }
}

export function createToken(challenge: Challenge, answer: string, startTime: number): ImRobotToken {
  const elapsed = Date.now() - startTime
  const signature = fnv1a(`${challenge.id}:${answer}:${elapsed}`)
  return {
    challengeId: challenge.id,
    answer,
    timestamp: Date.now(),
    elapsed,
    suspicious: elapsed > SUSPICIOUS_THRESHOLD_MS,
    signature,
  }
}
