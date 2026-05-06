import { describe, it, expect } from 'vitest'
import { SUPPORTED_DIFFICULTIES } from '../src/core/types'

describe('SUPPORTED_DIFFICULTIES', () => {
  it('contains all three difficulty levels', () => {
    expect(SUPPORTED_DIFFICULTIES).toContain('easy')
    expect(SUPPORTED_DIFFICULTIES).toContain('medium')
    expect(SUPPORTED_DIFFICULTIES).toContain('hard')
  })

  it('has exactly 3 entries', () => {
    expect(SUPPORTED_DIFFICULTIES).toHaveLength(3)
  })

  it('entries are in ascending difficulty order', () => {
    expect(Array.from(SUPPORTED_DIFFICULTIES)).toEqual(['easy', 'medium', 'hard'])
  })

  it('is re-exported from the main package index', async () => {
    const mod = await import('../src/index')
    expect(mod.SUPPORTED_DIFFICULTIES).toBe(SUPPORTED_DIFFICULTIES)
  })
})
