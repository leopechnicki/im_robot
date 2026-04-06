export type {
  Operation,
  Challenge,
  SignedChallenge,
  Difficulty,
  ImRobotToken,
  ImRobotConfig,
  ServerConfig,
  VerifyResult,
  AgentProofToken,
  SerializedProofToken,
} from './types'

export { SUSPICIOUS_THRESHOLD_MS } from './types'

export {
  executeOperation,
  executePipeline,
  formatOperation,
  formatPipeline,
  formatOperationNL,
  formatPipelineNL,
} from './operations'
export { generateChallenge, verifyAnswer, createToken } from './challenge'
export { solveChallenge } from './solver'
export { fnv1a } from './hash'
export { hmacSign, hmacVerify, sha256 } from './hmac'
export { invisibleVerify } from './invisible'
export type { InvisibleVerifyOptions, InvisibleVerifyResult } from './invisible'

// Adaptive difficulty
export { AdaptiveDifficulty } from './adaptive'
export type { AdaptiveConfig, AttemptRecord, AgentProfile, RiskAssessment } from './adaptive'

// AI Image challenges
export { ImageChallengePool, IMAGE_CHALLENGE_TEMPLATES } from './image-challenge'
export type {
  ImageChallenge,
  ImageChallengeType,
  ImageChallengeTemplate,
  ImageChallengePoolConfig,
  ImageProviderConfig,
  OpenAIProviderConfig,
  StabilityProviderConfig,
  CustomProviderConfig,
  StaticProviderConfig,
} from './image-challenge'
