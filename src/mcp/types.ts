/**
 * MCP (Model Context Protocol) type definitions for imrobot tools.
 *
 * MCP is JSON-RPC 2.0 — these types model the protocol messages used by
 * createMCPServer() without requiring the @modelcontextprotocol/sdk package.
 */

/** JSON-RPC 2.0 request */
export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number | null
  method: string
  params?: Record<string, unknown>
}

/** JSON-RPC 2.0 success response */
export interface JsonRpcSuccess<T = unknown> {
  jsonrpc: '2.0'
  id: string | number | null
  result: T
}

/** JSON-RPC 2.0 error response */
export interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcResponse<T = unknown> = JsonRpcSuccess<T> | JsonRpcError

/** Standard JSON-RPC error codes */
export const RpcCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const

/** MCP tool parameter schema (JSON Schema subset) */
export interface MCPToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description: string
  enum?: string[]
  default?: unknown
}

/** MCP tool definition */
export interface MCPTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, MCPToolParameter>
    required?: string[]
  }
}

/** MCP tools/list response */
export interface MCPToolsListResult {
  tools: MCPTool[]
}

/** MCP tools/call response */
export interface MCPToolCallResult {
  content: Array<{
    type: 'text'
    text: string
  }>
  isError?: boolean
}

/** MCP initialize result */
export interface MCPInitializeResult {
  protocolVersion: string
  capabilities: {
    tools: Record<string, never>
  }
  serverInfo: {
    name: string
    version: string
  }
}
