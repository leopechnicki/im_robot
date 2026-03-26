import type { Difficulty } from '../core/types'
import type { MiddlewareRequest, MiddlewareResponse } from './middleware'

/**
 * Configuration for the `.well-known/imrobot.json` discovery endpoint.
 *
 * Inspired by A2A Agent Card (`.well-known/agent.json`), this lets AI agents
 * discover that a server uses imrobot and how to interact with it.
 */
export interface DiscoveryConfig {
  /** Base URL of the challenge/verify endpoints (e.g., "/imrobot") */
  challengePath?: string
  /** Supported difficulty levels (default: all) */
  difficulties?: Difficulty[]
  /** Human-readable description of what this service does */
  description?: string
  /** Service name */
  name?: string
  /** Contact URL or email for the service operator */
  contact?: string
  /** Additional metadata to include in the discovery response */
  metadata?: Record<string, unknown>
}

/**
 * The discovery document served at `/.well-known/imrobot.json`.
 *
 * AI agents can fetch this to understand:
 * - That the server uses imrobot for agent verification
 * - Where to find the challenge/verify endpoints
 * - What difficulty levels are available
 * - The protocol version
 */
export interface DiscoveryDocument {
  /** Protocol identifier */
  protocol: 'imrobot'
  /** Protocol version (matches package version range) */
  version: string
  /** Service description */
  description: string
  /** Service name (optional) */
  name?: string
  /** Endpoint paths relative to the server root */
  endpoints: {
    /** GET — returns a signed challenge */
    challenge: string
    /** POST — submit answer, receive proof token */
    verify: string
    /** Where to send the proof token (header name) */
    proofHeader: string
  }
  /** Available difficulty levels */
  difficulties: Difficulty[]
  /** How agents should interact with the service */
  instructions: string
  /** Contact info (optional) */
  contact?: string
  /** Additional metadata */
  metadata?: Record<string, unknown>
}

const DEFAULT_INSTRUCTIONS = [
  '1. GET the challenge endpoint to receive a signed challenge.',
  '2. Parse the `pipeline` array and execute each operation on the `seed` string in order.',
  '3. POST the original challenge object and your computed answer to the verify endpoint.',
  '4. On success, you receive an `X-Agent-Proof` token.',
  '5. Include this token in the `X-Agent-Proof` header for subsequent requests to protected routes.',
].join('\n')

/**
 * Build a discovery document from the given configuration.
 */
export function buildDiscoveryDocument(config: DiscoveryConfig = {}): DiscoveryDocument {
  const basePath = config.challengePath ?? '/imrobot'
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath

  return {
    protocol: 'imrobot',
    version: '1.0',
    description:
      config.description ?? 'This service uses imrobot reverse-CAPTCHA for AI agent verification.',
    ...(config.name ? { name: config.name } : {}),
    endpoints: {
      challenge: `${normalizedBase}/challenge`,
      verify: `${normalizedBase}/verify`,
      proofHeader: 'X-Agent-Proof',
    },
    difficulties: config.difficulties ?? ['easy', 'medium', 'hard'],
    instructions: DEFAULT_INSTRUCTIONS,
    ...(config.contact ? { contact: config.contact } : {}),
    ...(config.metadata ? { metadata: config.metadata } : {}),
  }
}

/**
 * Create a request handler that serves the discovery document.
 *
 * Mount this at `/.well-known/imrobot.json` in your application.
 *
 * @example Express
 * ```typescript
 * import express from 'express'
 * import { createDiscoveryHandler } from 'imrobot/server'
 *
 * const app = express()
 * const discovery = createDiscoveryHandler({
 *   challengePath: '/imrobot',
 *   name: 'My Agent API',
 *   description: 'Agent-only data service',
 * })
 *
 * app.get('/.well-known/imrobot.json', discovery)
 * ```
 *
 * @example Hono / Koa / any framework
 * ```typescript
 * import { buildDiscoveryDocument } from 'imrobot/server'
 *
 * const doc = buildDiscoveryDocument({ challengePath: '/imrobot' })
 * // Serve `doc` as JSON at /.well-known/imrobot.json
 * ```
 */
export function createDiscoveryHandler(config: DiscoveryConfig = {}) {
  const document = buildDiscoveryDocument(config)

  return (_req: MiddlewareRequest, res: MiddlewareResponse) => {
    return res.status(200).json(document)
  }
}
