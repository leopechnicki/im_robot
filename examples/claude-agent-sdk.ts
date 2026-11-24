/**
 * Claude Agent SDK: give Claude the imrobot tools so it can pass imrobot gates.
 *
 *   npm i @anthropic-ai/claude-agent-sdk zod imrobot
 *   npx tsx examples/demo-site.ts &
 *   npx tsx examples/claude-agent-sdk.ts http://127.0.0.1:8787 --allow-private-hosts
 *
 * Two ways to wire it; both end up as MCP tools for the agent:
 *
 *  A. In-process (default): wrap imrobotTools() with the SDK's tool() +
 *     createSdkMcpServer(). No extra process.
 *  B. Out-of-process: run the imrobot MCP server over stdio
 *     (`npx -y imrobot mcp`). Pass --stdio to try it. The same server works in
 *     Claude Code, Claude Desktop or any MCP client.
 */
import { createSdkMcpServer, query, tool, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { imrobotTools, PASS_GATE_TOOL_NAME, SOLVE_TOOL_NAME } from 'imrobot/agent'

const site = process.argv[2] ?? 'http://127.0.0.1:8787'
const allowPrivateHosts = process.argv.includes('--allow-private-hosts')
const useStdio = process.argv.includes('--stdio')

function inProcessServer(): McpServerConfig {
  const [passGate, solve] = imrobotTools({ agentId: 'claude-agent-sdk-example', allowPrivateHosts })
  const asResult = (text: string) => ({
    content: [{ type: 'text' as const, text }],
    isError: text.startsWith('{"error"'),
  })
  return createSdkMcpServer({
    name: 'imrobot',
    tools: [
      tool(passGate.name, passGate.description, { url: z.string() }, async (args) =>
        asResult(await passGate.execute(args)),
      ),
      tool(
        solve.name,
        solve.description,
        { challenge: z.union([z.record(z.string(), z.unknown()), z.string()]) },
        async (args) => asResult(await solve.execute(args)),
      ),
    ],
  })
}

function stdioServer(): McpServerConfig {
  return {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'imrobot', 'mcp', ...(allowPrivateHosts ? ['--allow-private-hosts'] : [])],
  }
}

// MCP tools are named mcp__<server>__<tool>. The stdio server's gate tool is "pass-gate".
const allowedTools = useStdio
  ? ['mcp__imrobot__pass-gate', 'mcp__imrobot__solve-challenge']
  : [`mcp__imrobot__${PASS_GATE_TOOL_NAME}`, `mcp__imrobot__${SOLVE_TOOL_NAME}`]

for await (const message of query({
  prompt:
    `The site ${site} is protected by imrobot. Pass its gate with the imrobot tool, ` +
    'then tell me which header and token to send (first 16 characters of the token only).',
  options: {
    mcpServers: { imrobot: useStdio ? stdioServer() : inProcessServer() },
    allowedTools,
    // Only the imrobot tools: no shell, no file access for this agent.
    tools: [],
    maxTurns: 4,
  },
})) {
  if (message.type === 'result') {
    console.log(message.subtype === 'success' ? message.result : `agent stopped: ${message.subtype}`)
  }
}
