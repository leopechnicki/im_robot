/**
 * MCP (Model Context Protocol) server integration for imrobot.
 *
 * Exposes imrobot's challenge system as MCP tools, enabling AI agents to
 * auto-discover and complete verification without custom integration code.
 *
 * Uses @modelcontextprotocol/sdk (peer dependency — install separately):
 *   npm install @modelcontextprotocol/sdk
 *
 * @example
 * ```typescript
 * import { createMcpServer } from 'imrobot/mcp'
 * import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
 *
 * const server = createMcpServer()
 * const transport = new StdioServerTransport()
 * await server.connect(transport)
 * ```
 *
 * @module
 */

import { generateChallenge, verifyAnswer } from '../core/challenge'
import { buildDiscoveryDocument } from '../server/discovery'
import type { Difficulty, ImRobotConfig } from '../core/types'

/**
 * Minimal interface for the MCP Server from @modelcontextprotocol/sdk.
 * Using a structural type avoids hard-coupling to the SDK version.
 */
export interface McpServer {
  tool(name: string, description: string, schema: Record<string, unknown>, handler: (args: Record<string, unknown>) => Promise<McpToolResult>): void
  connect(transport: unknown): Promise<void>
  close(): Promise<void>
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** Configuration for the imrobot MCP server */
export interface ImRobotMcpConfig {
  /** imrobot config passed to challenge generation */
  imrobotConfig?: Partial<ImRobotConfig>
  /** Secret key for HMAC verification (if using server-side verification) */
  secretKey?: string
  /** Default difficulty for generated challenges. Default: 'medium' */
  defaultDifficulty?: Difficulty
  /** Discovery document base URL */
  baseUrl?: string
}

/**
 * Create a configured imrobot MCP server instance.
 *
 * Registers three MCP tools:
 * - `generate_challenge` — Generate a new imrobot challenge
 * - `verify_answer` — Verify an answer to a challenge
 * - `get_discovery_document` — Get the .well-known/imrobot.json discovery document
 *
 * @param mcpSdkServer - An MCP Server instance from @modelcontextprotocol/sdk
 * @param config - imrobot MCP configuration
 * @returns The configured server (same instance, for chaining)
 */
export function configureMcpServer(
  mcpSdkServer: McpServer,
  config?: ImRobotMcpConfig
): McpServer {
  const defaultDifficulty: Difficulty = config?.defaultDifficulty ?? 'medium'
  const baseUrl = config?.baseUrl ?? 'https://example.com'

  // Tool: generate_challenge
  mcpSdkServer.tool(
    'generate_challenge',
    'Generate a new imrobot challenge for an AI agent to solve. Returns the challenge object with pipeline operations to execute.',
    {
      type: 'object',
      properties: {
        difficulty: {
          type: 'string',
          enum: ['easy', 'medium', 'hard'],
          description: 'Challenge difficulty level. Default: medium',
        },
        ttl: {
          type: 'number',
          description: 'Challenge time-to-live in milliseconds. Default: 300000 (5 minutes)',
        },
      },
    },
    async (args) => {
      try {
        const difficulty = (args.difficulty as Difficulty) ?? defaultDifficulty
        const ttl = (args.ttl as number) ?? 300_000

        const challenge = generateChallenge({ difficulty, ttl })

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              challenge,
              hint: 'Execute the pipeline operations in order. Use the solveChallenge() function from imrobot/core if available, or implement the pipeline manually.',
            }, null, 2),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error generating challenge: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  // Tool: verify_answer
  mcpSdkServer.tool(
    'verify_answer',
    'Verify an agent's answer to an imrobot challenge. Returns whether the answer is correct and a signed proof token if valid.',
    {
      type: 'object',
      required: ['challengeJson', 'answer'],
      properties: {
        challengeJson: {
          type: 'string',
          description: 'The full challenge object as a JSON string (as returned by generate_challenge)',
        },
        answer: {
          type: 'string',
          description: 'The agent's computed answer to the challenge pipeline',
        },
      },
    },
    async (args) => {
      try {
        const challenge = JSON.parse(args.challengeJson as string)
        const answer = args.answer as string

        const result = verifyAnswer(challenge, answer)

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: result.valid,
              valid: result.valid,
              reason: result.reason ?? null,
              token: result.valid ? result.token : null,
            }, null, 2),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error verifying answer: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  // Tool: get_discovery_document
  mcpSdkServer.tool(
    'get_discovery_document',
    'Get the imrobot .well-known discovery document describing available endpoints, supported versions, and agent capabilities.',
    {
      type: 'object',
      properties: {
        baseUrl: {
          type: 'string',
          description: 'Base URL of the service exposing imrobot endpoints',
        },
      },
    },
    async (args) => {
      try {
        const url = (args.baseUrl as string) ?? baseUrl
        const doc = buildDiscoveryDocument(url)

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(doc, null, 2),
          }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error building discovery document: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        }
      }
    }
  )

  return mcpSdkServer
}

/**
 * Factory function that creates and configures an imrobot MCP server.
 *
 * Requires @modelcontextprotocol/sdk to be installed separately.
 * Dynamically imports the SDK to avoid a hard bundled dependency.
 *
 * @param config - imrobot MCP configuration
 * @returns A promise resolving to the configured MCP server
 */
export async function createMcpServer(config?: ImRobotMcpConfig): Promise<McpServer> {
  // Dynamic import keeps @modelcontextprotocol/sdk as a true peer dep
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js' as string)

  const server = new Server(
    {
      name: 'imrobot',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  ) as unknown as McpServer

  return configureMcpServer(server, config)
}
