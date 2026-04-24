import { describe, it, expect } from 'vitest'
import { executeOperation, formatOperation, formatOperationNL } from '../src/core/operations'
import type { Operation } from '../src/core/types'

describe('new operations (v0.5+)', () => {
  describe('vowel_count', () => {
    it('counts vowels in a string', () => {
      expect(executeOperation('hello', { op: 'vowel_count' })).toBe('2')
      expect(executeOperation('AEIOU', { op: 'vowel_count' })).toBe('5')
      expect(executeOperation('xyz', { op: 'vowel_count' })).toBe('0')
      expect(executeOperation('', { op: 'vowel_count' })).toBe('0')
    })

    it('handles mixed case', () => {
      expect(executeOperation('HeLLo WoRLd', { op: 'vowel_count' })).toBe('3')
    })
  })

  describe('consonant_extract', () => {
    it('extracts only consonants', () => {
      expect(executeOperation('hello', { op: 'consonant_extract' })).toBe('hll')
      expect(executeOperation('HELLO', { op: 'consonant_extract' })).toBe('HLL')
    })

    it('removes non-letter characters', () => {
      expect(executeOperation('h3llo!', { op: 'consonant_extract' })).toBe('hll')
    })

    it('handles all vowels string', () => {
      expect(executeOperation('aeiou', { op: 'consonant_extract' })).toBe('')
    })

    it('handles empty string', () => {
      expect(executeOperation('', { op: 'consonant_extract' })).toBe('')
    })
  })

  describe('run_length_encode', () => {
    it('encodes repeated characters', () => {
      expect(executeOperation('aaabbc', { op: 'run_length_encode' })).toBe('3a2bc')
    })

    it('handles single characters', () => {
      expect(executeOperation('abc', { op: 'run_length_encode' })).toBe('abc')
    })

    it('handles all same characters', () => {
      expect(executeOperation('aaaa', { op: 'run_length_encode' })).toBe('4a')
    })

    it('handles empty string', () => {
      expect(executeOperation('', { op: 'run_length_encode' })).toBe('')
    })

    it('handles single character', () => {
      expect(executeOperation('a', { op: 'run_length_encode' })).toBe('a')
    })
  })

  describe('atbash', () => {
    it('applies atbash cipher to lowercase', () => {
      expect(executeOperation('abc', { op: 'atbash' })).toBe('zyx')
      expect(executeOperation('xyz', { op: 'atbash' })).toBe('cba')
    })

    it('applies atbash cipher to uppercase', () => {
      expect(executeOperation('ABC', { op: 'atbash' })).toBe('ZYX')
    })

    it('is its own inverse', () => {
      const input = 'Hello World'
      const encoded = executeOperation(input, { op: 'atbash' })
      const decoded = executeOperation(encoded, { op: 'atbash' })
      expect(decoded).toBe(input)
    })

    it('preserves non-alpha characters', () => {
      expect(executeOperation('a1b!c', { op: 'atbash' })).toBe('z1y!x')
    })
  })
})

describe('new operations formatOperation', () => {
  it('formats new operations correctly', () => {
    expect(formatOperation({ op: 'vowel_count' })).toBe('vowel_count()')
    expect(formatOperation({ op: 'consonant_extract' })).toBe('consonant_extract()')
    expect(formatOperation({ op: 'run_length_encode' })).toBe('run_length_encode()')
    expect(formatOperation({ op: 'atbash' })).toBe('atbash()')
  })
})

