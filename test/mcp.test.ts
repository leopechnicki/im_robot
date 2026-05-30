import { describe, it, expect, vi } from 'vitest'
import { configureMcpServer } from '../src/mcp/index'
import type { McpServer, McpToolResult } from '../src/mcp/index'

/**
 * Create a mock MCP server that captures registered tools.
 */
function createMockMcpServer() {
  const tools = new Map<string, (args: Record<string, unknown>) => Promise<McpToolResult>>()

  const server: McpServer = {
    tool(name, _description, _schema, handler) {
      tools.set(name, handler)
    },
    async connect(_transport) {},
    async close() {},
  }

  return { server, tools }
}

describe('configureMcpServer', () => {
  it('registers generate_challenge, verify_answer, and get_discovery_document tools', () => {
    const { server, tools } = createMockMcpServer()
    configureMcpServer(server)

    expect(tools.has('generate_challenge')).toBe(true)
    expect(tools.has('verify_answer')).toBe(true)
    expect(tools.has('get_discovery_document')).toBe(true)
  })

  describe('generate_challenge tool', () => {
    it('generates a challenge with default difficulty', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server)

      const result = await tools.get('generate_challenge')!({})
      expect(result.isError).toBeFalsy()
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.success).toBe(true)
      expect(parsed.challenge).toBeDefined()
      expect(parsed.challenge.pipeline).toBeDefined()
    })

    it('generates a challenge with specified difficulty', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server)

      const result = await tools.get('generate_challenge')!({ difficulty: 'easy' })
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.success).toBe(true)
      expect(parsed.challenge.difficulty).toBe('easy')
    })

    it('uses configured default difficulty', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server, { defaultDifficulty: 'hard' })

      const result = await tools.get('generate_challenge')!({})
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed.challenge.difficulty).toBe('hard')
    })
  })

  describe('verify_answer tool', () => {
    it('returns isError on invalid JSON input', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server)

      const result = await tools.get('verify_answer')!({
        challengeJson: 'not-valid-json',
        answer: '42',
      })
      expect(result.isError).toBe(true)
    })

    it('verifies a correct answer successfully', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server)

      // Generate a challenge first
      const genResult = await tools.get('generate_challenge')!({ difficulty: 'easy' })
      const { challenge } = JSON.parse(genResult.content[0].text)

      // Solve it using the solver
      const { solveChallenge } = await import('../src/core/solver')
      const answer = solveChallenge(challenge)

      const verifyResult = await tools.get('verify_answer')!({
        challengeJson: JSON.stringify(challenge),
        answer,
      })
      const parsed = JSON.parse(verifyResult.content[0].text)
      expect(parsed.valid).toBe(true)
    })

    it('returns invalid for wrong answer', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server)

      const genResult = await tools.get('generate_challenge')!({ difficulty: 'easy' })
      const { challenge } = JSON.parse(genResult.content[0].text)

      const verifyResult = await tools.get('verify_answer')!({
        challengeJson: JSON.stringify(challenge),
        answer: 'wrong-answer-12345',
      })
      const parsed = JSON.parse(verifyResult.content[0].text)
      expect(parsed.valid).toBe(false)
    })
  })

  describe('get_discovery_document tool', () => {
    it('returns a discovery document', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server, { baseUrl: 'https://test.example.com' })

      const result = await tools.get('get_discovery_document')!({})
      expect(result.isError).toBeFalsy()
      const doc = JSON.parse(result.content[0].text)
      expect(doc).toBeDefined()
      // Discovery document should have standard fields
      expect(typeof doc).toBe('object')
    })

    it('uses provided baseUrl override', async () => {
      const { server, tools } = createMockMcpServer()
      configureMcpServer(server)

      const result = await tools.get('get_discovery_document')!({
        baseUrl: 'https://custom.example.com',
      })
      expect(result.isError).toBeFalsy()
    })
  })
})
