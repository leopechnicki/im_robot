/**
 * imrobot MCP (Model Context Protocol) server.
 *
 * Creates a lightweight MCP server that lets AI agents auto-discover and
 * complete imrobot verification challenges without any custom integration.
 *
 * The server communicates over stdio using JSON-RPC 2.0 (the MCP transport
 * protocol). No external SDK is required — imrobot implements the protocol
 * directly to maintain its zero-runtime-dependency guarantee.
 *
 * @example Start the MCP server from a CLI script:
 * ```typescript
 * import { createMCPServer } from 'imrobot/mcp'
 *
 * const server = createMCPServer({ defaultDifficulty: 'medium' })
 * server.start() // reads from stdin, writes to stdout
 * ```
 *
 * @example Use tools programmatically (no stdio):
 * ```typescript
 * import { createMCPServer } from 'imrobot/mcp'
 *
 * const server = createMCPServer()
 * const response = await server.handleMessage(JSON.stringify({
 *   jsonrpc: '2.0', id: 1, method: 'tools/call',
 *   params: { name: 'generate-challenge', arguments: { difficulty: 'easy' } }
 * }))
 * const parsed = JSON.parse(response)
 * ```
 *
 * @module
 */

import {
  RpcCode,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MCPInitializeResult,
  type MCPToolsListResult,
  type MCPToolCallResult,
} from './types'

import {
  TOOL_DEFINITIONS,
  toolGenerateChallenge,
  toolSolveChallenge,
  toolVerifyAnswer,
  toolCreateToken,
  toolGetDiscoveryDocument,
  type MCPServerConfig,
} from './tools'

export type { MCPServerConfig }

const MCP_PROTOCOL_VERSION = '2024-11-05'
const SERVER_NAME = 'imrobot-mcp'
const SERVER_VERSION = '1.0.0'

function ok<T>(id: string | number | null, result: T): JsonRpcResponse<T> {
  return { jsonrpc: '2.0', id, result }
}

function err(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function textContent(text: string): MCPToolCallResult {
  return { content: [{ type: 'text', text }] }
}

function errorContent(message: string): MCPToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * imrobot MCP server instance.
 *
 * Handles JSON-RPC messages and dispatches to the appropriate imrobot tool.
 * Can be used programmatically via handleMessage() or started as a stdio server via start().
 */
export class IMRobotMCPServer {
  private readonly config: MCPServerConfig

  constructor(config: MCPServerConfig = {}) {
    this.config = config
  }

  /**
   * Process a single JSON-RPC message and return the response as a JSON string.
   *
   * Handles all standard MCP lifecycle methods (initialize, initialized,
   * tools/list, tools/call) plus the imrobot-specific tool implementations.
   *
   * @param message - Raw JSON-RPC message string
   * @returns JSON-encoded response string, or empty string for notifications
   */
  async handleMessage(message: string): Promise<string> {
    let request: JsonRpcRequest

    try {
      request = JSON.parse(message) as JsonRpcRequest
    } catch {
      return JSON.stringify(err(null, RpcCode.ParseError, 'Parse error'))
    }

    if (!request.method || typeof request.method !== 'string') {
      return JSON.stringify(err(request.id ?? null, RpcCode.InvalidRequest, 'Invalid request'))
    }

    // Notifications (no id) — acknowledge but don't respond
    if (request.id === undefined || request.id === null) {
      if (request.method === 'notifications/initialized') return ''
      // Other notifications are silently ignored per MCP spec
      return ''
    }

    const id = request.id

    try {
      const response = await this.dispatch(id, request.method, request.params ?? {})
      return JSON.stringify(response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return JSON.stringify(err(id, RpcCode.InternalError, message))
    }
  }

  private async dispatch(
    id: string | number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse> {
    switch (method) {
      case 'initialize':
        return this.handleInitialize(id)

      case 'tools/list':
        return this.handleToolsList(id)

      case 'tools/call':
        return this.handleToolsCall(id, params)

      case 'ping':
        return ok(id, {})

      default:
        return err(id, RpcCode.MethodNotFound, `Method not found: ${method}`)
    }
  }

  private handleInitialize(id: string | number): JsonRpcResponse<MCPInitializeResult> {
    return ok<MCPInitializeResult>(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    })
  }

  private handleToolsList(id: string | number): JsonRpcResponse<MCPToolsListResult> {
    return ok<MCPToolsListResult>(id, { tools: TOOL_DEFINITIONS })
  }

  private handleToolsCall(
    id: string | number,
    params: Record<string, unknown>,
  ): JsonRpcResponse<MCPToolCallResult> {
    const name = params.name as string
    const args = (params.arguments ?? {}) as Record<string, unknown>

    if (!name || typeof name !== 'string') {
      return err(
        id,
        RpcCode.InvalidParams,
        'tools/call requires a "name" parameter',
      ) as JsonRpcResponse<MCPToolCallResult>
    }

    try {
      const result = this.callTool(name, args)
      return ok<MCPToolCallResult>(id, textContent(JSON.stringify(result, null, 2)))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return ok<MCPToolCallResult>(id, errorContent(message))
    }
  }

  private callTool(name: string, args: Record<string, unknown>): unknown {
    const a = args as unknown
    switch (name) {
      case 'generate-challenge':
        return toolGenerateChallenge(a as Parameters<typeof toolGenerateChallenge>[0], this.config)

      case 'solve-challenge':
        return toolSolveChallenge(a as Parameters<typeof toolSolveChallenge>[0])

      case 'verify-answer':
        return toolVerifyAnswer(a as Parameters<typeof toolVerifyAnswer>[0])

      case 'create-token':
        return toolCreateToken(a as Parameters<typeof toolCreateToken>[0])

      case 'get-discovery-document':
        return toolGetDiscoveryDocument(
          a as Parameters<typeof toolGetDiscoveryDocument>[0],
          this.config,
        )

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  /**
   * Start the MCP server reading from stdin and writing to stdout.
   *
   * Each newline-delimited JSON-RPC message on stdin produces a response on stdout.
   * This is the standard MCP stdio transport.
   *
   * @example In a CLI entry point:
   * ```typescript
   * createMCPServer().start()
   * ```
   */
  async start(): Promise<void> {
    const { createInterface } = await import('readline')

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    })

    rl.on('line', async (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return

      const response = await this.handleMessage(trimmed)
      if (response) {
        process.stdout.write(response + '\n')
      }
    })

    rl.on('close', () => {
      process.exit(0)
    })
  }
}

/**
 * Create an imrobot MCP server.
 *
 * @param config - Optional server configuration
 * @returns IMRobotMCPServer instance
 *
 * @example
 * ```typescript
 * import { createMCPServer } from 'imrobot/mcp'
 *
 * // Start a stdio MCP server
 * createMCPServer({ defaultDifficulty: 'easy' }).start()
 * ```
 */
export function createMCPServer(config?: MCPServerConfig): IMRobotMCPServer {
  return new IMRobotMCPServer(config)
}
