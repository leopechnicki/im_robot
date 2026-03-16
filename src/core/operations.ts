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

    case 'base64_encode':
      if (typeof btoa !== 'undefined') return btoa(input)
      // Node.js fallback
      try {
        return globalRef.Buffer.from(input, 'binary').toString('base64')
      } catch {
        return input
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
  }
}

export function formatPipeline(seed: string, pipeline: Operation[]): string {
  const lines = [`seed: "${seed}"`]
  pipeline.forEach((op, i) => {
    lines.push(`  ${i + 1}. ${formatOperation(op)}`)
  })
  return lines.join('\n')
}
