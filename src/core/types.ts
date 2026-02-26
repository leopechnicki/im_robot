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
  seed: string
  pipeline: Operation[]
  verification: string
}

export type Difficulty = 'easy' | 'medium' | 'hard'

export interface ImRobotToken {
  challengeId: string
  answer: string
  timestamp: number
  elapsed: number
  signature: string
}

export interface ImRobotConfig {
  difficulty?: Difficulty
  ttl?: number
  theme?: 'light' | 'dark'
  onVerified?: (token: ImRobotToken) => void
  onError?: (error: Error) => void
}
