import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { ImRobot } from '../src/react/Botcha'
import { solveChallenge } from '../src/core/solver'
import type { Challenge } from '../src/core/types'

describe('React ImRobot Component', () => {
  it('renders with default props', () => {
    const { container } = render(<ImRobot />)
    const region = container.querySelector('[role="region"]')
    expect(region).toBeTruthy()
    expect(region?.getAttribute('aria-label')).toBe('ImRobot verification challenge')
  })

  it('displays "Prove you\'re a robot" header', () => {
    const { container } = render(<ImRobot />)
    expect(container.textContent).toContain("Prove you're a robot")
  })

  it('embeds challenge JSON in data attribute', () => {
    const { container } = render(<ImRobot />)
    const el = container.querySelector('[data-imrobot-challenge]')
    expect(el).toBeTruthy()
    const challenge = JSON.parse(el!.getAttribute('data-imrobot-challenge')!)
    expect(challenge.version).toBe(1)
    expect(challenge.pipeline).toBeDefined()
    expect(challenge.seed).toBeDefined()
  })

  it('renders input and verify button', () => {
    const { container } = render(<ImRobot />)
    const input = container.querySelector('input[aria-label="Challenge answer"]')
    expect(input).toBeTruthy()
    const button = container.querySelector('.imrobot-btn')
    expect(button).toBeTruthy()
    expect(button?.textContent).toBe('Verify')
  })

  it('shows verified status on correct answer', () => {
    const onVerified = vi.fn()
    const { container } = render(<ImRobot onVerified={onVerified} />)

    const el = container.querySelector('[data-imrobot-challenge]')!
    const challenge: Challenge = JSON.parse(el.getAttribute('data-imrobot-challenge')!)
    const answer = solveChallenge(challenge)

    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: answer } })
    fireEvent.click(container.querySelector('.imrobot-btn')!)

    expect(onVerified).toHaveBeenCalled()
    expect(container.textContent).toContain('Verified')
  })

  it('shows failed status on wrong answer', () => {
    const onError = vi.fn()
    const { container } = render(<ImRobot onError={onError} />)

    const input = container.querySelector('input')!
    fireEvent.change(input, { target: { value: 'wrong-answer' } })
    fireEvent.click(container.querySelector('.imrobot-btn')!)

    expect(onError).toHaveBeenCalled()
    expect(container.textContent).toContain('Failed')
  })

  it('verify button is disabled when input is empty', () => {
    const { container } = render(<ImRobot />)
    const button = container.querySelector('.imrobot-btn') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('respects difficulty prop', () => {
    const { container } = render(<ImRobot difficulty="hard" />)
    const el = container.querySelector('[data-imrobot-challenge]')!
    const challenge: Challenge = JSON.parse(el.getAttribute('data-imrobot-challenge')!)
    expect(challenge.difficulty).toBe('hard')
    expect(challenge.pipeline.length).toBeGreaterThanOrEqual(5)
  })

  it('shows countdown timer', () => {
    const { container } = render(<ImRobot />)
    const timer = container.querySelector('.imrobot-timer-text')
    expect(timer).toBeTruthy()
    expect(timer?.textContent).toMatch(/\d+s/)
  })

  it('shows imrobot brand in footer', () => {
    const { container } = render(<ImRobot />)
    const brand = container.querySelector('.imrobot-brand')
    expect(brand).toBeTruthy()
    expect(brand?.textContent).toBe('imrobot')
  })
})
