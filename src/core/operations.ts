import type { Operation } from './types'
import { fnv1a } from './hash'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalRef = globalThis as Record<string, any>

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
      return String(
        Array.from(input).reduce((sum, c) => sum + c.charCodeAt(0), 0),
      )

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
      return String(
        Array.from(input).filter((c) => c === op.char).length,
      )

    case 'caesar':
      return input.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= 'Z' ? 65 : 97
        return String.fromCharCode((((c.charCodeAt(0) - base + op.shift) % 26) + 26) % 26 + base)
      })

    case 'slice_alternate':
      return Array.from(input)
        .filter((_, i) => i % 2 === 0)
        .join('')

    case 'fnv1a_hash':
      return fnv1a(input)

    case 'length':
      return String(input.length)

    default:
      throw new Error(`Unknown operation: ${(op as { op: string }).op}`)
  }
}

export function executePipeline(seed: string, pipeline: Operation[]): string {
  return pipeline.reduce(
    (value, op) => executeOperation(value, op),
    seed,
  )
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
  }
}

export function formatPipeline(seed: string, pipeline: Operation[]): string {
  const lines = [`seed: "${seed}"`]
  pipeline.forEach((op, i) => {
    lines.push(`  ${i + 1}. ${formatOperation(op)}`)
  })
  return lines.join('\n')
}
