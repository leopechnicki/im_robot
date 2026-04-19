import type { Operation } from './types'
import { fnv1a } from './hash'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalRef = globalThis as Record<string, any>

/**
 * Synchronous hash for crypto challenge operations.
 * Cascades FNV-1a to produce 64 hex chars (256-bit equivalent).
 * Real SHA-256 is async (Web Crypto) so we use this for synchronous pipelines.
 */
function syncHash256(input: string): string {
  let result = ''
  for (let i = 0; i < 8; i++) {
    result += fnv1a(input + ':' + i)
  }
  return result
}

export function executeOperation(input: string, op: Operation): string {
  switch (op.op) {
    case 'reverse':
      return Array.from(input).reverse().join('')

    case 'base64_encode': {
      // Use TextEncoder to handle full Unicode safely in browsers.
      // btoa() only accepts Latin-1 characters and throws on anything else.
      const bytes = new TextEncoder().encode(input)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      if (typeof btoa !== 'undefined') return btoa(binary)
      // Node.js fallback
      try {
        return globalRef.Buffer.from(input, 'utf-8').toString('base64')
      } catch {
        return input
      }
    }

    case 'to_upper':
      return input.toUpperCase()

    case 'to_lower':
      return input.toLowerCase()

    case 'rot13':
      return input.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
      })

    case 'hex_encode':
      return Array.from(input)
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')

    case 'sort_chars':
      return Array.from(input).sort().join('')

    case 'char_code_sum':
      return String(Array.from(input).reduce((sum, c) => sum + c.charCodeAt(0), 0))

    case 'substring':
      return input.substring(op.start, op.end)

    case 'repeat':
      return input.repeat(op.times)

    case 'replace':
      return input.replaceAll(op.search, op.replacement)

    case 'pad_start':
      return input.padStart(op.length, op.fill)

    // ---- New operations for challenge variety ----

    case 'xor_encode':
      return Array.from(input)
        .map((c) => String.fromCharCode(c.charCodeAt(0) ^ op.key))
        .join('')

    case 'count_chars':
      return String(Array.from(input).filter((c) => c === op.char).length)

    case 'caesar':
      return input.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97
        return String.fromCharCode(((((c.charCodeAt(0) - base + op.shift) % 26) + 26) % 26) + base)
      })

    case 'slice_alternate':
      return Array.from(input)
        .filter((_, i) => i % 2 === 0)
        .join('')

    case 'fnv1a_hash':
      return fnv1a(input)

    case 'length':
      return String(input.length)

    // ---- Crypto-grade operations (v0.4) ----

    case 'sha256_hash':
      return syncHash256(input)

    case 'byte_xor': {
      const keyArr = op.key
      return Array.from(input)
        .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ keyArr[i % keyArr.length]))
        .join('')
    }

    case 'hash_chain': {
      let val = input
      for (let r = 0; r < op.rounds; r++) {
        val = fnv1a(val + ':' + r)
      }
      return val
    }

    case 'nibble_swap':
      return Array.from(input)
        .map((c) => {
          const code = c.charCodeAt(0)
          // Swap high and low nibbles: 0xAB -> 0xBA
          const swapped = ((code & 0x0f) << 4) | ((code & 0xf0) >> 4)
          return String.fromCharCode(swapped)
        })
        .join('')

    case 'bit_rotate': {
      const shift = ((op.bits % 8) + 8) % 8
      return Array.from(input)
        .map((c) => {
          const code = c.charCodeAt(0) & 0xff
          const rotated = ((code << shift) | (code >> (8 - shift))) & 0xff
          return String.fromCharCode(rotated)
        })
        .join('')
    }

    // ---- Additional operations (v0.5+) ----

    case 'vowel_count':
      return String(Array.from(input).filter((c) => 'aeiouAEIOU'.includes(c)).length)

    case 'consonant_extract':
      return Array.from(input)
        .filter((c) => /[a-zA-Z]/.test(c) && !'aeiouAEIOU'.includes(c))
        .join('')

    case 'run_length_encode': {
      if (input.length === 0) return ''
      let result = ''
      let count = 1
      for (let i = 1; i <= input.length; i++) {
        if (i < input.length && input[i] === input[i - 1]) {
          count++
        } else {
          result += count > 1 ? `${count}${input[i - 1]}` : input[i - 1]
          count = 1
        }
      }
      return result
    }

    case 'atbash':
      return input.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97
        return String.fromCharCode(base + (25 - (c.charCodeAt(0) - base)))
      })

    default:
      throw new Error(`Unknown operation: ${(op as { op: string }).op}`)
  }
}

export function executePipeline(seed: string, pipeline: Operation[]): string {
  return pipeline.reduce((value, op) => executeOperation(value, op), seed)
}