describe('new operations formatOperationNL', () => {
  it('returns non-empty NL strings for all new operations', () => {
    const ops: Operation[] = [
      { op: 'vowel_count' },
      { op: 'consonant_extract' },
      { op: 'run_length_encode' },
      { op: 'atbash' },
    ]
    for (const op of ops) {
      const result = formatOperationNL(op)
      expect(result).toBeTruthy()
      expect(result.length).toBeGreaterThan(5)
    }
  })

  it('produces varied phrasings for new operations', () => {
    const results = new Set<string>()
    for (let i = 0; i < 20; i++) {
      results.add(formatOperationNL({ op: 'atbash' }))
    }
    expect(results.size).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
// Guard failure paths (PR #55)
// ---------------------------------------------------------------------------

describe('byte_xor guard', () => {
  it('throws when key is empty', () => {
    expect(() =>
      executeOperation('hello', { op: 'byte_xor', key: [] }),
    ).toThrow('byte_xor: key must not be empty')
  })

  it('does not throw for a valid key', () => {
    expect(() =>
      executeOperation('hello', { op: 'byte_xor', key: [0x41] }),
    ).not.toThrow()
  })
})

describe('hash_chain guard', () => {
  it('throws when rounds is 0', () => {
    expect(() =>
      executeOperation('hello', { op: 'hash_chain', rounds: 0 }),
    ).toThrow('hash_chain: rounds must be at least 1')
  })

  it('throws when rounds is negative', () => {
    expect(() =>
      executeOperation('hello', { op: 'hash_chain', rounds: -5 }),
    ).toThrow('hash_chain: rounds must be at least 1')
  })

  it('does not throw for rounds >= 1', () => {
    expect(() =>
      executeOperation('hello', { op: 'hash_chain', rounds: 1 }),
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Crypto-grade operations — full coverage
// ---------------------------------------------------------------------------

describe('hash_chain', () => {
  it('is deterministic for the same input + rounds', () => {
    const a = executeOperation('seed', { op: 'hash_chain', rounds: 3 })
    const b = executeOperation('seed', { op: 'hash_chain', rounds: 3 })
    expect(a).toBe(b)
  })

  it('returns 8 hex chars per round result (FNV-1a 32-bit)', () => {
    const out = executeOperation('seed', { op: 'hash_chain', rounds: 5 })
    expect(out).toMatch(/^[0-9a-f]{8}$/)
  })

  it('produces different output for different round counts', () => {
    const r1 = executeOperation('seed', { op: 'hash_chain', rounds: 1 })
    const r2 = executeOperation('seed', { op: 'hash_chain', rounds: 2 })
    expect(r1).not.toBe(r2)
  })

  it('handles unicode input safely', () => {
    expect(() => executeOperation('café👍', { op: 'hash_chain', rounds: 2 })).not.toThrow()
  })
})

describe('nibble_swap', () => {
  it('swaps the high and low nibbles of each byte', () => {
    // 'A' = 0x41 → 0x14 = control char
    // We pick chars whose nibbles produce printable swaps for stability
    const input = String.fromCharCode(0x12, 0x34, 0x56)
    const expected = String.fromCharCode(0x21, 0x43, 0x65)
    expect(executeOperation(input, { op: 'nibble_swap' })).toBe(expected)
  })

  it('is its own inverse', () => {
    const input = 'Hello, World!'
    const swapped = executeOperation(input, { op: 'nibble_swap' })
    const unswapped = executeOperation(swapped, { op: 'nibble_swap' })
    expect(unswapped).toBe(input)
  })

  it('preserves length', () => {
    expect(executeOperation('abc', { op: 'nibble_swap' }).length).toBe(3)
  })

  it('handles empty string', () => {
    expect(executeOperation('', { op: 'nibble_swap' })).toBe('')
  })
})

describe('bit_rotate', () => {
  it('left-rotates each byte by N bits within the low byte', () => {
    // 'A' = 0x41 = 0b01000001, rotate left 1 → 0b10000010 = 0x82
    const out = executeOperation('A', { op: 'bit_rotate', bits: 1 })
    expect(out.charCodeAt(0)).toBe(0x82)
  })

  it('rotation by 0 is identity', () => {
    const input = 'hello'
    expect(executeOperation(input, { op: 'bit_rotate', bits: 0 })).toBe(input)
  })

  it('rotation by 8 is identity (mod 8)', () => {
    const input = 'hello'
    expect(executeOperation(input, { op: 'bit_rotate', bits: 8 })).toBe(input)
  })

  it('handles negative bit counts via mod 8', () => {
    // Rotating left by -1 should equal rotating left by 7
    const left7 = executeOperation('A', { op: 'bit_rotate', bits: 7 })
    const leftNeg1 = executeOperation('A', { op: 'bit_rotate', bits: -1 })
    expect(leftNeg1).toBe(left7)
  })

  it('preserves length', () => {
    expect(executeOperation('abc', { op: 'bit_rotate', bits: 3 }).length).toBe(3)
  })
})

describe('byte_xor (cycling key)', () => {
  it('XORs each byte against the cycling key', () => {
    // 'AB' = [0x41, 0x42], key [0x01, 0x02] → [0x40, 0x40] = '@@'
    expect(executeOperation('AB', { op: 'byte_xor', key: [0x01, 0x02] })).toBe('@@')
  })

  it('cycles the key when shorter than input', () => {
    const out = executeOperation('AAAA', { op: 'byte_xor', key: [0x01] })
    expect(out).toBe('@@@@')
  })

  it('is its own inverse with the same key', () => {
    const input = 'Hello, World!'
    const enc = executeOperation(input, { op: 'byte_xor', key: [0x42, 0x37, 0x99] })
    const dec = executeOperation(enc, { op: 'byte_xor', key: [0x42, 0x37, 0x99] })
    expect(dec).toBe(input)
  })

  it('preserves length', () => {
    expect(executeOperation('abc', { op: 'byte_xor', key: [0x10] }).length).toBe(3)
  })
})

describe('fnv1a_cascade and sha256_hash alias', () => {
  it('produces 64 hex chars', () => {
    const out = executeOperation('seed', { op: 'fnv1a_cascade' })
    expect(out).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const a = executeOperation('seed', { op: 'fnv1a_cascade' })
    const b = executeOperation('seed', { op: 'fnv1a_cascade' })
    expect(a).toBe(b)
  })

  it('sha256_hash and fnv1a_cascade produce IDENTICAL output (alias)', () => {
    const fromAlias = executeOperation('hello', { op: 'fnv1a_cascade' })
    const fromLegacy = executeOperation('hello', { op: 'sha256_hash' })
    expect(fromAlias).toBe(fromLegacy)
  })

  it('formatOperation uses the canonical name for each variant', () => {
    expect(formatOperation({ op: 'fnv1a_cascade' })).toBe('fnv1a_cascade()')
    expect(formatOperation({ op: 'sha256_hash' })).toBe('sha256_hash()')
  })

  it('formatOperationNL no longer claims SHA-256', () => {
    for (const op of [{ op: 'fnv1a_cascade' as const }, { op: 'sha256_hash' as const }]) {
      const nl = formatOperationNL(op)
      expect(nl).toContain('FNV-1a')
      expect(nl).not.toContain('SHA-256')
    }
  })
})
