import { describe, it, expect, beforeEach } from 'vitest'
import { createMCPServer, IMRobotMCPServer } from '../src/mcp/server'
import { TOOL_DEFINITIONS } from '../src/mcp/tools'
import { solveChallenge } from '../src/core/solver'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callMethod(
  server: IMRobotMCPServer,
  method: string,
  params?: Record<string, unknown>,
  id: number = 1,
) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params })
  const raw = await server.handleMessage(msg)
  return JSON.parse(raw) as { result?: unknown; error?: { code: number; message: string } }
}

async function callTool(
  server: IMRobotMCPServer,
  name: string,
  args: Record<string, unknown> = {},
) {
  const response = await callMethod(server, 'tools/call', { name, arguments: args })
  if (response.error) throw new Error(`RPC error: ${response.error.message}`)

  const result = response.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
  const isError = result.isError ?? false
  const text = result.content[0]?.text ?? ''

  if (isError) {
    // Error content is plain text, not JSON
    return { parsed: {} as Record<string, unknown>, isError: true, errorText: text }
  }

  return { parsed: JSON.parse(text) as Record<string, unknown>, isError: false, errorText: '' }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMCPServer', () => {
  it('returns an IMRobotMCPServer instance', () => {
    const server = createMCPServer()
    expect(server).toBeInstanceOf(IMRobotMCPServer)
  })

  it('accepts optional config', () => {
    const server = createMCPServer({ defaultDifficulty: 'easy' })
    expect(server).toBeInstanceOf(IMRobotMCPServer)
  })
})

