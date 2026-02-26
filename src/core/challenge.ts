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
    for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * 16)]
  }
  return result
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
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
]

const HARD_OPS: OpFactory[] = [
  ...MEDIUM_OPS,
  () => ({ op: 'repeat', times: randomInt(2, 3) }),
  (val) => {
    const idx = randomInt(0, val.length - 1)
    return { op: 'replace', search: val[idx], replacement: randomHex(1) }
  },
  (val) => ({
    op: 'pad_start',
    length: val.length + randomInt(2, 6),
    fill: randomHex(1),
  }),
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

export function verifyAnswer(challenge: Challenge, answer: string): boolean {
  if (Date.now() - challenge.timestamp > challenge.ttl) return false
  return fnv1a(answer + ':' + challenge.id) === challenge.verification
}

export function createToken(
  challenge: Challenge,
  answer: string,
  startTime: number,
): ImRobotToken {
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
