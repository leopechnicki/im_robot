import type { Difficulty } from '../core/types'
import type { WebBotAuthPolicyConfig } from '../server/web-bot-auth'

/**
 * Configuration for the Next.js App Router middleware.
 */
export interface NextMiddlewareConfig {
  /**
   * HMAC secret for challenge signing (min 16 chars).
   * Use process.env.IMROBOT_SECRET — never hardcode.
   */
  secret: string

  /**
   * Difficulty level for generated challenges.
   * @default 'medium'
   */
  difficulty?: Difficulty

  /**
   * Challenge TTL in milliseconds. Defaults to per-difficulty value.
   * easy: 30s, medium: 20s, hard: 15s
   */
  ttl?: number

  /**
   * Path prefix where imrobot challenge/verify endpoints are mounted.
   * @default '/imrobot'
   */
  imrobotPath?: string

  /**
   * Paths that require a valid X-Agent-Proof token.
   * Requests without a valid token receive 401.
   * @example ['/api/agent', '/api/data']
   */
  protectedPaths?: string[]

  /**
   * Header name for the agent proof token.
   * @default 'x-agent-proof'
   */
  proofHeaderName?: string

  /**
   * Proof token TTL in milliseconds.
   * @default 3600000 (1 hour)
   */
  tokenTTL?: number

  /**
   * Maximum requests per window per IP (for rate limiting).
   * @default 30
   */
  rateLimit?: {
    windowMs: number
    maxRequests: number
  }

  /**
   * Optional Web Bot Auth (draft-ietf-webbotauth-httpsig-protocol-01) on
   * `protectedPaths`: a request with a valid signature passes without a proof
   * token; everything else must present one (401 carries `Accept-Signature`).
   * @example { trustedSignatureAgents: ['https://agent.example'] }
   */
  webBotAuth?: WebBotAuthPolicyConfig
}

/**
 * Configuration for the Next.js Pages Router API handler.
 */
export interface NextApiHandlerConfig {
  /**
   * HMAC secret for challenge signing (min 16 chars).
   */
  secret: string

  /**
   * Difficulty level for generated challenges.
   * @default 'medium'
   */
  difficulty?: Difficulty

  /**
   * Challenge TTL in milliseconds.
   */
  ttl?: number

  /**
   * Issuer name embedded in proof tokens.
   * @default 'imrobot'
   */
  issuer?: string

  /**
   * Proof token TTL in milliseconds.
   * @default 3600000 (1 hour)
   */
  tokenTTL?: number
}

/**
 * Minimal Next.js request type (App Router).
 * Compatible with NextRequest without importing next/server.
 */
export interface NextRequestLike {
  method?: string
  url: string
  headers: {
    get(name: string): string | null
    /** Present on NextRequest; lets Web Bot Auth see every signed header. */
    forEach?(cb: (value: string, key: string) => void): void
  }
  json(): Promise<unknown>
  ip?: string
}

/**
 * Minimal Next.js response type (App Router).
 * Compatible with NextResponse without importing next/server.
 */
export interface NextResponseLike {
  status: number
}

/**
 * Minimal Next.js API request type (Pages Router).
 */
export interface NextApiRequestLike {
  method?: string
  body?: unknown
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
}

/**
 * Minimal Next.js API response type (Pages Router).
 */
export interface NextApiResponseLike {
  status(code: number): NextApiResponseLike
  json(data: unknown): void
  setHeader(name: string, value: string | number): void
  end(): void
}