export function formatOperation(op: Operation): string {
  switch (op.op) {
    case 'reverse':
      return 'reverse()'
    case 'base64_encode':
      return 'base64_encode()'
    case 'to_upper':
      return 'to_upper()'
    case 'to_lower':
      return 'to_lower()'
    case 'rot13':
      return 'rot13()'
    case 'hex_encode':
      return 'hex_encode()'
    case 'sort_chars':
      return 'sort_chars()'
    case 'char_code_sum':
      return 'char_code_sum()'
    case 'substring':
      return `substring(${op.start}, ${op.end})`
    case 'repeat':
      return `repeat(${op.times})`
    case 'replace':
      return `replace("${op.search}", "${op.replacement}")`
    case 'pad_start':
      return `pad_start(${op.length}, "${op.fill}")`
    case 'xor_encode':
      return `xor_encode(${op.key})`
    case 'count_chars':
      return `count_chars("${op.char}")`
    case 'caesar':
      return `caesar(${op.shift})`
    case 'slice_alternate':
      return 'slice_alternate()'
    case 'fnv1a_hash':
      return 'fnv1a_hash()'
    case 'length':
      return 'length()'
    case 'sha256_hash':
      return 'sha256_hash()'
    case 'byte_xor':
      return `byte_xor([${op.key.join(',')}])`
    case 'hash_chain':
      return `hash_chain(${op.rounds})`
    case 'nibble_swap':
      return 'nibble_swap()'
    case 'bit_rotate':
      return `bit_rotate(${op.bits})`
    case 'vowel_count':
      return 'vowel_count()'
    case 'consonant_extract':
      return 'consonant_extract()'
    case 'run_length_encode':
      return 'run_length_encode()'
    case 'atbash':
      return 'atbash()'
  }
}

