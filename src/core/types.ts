export type Operation =
  | { op: 'reverse' }
  | { op: 'base64_encode' }
  | { op: 'to_upper' }
  | { op: 'to_lower' }
  | { op: 'rot13' }
  | { op: 'hex_encode' }
  | { op: 'sort_chars' }
  | { op: 'char_code_sum' }
  | { op: 'substring'; start: number; end: number }
  | { op: 'repeat'; times: number }
  | { op: 'replace'; search: string; replacement: string }
  | { op: 'pad_start'; length: number; fill: string }

export interface Challenge {
  version: 1
  id: string
  timestamp: number
  ttl: number
  difficulty: Difficulty
  /** Full seed used for computation (visibleSeed + nonce) */
  seed: string
  /** The portion of the seed shown on screen */
  visibleSeed: string
  /** Hidden nonce — only present in the JSON data attribute, never displayed */
  nonce: string
  pipeline: Operation[]
  verification: string
}

export type Difficulty = 'easy' | 'medium' | 'hard'

/** Submissions slower than this are flagged as suspicious (possible human relay) */
export const SUSPICIOUS_THRESHOLD_MS = 5_000

export interface ImRobotToken {
  challengeId: string
  answer: string
  timestamp: number
  elapsed: number
  /** true when elapsed > SUSPICIOUS_THRESHOLD_MS — hints at human relay attack */
  suspicious: boolean
  signature: string
}

export interface ImRobotConfig {
  difficulty?: Difficulty
  ttl?: number
  theme?: 'light' | 'dark'
  onVerified?: (token: ImRobotToken) => void
  onError?: (error: Error) => void
}
