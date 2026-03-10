import { describe, it, expect } from 'vitest'
import { getStyles, getTheme, ROBOT_SVG } from '../src/styles'

describe('styles', () => {
  it('getTheme returns light theme colors', () => {
    const theme = getTheme('light')
    expect(theme.bg).toBe('#fafafa')
    expect(theme.text).toBe('#1a1a1a')
    expect(theme.btnBg).toBe('#2563eb')
  })

  it('getTheme returns dark theme colors', () => {
    const theme = getTheme('dark')
    expect(theme.bg).toBe('#1a1a2e')
    expect(theme.text).toBe('#e0e0e0')
    expect(theme.btnBg).toBe('#3b82f6')
  })

  it('getStyles returns CSS string for light theme', () => {
    const css = getStyles('light')
    expect(css).toContain('.imrobot')
    expect(css).toContain('.imrobot-header')
    expect(css).toContain('.imrobot-challenge')
    expect(css).toContain('.imrobot-input')
    expect(css).toContain('.imrobot-btn')
    expect(css).toContain('#fafafa') // light bg
  })

  it('getStyles returns CSS string for dark theme', () => {
    const css = getStyles('dark')
    expect(css).toContain('#1a1a2e') // dark bg
    expect(css).toContain('#0f0f23') // dark input bg
  })

  it('ROBOT_SVG is a valid SVG string', () => {
    expect(ROBOT_SVG).toContain('<svg')
    expect(ROBOT_SVG).toContain('</svg>')
    expect(ROBOT_SVG).toContain('viewBox')
  })

  it('getStyles includes screenshot shield styles', () => {
    const css = getStyles('light')
    expect(css).toContain('imrobot-challenge--shielded')
    expect(css).toContain('imrobot-shield-notice')
    expect(css).toContain('blur')
  })

  it('getStyles includes timer styles', () => {
    const css = getStyles('light')
    expect(css).toContain('imrobot-timer')
    expect(css).toContain('imrobot-timer-fill')
    expect(css).toContain('imrobot-timer-fill--warn')
  })
})
