import { generateChallenge, verifyAnswer } from '../core/challenge'
import { solveChallenge } from '../core/solver'
import { formatPipeline } from '../core/operations'
import { createVerifier } from '../server/verifier'
import type { Difficulty } from '../core/types'
import { CLI_VERSION } from './version'

const HELP = `
imrobot — Reverse-CAPTCHA CLI for AI Agent Verification

Usage:
  npx imrobot <command> [options]

Commands:
  challenge   Generate a test challenge
  solve       Generate and immediately solve a challenge
  verify      Verify an answer against a challenge
  benchmark   Run a performance benchmark
  info        Show project information

Options:
  --difficulty <easy|medium|hard>   Difficulty level (default: medium)
  --count <n>                       Number of iterations for benchmark (default: 100)
  --secret <string>                 HMAC secret for server-mode verification
  --help                            Show this help message

Examples:
  npx imrobot challenge --difficulty hard
  npx imrobot solve --difficulty medium
  npx imrobot benchmark --count 1000
  npx imrobot verify --secret my-secret-at-least-16-chars
`

function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      parsed[args[i].slice(2)] = args[i + 1]
      i++
    } else if (args[i].startsWith('--')) {
      parsed[args[i].slice(2)] = 'true'
    } else if (!parsed._command) {
      parsed._command = args[i]
    }
  }
  return parsed
}

async function cmdChallenge(difficulty: Difficulty) {
  const challenge = generateChallenge({ difficulty })
  console.log('\n🤖 imrobot Challenge\n')
  console.log(`  ID:         ${challenge.id}`)
  console.log(`  Difficulty: ${challenge.difficulty}`)
  console.log(`  TTL:        ${challenge.ttl}ms`)
  console.log(`  Nonce:      ${challenge.nonce} (${challenge.nonce.length} chars, hidden)`)
  console.log()
  console.log(formatPipeline(challenge.visibleSeed + '...', challenge.pipeline))
  console.log()
  console.log(`  Full seed:      ${challenge.seed}`)
  console.log(`  Verification:   ${challenge.verification}`)
  console.log()
}

async function cmdSolve(difficulty: Difficulty) {
  const challenge = generateChallenge({ difficulty })
  const start = performance.now()
  const answer = solveChallenge(challenge)
  const elapsed = performance.now() - start
  const valid = verifyAnswer(challenge, answer)

  console.log('\n🤖 imrobot Solve\n')
  console.log(`  Difficulty: ${challenge.difficulty}`)
  console.log(`  Pipeline:   ${challenge.pipeline.length} operations`)
  console.log(`  Answer:     ${answer.length > 60 ? answer.slice(0, 60) + '...' : answer}`)
  console.log(`  Valid:      ${valid ? '✅ yes' : '❌ no'}`)
  console.log(`  Solve time: ${elapsed.toFixed(3)}ms`)
  console.log()
}

async function cmdVerify(difficulty: Difficulty, secret?: string) {
  if (secret) {
    // Server-mode verification with HMAC
    const verifier = createVerifier({ secret, difficulty })
    const challenge = await verifier.generate()
    const answer = solveChallenge(challenge)
    const result = await verifier.verify(challenge, answer)

    console.log('\n🤖 imrobot Server Verify (HMAC-SHA256)\n')
    console.log(`  HMAC:       ${challenge.hmac.slice(0, 16)}...`)
    console.log(`  Valid:      ${result.valid ? '✅ yes' : `❌ no (${result.reason})`}`)
    console.log(`  Elapsed:    ${result.elapsed}ms`)
    console.log(`  Suspicious: ${result.suspicious ? '⚠️ yes' : '✅ no'}`)
  } else {
    // Client-mode verification
    const challenge = generateChallenge({ difficulty })
    const answer = solveChallenge(challenge)
    const valid = verifyAnswer(challenge, answer)

    console.log('\n🤖 imrobot Client Verify\n')
    console.log(`  Valid:      ${valid ? '✅ yes' : '❌ no'}`)
  }
  console.log()
}