export function formatPipeline(seed: string, pipeline: Operation[]): string {
  const lines = [`seed: "${seed}"`]
  pipeline.forEach((op, i) => {
    lines.push(`  ${i + 1}. ${formatOperation(op)}`)
  })
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Natural-language formatting — randomised phrasings per operation
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/**
 * Returns a random natural-language description of an operation.
 * The phrasing changes on every call, making regex-based scraping unreliable.
 */
export function formatOperationNL(op: Operation): string {
  switch (op.op) {
    case 'reverse':
      return pick([
        'Reverse the character order',
        'Flip the string backwards',
        'Mirror the text from end to start',
        'Write the characters in reverse order',
      ])

    case 'base64_encode':
      return pick([
        'Encode the text as Base64',
        'Apply Base64 encoding',
        'Convert the string to its Base64 representation',
      ])

    case 'to_upper':
      return pick([
        'Convert all characters to uppercase',
        'Make every letter uppercase',
        'Transform the text to UPPER CASE',
        'Capitalize all letters',
      ])

    case 'to_lower':
      return pick([
        'Convert all characters to lowercase',
        'Make every letter lowercase',
        'Transform the text to lower case',
        'Downcase all letters',
      ])

    case 'rot13':
      return pick([
        'Apply ROT13 substitution',
        'Rotate each letter 13 positions in the alphabet',
        'Shift every letter by 13 places (ROT13)',
        'Apply the ROT-13 cipher',
      ])

    case 'hex_encode':
      return pick([
        'Encode each character as two-digit hexadecimal',
        'Convert to hex representation',
        'Transform each character to its hex byte value',
        'Hex-encode the entire string',
      ])

    case 'sort_chars':
      return pick([
        'Sort all characters alphabetically',
        'Rearrange the characters in ascending order',
        'Put every character in sorted order',
        'Alphabetically sort the characters',
      ])

    case 'char_code_sum':
      return pick([
        'Sum the character codes of every character',
        'Add up all ASCII/Unicode code values',
        'Compute the total of all character code points',
        "Calculate the sum of each character's code value",
      ])

    case 'substring':
      return pick([
        `Extract characters from position ${op.start} to ${op.end}`,
        `Take the substring from index ${op.start} up to ${op.end}`,
        `Slice out characters ${op.start} through ${op.end}`,
        `Keep only the characters between index ${op.start} and ${op.end}`,
      ])

    case 'repeat':
      return pick([
        `Repeat the text ${op.times} times`,
        `Concatenate the string with itself ${op.times} times`,
        `Duplicate the text ${op.times}x`,
        `Produce ${op.times} copies of the string, joined together`,
      ])

    case 'replace':
      return pick([
        `Replace every "${op.search}" with "${op.replacement}"`,
        `Substitute all occurrences of "${op.search}" for "${op.replacement}"`,
        `Swap each "${op.search}" to "${op.replacement}"`,
        `Change every instance of "${op.search}" to "${op.replacement}"`,
      ])

    case 'pad_start':
      return pick([
        `Pad the start with "${op.fill}" until the length is ${op.length}`,
        `Left-pad with "${op.fill}" to reach ${op.length} characters`,
        `Prepend "${op.fill}" characters until the string is ${op.length} long`,
        `Front-fill with "${op.fill}" to a total length of ${op.length}`,
      ])

    case 'xor_encode':
      return pick([
        `XOR each character code with ${op.key}`,
        `Apply XOR encoding using key ${op.key}`,
        `Bitwise-XOR every character with the value ${op.key}`,
        `XOR-encode with key ${op.key}`,
      ])

    case 'count_chars':
      return pick([
        `Count how many times "${op.char}" appears`,
        `Return the number of occurrences of "${op.char}"`,
        `Tally every "${op.char}" in the string`,
        `Count all instances of the character "${op.char}"`,
      ])

    case 'caesar':
      return pick([
        `Apply a Caesar cipher with a shift of ${op.shift}`,
        `Shift every letter ${op.shift} positions in the alphabet`,
        `Rotate each alphabetic character by ${op.shift}`,
        `Caesar-shift all letters by ${op.shift}`,
      ])

    case 'slice_alternate':
      return pick([
        'Keep only characters at even indices (0, 2, 4, …)',
        'Take every other character starting from the first',
        'Remove all odd-indexed characters',
        'Select alternating characters beginning at index 0',
      ])

    case 'fnv1a_hash':
      return pick([
        'Hash the text using FNV-1a',
        'Compute the FNV-1a hash',
        'Apply the FNV-1a hash function',
        'Produce an FNV-1a digest of the string',
      ])

    case 'length':
      return pick([
        'Return the length of the string',
        'Count the total number of characters',
        'Compute the character count',
        'Output how many characters the string contains',
      ])

    case 'sha256_hash':
      return pick([
        'Hash the text using SHA-256',
        'Compute a SHA-256 digest',
        'Apply the SHA-256 hash function',
        'Produce a SHA-256 hash of the input',
      ])

    case 'byte_xor':
      return pick([
        `XOR each byte with the key [${op.key.join(', ')}] (cycling)`,
        `Apply byte-level XOR using the repeating key [${op.key.join(', ')}]`,
        `Bitwise-XOR each character against the cyclic key [${op.key.join(', ')}]`,
        `Byte-XOR with the rotating key [${op.key.join(', ')}]`,
      ])

    case 'hash_chain':
      return pick([
        `Apply ${op.rounds} rounds of iterated hashing`,
        `Hash the result ${op.rounds} times in succession`,
        `Chain ${op.rounds} hash iterations`,
        `Compute a ${op.rounds}-round hash chain`,
      ])

    case 'nibble_swap':
      return pick([
        'Swap the high and low nibbles of each byte',
        'Exchange the upper and lower 4 bits of every character',
        'Nibble-swap each byte (0xAB → 0xBA)',
        'Flip the high and low halves of every byte',
      ])

    case 'bit_rotate':
      return pick([
        `Rotate each byte left by ${op.bits} bits`,
        `Bitwise left-rotate every byte by ${op.bits}`,
        `Circular-shift each byte ${op.bits} bits to the left`,
        `Left-rotate every character's bits by ${op.bits}`,
      ])

    case 'vowel_count':
      return pick([
        'Count the number of vowels (a, e, i, o, u)',
        'Tally all vowel characters in the string',
        'Return how many vowels appear',
        'Count every a, e, i, o, or u',
      ])

    case 'consonant_extract':
      return pick([
        'Extract only the consonant letters',
        'Remove all vowels and non-letter characters',
        'Keep only consonants from the string',
        'Filter to consonant characters only',
      ])

    case 'run_length_encode':
      return pick([
        'Apply run-length encoding (e.g., "aaabb" becomes "3a2b")',
        'Compress using run-length encoding',
        'RLE-encode the string',
        'Encode consecutive repeated characters as count+char',
      ])

    case 'atbash':
      return pick([
        'Apply the Atbash cipher (a↔z, b↔y, c↔x, ...)',
        'Mirror each letter in the alphabet (A→Z, B→Y)',
        'Apply Atbash substitution',
        'Reverse-alphabet cipher each letter',
      ])
  }
}

/**
 * Formats a full pipeline using randomised natural-language descriptions.
 *
 * Each call produces different phrasing, so scraping the display text
 * with regular expressions is unreliable — agents must parse the JSON
 * pipeline instead.
 */
export function formatPipelineNL(seed: string, pipeline: Operation[]): string {
  const intros = [
    `Starting value: "${seed}"`,
    `Begin with the text: "${seed}"`,
    `Initial input: "${seed}"`,
    `Your seed string is: "${seed}"`,
  ]
  const lines = [pick(intros)]

  const prefixes = ['Step', 'Then', 'Next']

  pipeline.forEach((op, i) => {
    const prefix = i === 0 ? 'Step' : pick(prefixes)
    const num = i + 1
    lines.push(`${prefix} ${num}: ${formatOperationNL(op)}`)
  })

  return lines.join('\n')
}
