import type { Operation } from './types'

export function executeOperation(input: string, op: Operation): string {
  switch (op.op) {
    case 'reverse':
      return input.split('').reverse().join('')

    case 'base64_encode':
      if (typeof btoa !== 'undefined') return btoa(input)
      // Node.js fallback
      try {
        return (globalThis as Record<string, any>).Buffer.from(input, 'binary').toString('base64')
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
      return input.split('').sort().join('')

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
  }
}

export function formatPipeline(seed: string, pipeline: Operation[]): string {
  const lines = [`seed: "${seed}"`]
  pipeline.forEach((op, i) => {
    lines.push(`  ${i + 1}. ${formatOperation(op)}`)
  })
  return lines.join('\n')
}