describe('IMRobotMCPServer', () => {
  let server: IMRobotMCPServer

  describe('initialize', () => {
    beforeEach(() => {
      server = createMCPServer()
    })

    it('returns protocolVersion, capabilities, and serverInfo', async () => {
      const response = await callMethod(server, 'initialize')
      const result = response.result as {
        protocolVersion: string
        capabilities: unknown
        serverInfo: { name: string; version: string }
      }

      expect(result.protocolVersion).toBe('2024-11-05')
      expect(result.capabilities).toMatchObject({ tools: {} })
      expect(result.serverInfo.name).toBe('imrobot-mcp')
      expect(result.serverInfo.version).toBeDefined()
    })
  })

  describe('tools/list', () => {
    beforeEach(() => {
      server = createMCPServer()
    })

    it('returns all registered tools', async () => {
      const response = await callMethod(server, 'tools/list')
      const result = response.result as { tools: Array<{ name: string }> }

      expect(result.tools).toBeInstanceOf(Array)
      expect(result.tools.length).toBe(5)

      const names = result.tools.map((t) => t.name)
      expect(names).toContain('generate-challenge')
      expect(names).toContain('solve-challenge')
      expect(names).toContain('verify-answer')
      expect(names).toContain('create-token')
      expect(names).toContain('get-discovery-document')
    })

    it('tool definitions have required schema fields', async () => {
      const response = await callMethod(server, 'tools/list')
      const result = response.result as { tools: Array<{ name: string; description: string; inputSchema: unknown }> }

      for (const tool of result.tools) {
        expect(tool.name).toBeTruthy()
        expect(tool.description).toBeTruthy()
        expect(tool.inputSchema).toBeDefined()
      }
    })
  })

  describe('ping', () => {
    it('returns empty object', async () => {
      server = createMCPServer()
      const response = await callMethod(server, 'ping')
      expect(response.result).toEqual({})
    })
  })

  describe('unknown method', () => {
    it('returns MethodNotFound error', async () => {
      server = createMCPServer()
      const response = await callMethod(server, 'nonexistent/method')
      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe(-32601)
    })
  })

  describe('parse error', () => {
    it('returns ParseError for invalid JSON', async () => {
      server = createMCPServer()
      const raw = await server.handleMessage('not valid json {')
      const response = JSON.parse(raw) as { error: { code: number } }
      expect(response.error.code).toBe(-32700)
    })
  })

  describe('notifications', () => {
    it('returns empty string for notifications/initialized (no id)', async () => {
      server = createMCPServer()
      const msg = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
      const response = await server.handleMessage(msg)
      expect(response).toBe('')
    })
  })

  // -------------------------------------------------------------------------
  // Tool: generate-challenge
  // -------------------------------------------------------------------------

  describe('tool: generate-challenge', () => {
    beforeEach(() => {
      server = createMCPServer()
    })

    it('generates a valid challenge with default difficulty', async () => {
      const { parsed } = await callTool(server, 'generate-challenge')
      const challenge = (parsed as { challenge: Record<string, unknown> }).challenge

      expect(challenge.id).toBeTruthy()
      expect(challenge.seed).toBeTruthy()
      expect(challenge.pipeline).toBeInstanceOf(Array)
      expect(challenge.difficulty).toBe('medium')
      expect(typeof challenge.timestamp).toBe('number')
      expect(typeof challenge.ttl).toBe('number')
    })

    it('respects the difficulty parameter', async () => {
      const { parsed } = await callTool(server, 'generate-challenge', { difficulty: 'easy' })
      const challenge = (parsed as { challenge: Record<string, unknown> }).challenge
      expect(challenge.difficulty).toBe('easy')
    })

    it('uses config defaultDifficulty when no difficulty is passed', async () => {
      const easyServer = createMCPServer({ defaultDifficulty: 'hard' })
      const { parsed } = await callTool(easyServer, 'generate-challenge')
      const challenge = (parsed as { challenge: Record<string, unknown> }).challenge
      expect(challenge.difficulty).toBe('hard')
    })

    it('returns isError: true for invalid difficulty', async () => {
      const { isError } = await callTool(server, 'generate-challenge', { difficulty: 'extreme' })
      expect(isError).toBe(true)
    })

    it('includes solving instructions', async () => {
      const { parsed } = await callTool(server, 'generate-challenge')
      expect(typeof (parsed as { instructions: string }).instructions).toBe('string')
    })
  })

  // -------------------------------------------------------------------------
  // Tool: solve-challenge (integration)
  // -------------------------------------------------------------------------

  describe('tool: solve-challenge', () => {
    beforeEach(() => {
      server = createMCPServer()
    })

    it('solves a generated challenge and returns valid answer + token', async () => {
      // First generate a challenge via the tool
      const { parsed: genResult } = await callTool(server, 'generate-challenge', { difficulty: 'easy' })
      const challenge = (genResult as { challenge: Record<string, unknown> }).challenge

      // Then solve it
      const { parsed: solveResult } = await callTool(server, 'solve-challenge', { challenge })
      const result = solveResult as { answer: string; valid: boolean; token: Record<string, unknown> }

      expect(result.answer).toBeTruthy()
      expect(result.valid).toBe(true)
      expect(result.token.challengeId).toBe(challenge.id)
    })

    it('returns isError: true for invalid challenge format', async () => {
      const { isError } = await callTool(server, 'solve-challenge', {
        challenge: { invalid: 'data' },
      })
      expect(isError).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Tool: verify-answer
  // -------------------------------------------------------------------------

  describe('tool: verify-answer', () => {
    beforeEach(() => {
      server = createMCPServer()
    })

    it('returns valid: true for correct answer', async () => {
      const { parsed: genResult } = await callTool(server, 'generate-challenge', { difficulty: 'easy' })
      const challenge = (genResult as { challenge: Record<string, unknown> }).challenge

      // Use the core solver to get the correct answer
      const answer = solveChallenge(challenge as Parameters<typeof solveChallenge>[0])

      const { parsed } = await callTool(server, 'verify-answer', { challenge, answer })
      expect((parsed as { valid: boolean }).valid).toBe(true)
    })

    it('returns valid: false for wrong answer', async () => {
      const { parsed: genResult } = await callTool(server, 'generate-challenge', { difficulty: 'easy' })
      const challenge = (genResult as { challenge: Record<string, unknown> }).challenge

      const { parsed } = await callTool(server, 'verify-answer', {
        challenge,
        answer: 'definitely-wrong-answer-xyz',
      })
      expect((parsed as { valid: boolean }).valid).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Tool: create-token
  // -------------------------------------------------------------------------

  describe('tool: create-token', () => {
    beforeEach(() => {
      server = createMCPServer()
    })

    it('creates a token with required fields', async () => {
      const { parsed: genResult } = await callTool(server, 'generate-challenge', { difficulty: 'easy' })
      const challenge = (genResult as { challenge: Record<string, unknown> }).challenge
      const answer = solveChallenge(challenge as Parameters<typeof solveChallenge>[0])

      const { parsed } = await callTool(server, 'create-token', {
        challenge,
        answer,
        startTime: Date.now() - 100,
      })

      const result = parsed as { token: Record<string, unknown>; note: string }
      expect(result.token.challengeId).toBe(challenge.id)
      expect(result.token.answer).toBe(answer)
      expect(typeof result.token.elapsed).toBe('number')
      expect(typeof result.token.suspicious).toBe('boolean')
      expect(typeof result.note).toBe('string')
    })
  })

  // -------------------------------------------------------------------------
  // Tool: get-discovery-document
  // -------------------------------------------------------------------------

  describe('tool: get-discovery-document', () => {
    beforeEach(() => {
      server = createMCPServer({
        discovery: { name: 'Test Service', challengePath: '/api/robot' },
      })
    })

    it('returns a valid discovery document', async () => {
      const { parsed } = await callTool(server, 'get-discovery-document')
      const doc = (parsed as { document: Record<string, unknown> }).document

      expect(doc.protocol).toBe('imrobot')
      expect(doc.version).toBeTruthy()
      expect(doc.endpoints).toBeDefined()
      expect(doc.difficulties).toBeInstanceOf(Array)
    })

    it('uses config discovery settings', async () => {
      const { parsed } = await callTool(server, 'get-discovery-document')
      const doc = (parsed as { document: Record<string, unknown> }).document
      expect(doc.name).toBe('Test Service')
    })

    it('allows overriding challengePath via args', async () => {
      const { parsed } = await callTool(server, 'get-discovery-document', {
        challengePath: '/custom/path',
      })
      const doc = (parsed as { document: { endpoints: { challenge: string } } }).document
      expect(doc.endpoints.challenge).toBe('/custom/path/challenge')
    })
  })
})

// ---------------------------------------------------------------------------
// TOOL_DEFINITIONS sanity check
// ---------------------------------------------------------------------------

describe('TOOL_DEFINITIONS', () => {
  it('exports an array of tool definitions', () => {
    expect(TOOL_DEFINITIONS).toBeInstanceOf(Array)
    expect(TOOL_DEFINITIONS.length).toBeGreaterThan(0)
  })

  it('all tools have name, description, and inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(typeof tool.name).toBe('string')
      expect(typeof tool.description).toBe('string')
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.inputSchema.properties).toBeDefined()
    }
  })
})
