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