async function cmdBenchmark(difficulty: Difficulty, count: number) {
  console.log(`\n🤖 imrobot Benchmark (${count} iterations, difficulty: ${difficulty})\n`)

  const genTimes: number[] = []
  const solveTimes: number[] = []
  const verifyTimes: number[] = []

  for (let i = 0; i < count; i++) {
    const genStart = performance.now()
    const challenge = generateChallenge({ difficulty })
    genTimes.push(performance.now() - genStart)

    const solveStart = performance.now()
    const answer = solveChallenge(challenge)
    solveTimes.push(performance.now() - solveStart)

    const verifyStart = performance.now()
    verifyAnswer(challenge, answer)
    verifyTimes.push(performance.now() - verifyStart)
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
  const min = (arr: number[]) => Math.min(...arr)
  const max = (arr: number[]) => Math.max(...arr)
  const p99 = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length * 0.99)]
  }

  console.log('  Metric         Avg        Min        Max        P99')
  console.log('  ──────────── ────────── ────────── ────────── ──────────')
  console.log(
    `  Generate     ${avg(genTimes).toFixed(3).padStart(8)}ms ${min(genTimes).toFixed(3).padStart(8)}ms ${max(genTimes).toFixed(3).padStart(8)}ms ${p99(genTimes).toFixed(3).padStart(8)}ms`,
  )
  console.log(
    `  Solve        ${avg(solveTimes).toFixed(3).padStart(8)}ms ${min(solveTimes).toFixed(3).padStart(8)}ms ${max(solveTimes).toFixed(3).padStart(8)}ms ${p99(solveTimes).toFixed(3).padStart(8)}ms`,
  )
  console.log(
    `  Verify       ${avg(verifyTimes).toFixed(3).padStart(8)}ms ${min(verifyTimes).toFixed(3).padStart(8)}ms ${max(verifyTimes).toFixed(3).padStart(8)}ms ${p99(verifyTimes).toFixed(3).padStart(8)}ms`,
  )
  console.log(
    `  Total cycle  ${(avg(genTimes) + avg(solveTimes) + avg(verifyTimes)).toFixed(3).padStart(8)}ms`,
  )
  console.log()
  console.log(
    `  Throughput:  ~${Math.floor(1000 / (avg(genTimes) + avg(solveTimes) + avg(verifyTimes)))} verifications/sec/core`,
  )
  console.log()
}

async function cmdInfo() {
  console.log('\n🤖 imrobot — Reverse-CAPTCHA for AI Agents\n')
  console.log(`  Version:     ${CLI_VERSION}`)
  console.log('  License:     MIT')
  console.log('  Repository:  https://github.com/leopechnicki/im_robot')
  console.log('  npm:         https://www.npmjs.com/package/imrobot')
  console.log('  Homepage:    https://imrobot.vercel.app')
  console.log()
  console.log('  Operations:  23 types')
  console.log('  Frameworks:  React, Vue, Svelte, Web Components')
  console.log('  Security:    HMAC-SHA256, constant-time verify, nonce, screenshot shield')
  console.log(
    '  New in 0.5:  Discovery endpoint, rate limiting, natural-language challenges, combined router handler',
  )
  console.log()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const command = args._command ?? 'help'
  const difficulty = (args.difficulty ?? 'medium') as Difficulty
  const count = parseInt(args.count ?? '100', 10)

  if (args.help === 'true' || command === 'help') {
    console.log(HELP)
    return
  }

  switch (command) {
    case 'challenge':
      return cmdChallenge(difficulty)
    case 'solve':
      return cmdSolve(difficulty)
    case 'verify':
      return cmdVerify(difficulty, args.secret)
    case 'benchmark':
      return cmdBenchmark(difficulty, count)
    case 'info':
      return cmdInfo()
    default:
      console.error(`Unknown command: ${command}`)
      console.log(HELP)
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
