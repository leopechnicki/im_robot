/**
 * Pass an imrobot gate from code, no model involved.
 *
 *   npx tsx examples/demo-site.ts &
 *   npx tsx examples/pass-gate.ts http://127.0.0.1:8787 --allow-private-hosts
 *
 * Prints the proof token, then calls the protected endpoint with it.
 */
import { passGate, GateError } from 'imrobot/agent'

const url = process.argv[2]
if (!url) {
  console.error('usage: pass-gate.ts <site-url> [--allow-private-hosts]')
  process.exit(2)
}

try {
  const gate = await passGate(url, {
    agentId: 'pass-gate-example',
    // Off by default: lets a local demo site through the private-host guard.
    allowPrivateHosts: process.argv.includes('--allow-private-hosts'),
  })
  console.log(`passed (${gate.source}, ${gate.difficulty}, ${gate.elapsed} ms)`)
  const res = await fetch(new URL('/api/secret', url), {
    headers: { [gate.proofHeader]: gate.proofToken },
  })
  console.log(res.status, await res.text())
} catch (err) {
  if (err instanceof GateError) {
    console.error(`gate failed: ${err.code}: ${err.message}`)
    process.exit(1)
  }
  throw err
}
