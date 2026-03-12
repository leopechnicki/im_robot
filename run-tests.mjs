/**
 * Lightweight test runner using Node 22's native TypeScript support.
 * Replaces vitest when native binaries (rollup) are unavailable.
 *
 * We intercept 'vitest' imports via the loader to provide our own shims.
 */

let totalPass = 0
let totalFail = 0
const failures = []
let currentSuite = ''
const pendingTests = []

function expect(actual) {
  const matchers = {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    },
    not: {
      toBe(expected) {
        if (actual === expected) throw new Error(`Expected value to differ from ${JSON.stringify(expected)}`)
      },
    },
    toMatch(re) {
      if (!re.test(String(actual))) throw new Error(`Expected "${actual}" to match ${re}`)
    },
    toContain(sub) {
      if (!String(actual).includes(sub)) throw new Error(`Expected "${actual}" to contain "${sub}"`)
    },
    toBeGreaterThan(n) {
      if (actual <= n) throw new Error(`Expected ${actual} > ${n}`)
    },
    toBeGreaterThanOrEqual(n) {
      if (actual < n) throw new Error(`Expected ${actual} >= ${n}`)
    },
    toBeLessThanOrEqual(n) {
      if (actual > n) throw new Error(`Expected ${actual} <= ${n}`)
    },
    toBeUndefined() {
      if (actual !== undefined) throw new Error(`Expected undefined, got ${JSON.stringify(actual)}`)
    },
    toBeInstanceOf(cls) {
      if (!(actual instanceof cls)) throw new Error(`Expected instance of ${cls.name}`)
    },
    toThrow(msg) {
      let threw = false
      let err
      try { actual() } catch (e) { threw = true; err = e }
      if (!threw) throw new Error('Expected function to throw')
      if (msg && !String(err?.message).includes(msg)) {
        throw new Error(`Expected error containing "${msg}", got "${err?.message}"`)
      }
    },
  }
  matchers.not.toThrow = () => {
    try { actual() } catch (e) {
      throw new Error(`Expected function not to throw, but threw: ${e.message}`)
    }
  }
  return matchers
}

function describe(name, fn) {
  const prev = currentSuite
  currentSuite = currentSuite ? `${currentSuite} > ${name}` : name
  console.log(`\n  ${name}`)
  fn()
  currentSuite = prev
}

function it(name, fn) {
  pendingTests.push({ name, fn, suite: currentSuite })
}

// Make them global so the vitest shim can export them
globalThis.__testShim = { describe, it, expect }

console.log('\n🧪 Running tests...\n')

// Import test files (loader will intercept vitest imports)
console.log('── test/core.test.ts ──')
await import('./test/core.test.ts')

console.log('\n── test/server.test.ts ──')
await import('./test/server.test.ts')

console.log('\n── test/integration.test.ts ──')
await import('./test/integration.test.ts')

// Now run all collected tests
console.log('\n── Running collected tests ──\n')
for (const t of pendingTests) {
  const label = `${t.suite} > ${t.name}`
  try {
    await t.fn()
    totalPass++
    process.stdout.write(`  ✓ ${t.name}\n`)
  } catch (e) {
    totalFail++
    failures.push({ label, error: e.message })
    process.stdout.write(`  ✗ ${t.name} — ${e.message}\n`)
  }
}

console.log(`\n${'─'.repeat(50)}`)
console.log(`✓ ${totalPass} passed | ✗ ${totalFail} failed`)

if (failures.length > 0) {
  console.log('\nFailures:')
  for (const f of failures) {
    console.log(`  ✗ ${f.label}`)
    console.log(`    ${f.error}`)
  }
  process.exit(1)
} else {
  console.log('\n✅ All tests passed!')
  process.exit(0)
}
