import { describe, it, expect, beforeEach } from 'vitest'
import {
  ImageChallengePool,
  IMAGE_CHALLENGE_TEMPLATES,
  type ImageChallenge,
} from '../src/core/image-challenge'

describe('IMAGE_CHALLENGE_TEMPLATES', () => {
  it('has templates for all challenge types', () => {
    const types = [
      'object_count',
      'spatial_reasoning',
      'color_identification',
      'scene_description',
      'text_recognition',
      'odd_one_out',
    ] as const

    for (const type of types) {
      expect(IMAGE_CHALLENGE_TEMPLATES[type]).toBeDefined()
      expect(IMAGE_CHALLENGE_TEMPLATES[type].type).toBe(type)
    }
  })

  it('generates valid challenge data for each type', () => {
    for (const [, template] of Object.entries(IMAGE_CHALLENGE_TEMPLATES)) {
      for (const difficulty of ['easy', 'medium', 'hard'] as const) {
        const result = template.generate(difficulty)
        expect(result.prompt).toBeTruthy()
        expect(result.question).toBeTruthy()
        expect(result.answer).toBeTruthy()
        expect(typeof result.prompt).toBe('string')
        expect(typeof result.question).toBe('string')
        expect(typeof result.answer).toBe('string')
      }
    }
  })

  it('object_count varies count with difficulty', () => {
    // Run multiple times to check ranges
    const easyCounts: number[] = []
    const hardCounts: number[] = []
    for (let i = 0; i < 50; i++) {
      easyCounts.push(Number(IMAGE_CHALLENGE_TEMPLATES.object_count.generate('easy').answer))
      hardCounts.push(Number(IMAGE_CHALLENGE_TEMPLATES.object_count.generate('hard').answer))
    }
    const easyMax = Math.max(...easyCounts)
    const hardMax = Math.max(...hardCounts)
    // Hard should generally allow higher counts
    expect(easyMax).toBeLessThanOrEqual(3)
    expect(hardMax).toBeGreaterThanOrEqual(3)
  })
})

describe('ImageChallengePool', () => {
  describe('with static provider', () => {
    let pool: ImageChallengePool

    const staticImages: ImageChallenge[] = [
      {
        id: 'test_1',
        type: 'object_count',
        imageUrl: 'data:image/png;base64,fake1',
        question: 'How many apples?',
        answer: '3',
        generationPrompt: '(static)',
        generatedAt: Date.now(),
        difficulty: 'medium',
        acceptableAnswers: ['3', 'three'],
      },
      {
        id: 'test_2',
        type: 'color_identification',
        imageUrl: 'data:image/png;base64,fake2',
        question: 'What color is the car?',
        answer: 'red',
        generationPrompt: '(static)',
        generatedAt: Date.now(),
        difficulty: 'medium',
        acceptableAnswers: ['red'],
      },
    ]

    beforeEach(async () => {
      pool = new ImageChallengePool({
        provider: {
          type: 'static',
          images: staticImages.map(({ type, imageUrl, question, answer, acceptableAnswers }) => ({
            type,
            imageUrl,
            question,
            answer,
            acceptableAnswers,
          })),
        },
      })
      await pool.initialize()
    })

    it('initializes with correct pool size', () => {
      expect(pool.size).toBe(2)
    })

    it('returns challenges from the pool', () => {
      const challenge = pool.getChallenge()
      expect(challenge).toBeDefined()
      expect(challenge!.question).toBeTruthy()
      expect(challenge!.answer).toBeTruthy()
    })

    it('verifies correct answers', () => {
      const challenge = pool.getChallenge()!
      expect(pool.verifyAnswer(challenge.id, challenge.answer)).toBe(true)
    })

    it('rejects wrong answers', () => {
      const challenge = pool.getChallenge()!
      expect(pool.verifyAnswer(challenge.id, 'wrong')).toBe(false)
    })

    it('supports case-insensitive answer matching', () => {
      const challenge = pool.getChallenge()!
      // Answers should match case-insensitively
      expect(pool.verifyAnswer(challenge.id, challenge.answer.toUpperCase())).toBe(true)
    })

    it('returns null for unknown challenge IDs', () => {
      expect(pool.verifyAnswer('unknown_id', '3')).toBe(false)
    })

    it('cleans up on destroy', () => {
      pool.destroy()
      expect(pool.size).toBe(0)
    })
  })

  describe('with custom provider', () => {
    it('generates challenges using custom provider', async () => {
      const pool = new ImageChallengePool({
        provider: {
          type: 'custom',
          generate: async (prompt: string) => ({
            imageUrl: `data:image/png;base64,generated_${prompt.slice(0, 10)}`,
            metadata: { source: 'test' },
          }),
        },
        poolSize: 3,
        challengeTypes: ['object_count'],
        concurrency: 2,
      })

      await pool.initialize()
      expect(pool.size).toBe(3)

      const challenge = pool.getChallenge()
      expect(challenge).toBeDefined()
      expect(challenge!.type).toBe('object_count')
      expect(challenge!.imageUrl).toContain('data:image/png;base64,generated_')

      pool.destroy()
    })
  })
})
