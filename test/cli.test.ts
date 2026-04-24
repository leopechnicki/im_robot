import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateChallenge, verifyAnswer } from '../src/core/challenge'
import { solveChallenge } from '../src/core/solver'
import { formatPipeline } from '../src/core/operations'
import { createVerifier } from '../src/server/verifier'
import { CLI_VERSION } from '../src/cli/version'
import { parseDifficulty, parseCount } from '../src/cli/index'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Version sync
// ---------------------------------------------------------------------------

describe('CLI version', () => {
  it('should match package.json version', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'))
    expect(CLI_VERSION).toBe(pkg.version)
  })
})

// ---------------------------------------------------------------------------
// parseArgs (extracted logic — test via behaviour)
// ---------------------------------------------------------------------------

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

describe('parseArgs', () => {
  it('should parse a command', () => {
    const result = parseArgs(['challenge'])
    expect(result._command).toBe('challenge')
  })

  it('should parse --difficulty flag with value', () => {
    const result = parseArgs(['solve', '--difficulty', 'hard'])
    expect(result._command).toBe('solve')
    expect(result.difficulty).toBe('hard')
  })

  it('should parse boolean flags', () => {
    const result = parseArgs(['--help'])
    expect(result.help).toBe('true')
  })

  it('should parse --count flag', () => {
    const result = parseArgs(['benchmark', '--count', '500'])
    expect(result._command).toBe('benchmark')
    expect(result.count).toBe('500')
  })

  it('should parse --secret flag', () => {
    const result = parseArgs(['verify', '--secret', 'my-secret-at-least-16'])
    expect(result._command).toBe('verify')
    expect(result.secret).toBe('my-secret-at-least-16')
  })

  it('should handle multiple flags', () => {
    const result = parseArgs(['benchmark', '--difficulty', 'easy', '--count', '10'])
    expect(result._command).toBe('benchmark')
    expect(result.difficulty).toBe('easy')
    expect(result.count).toBe('10')
  })

  it('should handle no arguments', () => {
    const result = parseArgs([])
    expect(result._command).toBeUndefined()
  })

  it('should ignore extra positional args after the first', () => {
    const result = parseArgs(['solve', 'extra'])
    expect(result._command).toBe('solve')
  })
})

// ---------------------------------------------------------------------------
// CLI command logic (unit-level — we test the underlying functions)
// ---------------------------------------------------------------------------

describe('CLI challenge command logic', () => {
  it('should generate a challenge for each difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const challenge = generateChallenge({ difficulty })
      expect(challenge.difficulty).toBe(difficulty)
      expect(challenge.id).toHaveLength(16)
      expect(challenge.seed).toBeTruthy()
      expect(challenge.pipeline.length).toBeGreaterThan(0)
      expect(challenge.verification).toBeTruthy()
    }
  })

  it('should format pipeline output', () => {
    const challenge = generateChallenge({ difficulty: 'medium' })
    const output = formatPipeline(challenge.visibleSeed + '...', challenge.pipeline)
    expect(output).toContain('seed:')
    expect(output).toContain('1.')
  })
})

describe('CLI solve command logic', () => {
  it('should solve and verify for each difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const challenge = generateChallenge({ difficulty })
      const answer = solveChallenge(challenge)
      expect(answer).toBeTruthy()
      expect(verifyAnswer(challenge, answer)).toBe(true)
    }
  })

  it('should produce a non-empty answer', () => {
    const challenge = generateChallenge({ difficulty: 'medium' })
    const answer = solveChallenge(challenge)
    expect(answer.length).toBeGreaterThan(0)
  })
})

describe('CLI verify command logic', () => {
  it('should verify client-side correctly', () => {
    const challenge = generateChallenge({ difficulty: 'medium' })
    const answer = solveChallenge(challenge)
    expect(verifyAnswer(challenge, answer)).toBe(true)
  })

  it('should reject wrong answers', () => {
    const challenge = generateChallenge({ difficulty: 'medium' })
    expect(verifyAnswer(challenge, 'definitely-wrong')).toBe(false)
  })

  it('should verify server-side with HMAC', async () => {
    const secret = 'test-secret-at-least-sixteen-chars'
    const verifier = createVerifier({ secret, difficulty: 'medium' })
    const challenge = await verifier.generate()
    const answer = solveChallenge(challenge)
    const result = await verifier.verify(challenge, answer)
    expect(result.valid).toBe(true)
  })

  it('should reject server-side with wrong answer', async () => {
    const secret = 'test-secret-at-least-sixteen-chars'
    const verifier = createVerifier({ secret, difficulty: 'easy' })
    const challenge = await verifier.generate()
    const result = await verifier.verify(challenge, 'wrong-answer')
    expect(result.valid).toBe(false)
  })
})

describe('CLI benchmark command logic', () => {
  it('should run generate-solve-verify cycle without errors', () => {
    const iterations = 10
    for (let i = 0; i < iterations; i++) {
      const challenge = generateChallenge({ difficulty: 'medium' })
      const answer = solveChallenge(challenge)
      const valid = verifyAnswer(challenge, answer)
      expect(valid).toBe(true)
    }
  })

  it('should produce measurable timing', () => {
    const start = performance.now()
    const challenge = generateChallenge({ difficulty: 'hard' })
    solveChallenge(challenge)
    const elapsed = performance.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(0)
    // Should be fast — under 500ms even for hard
    expect(elapsed).toBeLessThan(500)
  })
})

describe('CLI info command logic', () => {
  it('should have a valid CLI_VERSION format', () => {
    expect(CLI_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

// ---------------------------------------------------------------------------
// CLI input validation (parseDifficulty / parseCount)
// ---------------------------------------------------------------------------

describe('parseDifficulty', () => {
  it('accepts easy, medium, and hard', () => {
    expect(parseDifficulty('easy')).toBe('easy')
    expect(parseDifficulty('medium')).toBe('medium')
    expect(parseDifficulty('hard')).toBe('hard')
  })

  it('defaults to medium when called with undefined', () => {
    expect(parseDifficulty(undefined)).toBe('medium')
  })

  it('throws a descriptive error for an unknown difficulty', () => {
    expect(() => parseDifficulty('impossible')).toThrow(/invalid difficulty/i)
    expect(() => parseDifficulty('impossible')).toThrow('impossible')
  })

  it('throws for empty string', () => {
    expect(() => parseDifficulty('')).toThrow(/invalid difficulty/i)
  })
})

describe('parseCount', () => {
  it('parses a valid positive integer string', () => {
    expect(parseCount('100')).toBe(100)
    expect(parseCount('1')).toBe(1)
    expect(parseCount('9999')).toBe(9999)
  })

  it('defaults to 100 when called with undefined', () => {
    expect(parseCount(undefined)).toBe(100)
  })

  it('throws a descriptive error for non-numeric input', () => {
    expect(() => parseCount('abc')).toThrow(/invalid count/i)
  })

  it('throws for zero', () => {
    expect(() => parseCount('0')).toThrow(/invalid count/i)
  })

  it('throws for negative values', () => {
    expect(() => parseCount('-5')).toThrow(/invalid count/i)
  })

  it('throws for numeric input with trailing garbage', () => {
    expect(() => parseCount('10abc')).toThrow(/invalid count/i)
  })

  it('throws for non-integer values', () => {
    expect(() => parseCount('1.5')).toThrow(/invalid count/i)
  })
})
