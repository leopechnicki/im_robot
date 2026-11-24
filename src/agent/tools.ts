/**
 * Framework-neutral tool definitions for agent frameworks.
 *
 * Each tool is `{ name, description, inputSchema, execute }`, with a plain JSON
 * Schema. That shape plugs into most frameworks with a one-line adapter (Claude
 * Agent SDK, Vercel AI SDK `jsonSchema()`, LangChain.js `tool()`, OpenAI
 * function tools). `execute` never throws: it returns a JSON string, with an
 * `error` field on failure, because that is what a model can read and act on.
 */

import { GateError, passGate, solveChallengeInput, type PassGateOptions } from './gate'

/** JSON Schema subset used by the tool inputs. */
export interface ToolInputSchema {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required?: string[]
  additionalProperties?: boolean
}

export interface ImRobotTool {
  name: string
  description: string
  inputSchema: ToolInputSchema
  /** Returns a JSON string. Never throws. */
  execute(input: Record<string, unknown>): Promise<string>
}

export const PASS_GATE_TOOL_NAME = 'imrobot_pass_gate'
export const SOLVE_TOOL_NAME = 'imrobot_solve_challenge'

export const PASS_GATE_DESCRIPTION =
  'Pass an imrobot reverse-CAPTCHA ("prove you are an AI agent") on a website. Give the site URL, ' +
  'a page on it, or its challenge endpoint. The tool finds the challenge (via ' +
  '/.well-known/imrobot.json), solves it in code and returns a proof token. Send that token in the ' +
  'returned header (usually X-Agent-Proof) on your next requests to the site.'

export const SOLVE_DESCRIPTION =
  'Solve an imrobot challenge object you already have (JSON with seed and pipeline). Returns the ' +
  'answer string to submit to the site. Use imrobot_pass_gate instead when you only have a URL.'

function errorJson(err: unknown): string {
  if (err instanceof GateError) {
    return JSON.stringify({
      error: err.code,
      message: err.message,
      ...(err.reason ? { reason: err.reason } : {}),
    })
  }
  return JSON.stringify({
    error: 'internal',
    message: err instanceof Error ? err.message : String(err),
  })
}

/**
 * The two imrobot agent tools: `imrobot_pass_gate` and `imrobot_solve_challenge`.
 *
 * @param options - passed to {@link passGate} (custom/signed fetch, agentId,
 *   timeout, `allowPrivateHosts` for local development).
 *
 * @example Claude Agent SDK (in-process MCP server)
 * ```ts
 * import { imrobotTools } from 'imrobot/agent'
 * // see examples/claude-agent-sdk.ts in the repository
 * ```
 */
export function imrobotTools(options: PassGateOptions = {}): ImRobotTool[] {
  return [
    {
      name: PASS_GATE_TOOL_NAME,
      description: PASS_GATE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Site URL, page URL or challenge endpoint (http or https).',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      async execute(input) {
        try {
          if (typeof input.url !== 'string') throw new GateError('invalid_url', 'url is required')
          const r = await passGate(input.url, options)
          return JSON.stringify({
            proofToken: r.proofToken,
            proofHeader: r.proofHeader,
            verifyUrl: r.verifyUrl,
            elapsed: r.elapsed,
            difficulty: r.difficulty,
          })
        } catch (err) {
          return errorJson(err)
        }
      },
    },
    {
      name: SOLVE_TOOL_NAME,
      description: SOLVE_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          challenge: {
            type: 'object',
            description: 'The challenge object as received (JSON text is accepted too).',
          },
        },
        required: ['challenge'],
        additionalProperties: false,
      },
      async execute(input) {
        try {
          return JSON.stringify({ answer: solveChallengeInput(input.challenge) })
        } catch (err) {
          return errorJson(err)
        }
      },
    },
  ]
}
