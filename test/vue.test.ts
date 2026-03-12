import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ImRobot } from '../src/vue/Botcha'
import { solveChallenge } from '../src/core/solver'
import type { Challenge } from '../src/core/types'

describe('Vue ImRobot Component', () => {
  it('renders with default props', () => {
    const wrapper = mount(ImRobot)
    const region = wrapper.find('[role="region"]')
    expect(region.exists()).toBe(true)
    expect(region.attributes('aria-label')).toBe('ImRobot verification challenge')
  })

  it('displays "Prove you\'re a robot" header', () => {
    const wrapper = mount(ImRobot)
    expect(wrapper.text()).toContain("Prove you're a robot")
  })

  it('embeds challenge JSON in data attribute', () => {
    const wrapper = mount(ImRobot)
    const el = wrapper.find('[data-imrobot-challenge]')
    expect(el.exists()).toBe(true)
    const challenge = JSON.parse(el.attributes('data-imrobot-challenge')!)
    expect(challenge.version).toBe(1)
    expect(challenge.pipeline).toBeDefined()
  })

  it('renders input and verify button', () => {
    const wrapper = mount(ImRobot)
    const input = wrapper.find('input[aria-label="Challenge answer"]')
    expect(input.exists()).toBe(true)
    const button = wrapper.find('.imrobot-btn')
    expect(button.exists()).toBe(true)
    expect(button.text()).toBe('Verify')
  })

  it('emits verified event on correct answer', async () => {
    const wrapper = mount(ImRobot)
    const el = wrapper.find('[data-imrobot-challenge]')
    const challenge: Challenge = JSON.parse(el.attributes('data-imrobot-challenge')!)
    const answer = solveChallenge(challenge)

    const input = wrapper.find('input')
    await input.setValue(answer)
    await wrapper.find('.imrobot-btn').trigger('click')

    expect(wrapper.emitted('verified')).toBeTruthy()
    expect(wrapper.emitted('verified')![0]).toBeDefined()
  })

  it('emits error event on wrong answer', async () => {
    const wrapper = mount(ImRobot)

    const input = wrapper.find('input')
    await input.setValue('wrong-answer')
    await wrapper.find('.imrobot-btn').trigger('click')

    expect(wrapper.emitted('error')).toBeTruthy()
  })

  it('respects difficulty prop', () => {
    const wrapper = mount(ImRobot, { props: { difficulty: 'hard' } })
    const el = wrapper.find('[data-imrobot-challenge]')
    const challenge: Challenge = JSON.parse(el.attributes('data-imrobot-challenge')!)
    expect(challenge.difficulty).toBe('hard')
    expect(challenge.pipeline.length).toBeGreaterThanOrEqual(5)
  })

  it('shows countdown timer', () => {
    const wrapper = mount(ImRobot)
    const timer = wrapper.find('.imrobot-timer-text')
    expect(timer.exists()).toBe(true)
    expect(timer.text()).toMatch(/\d+s/)
  })

  it('shows imrobot brand in footer', () => {
    const wrapper = mount(ImRobot)
    const brand = wrapper.find('.imrobot-brand')
    expect(brand.exists()).toBe(true)
    expect(brand.text()).toBe('imrobot')
  })
})
