import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ImageChallengePool,
  IMAGE_CHALLENGE_TEMPLATES,
  type ImageChallenge,
  type PollinationsProviderConfig,
  type PicsumProviderConfig,
} from '../src/core/image-challenge'

// ---------------------------------------------------------------------------
// IMAGE_CHALLENGE_TEMPLATES (unchanged -- regression guard)
// ---------------------------------------------------------------------------

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
    const easyCounts: number[] = []
    const hardCounts: number[] = []
    for (let i = 0; i < 50; i++) {
      easyCounts.push(Number(IMAGE_CHALLENGE_TEMPLATES.object_count.generate('easy').answer))
      hardCounts.push(Number(IMAGE_CHALLENGE_TEMPLATES.object_count.generate('hard').answer))
    }
    const easyMax = Math.max(...easyCounts)
    const hardMax = Math.max(...hardCounts)
    expect(easyMax).toBeLessThanOrEqual(3)
    expect(hardMax).toBeGreaterThanOrEqual(3)
  })
})

// ---------------------------------------------------------------------------
// Static provider (unchanged behaviour -- regression guard)
// ---------------------------------------------------------------------------

describe('ImageChallengePool -- static provider', () => {
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

// ---------------------------------------------------------------------------
// Custom provider (unchanged behaviour -- regression guard)
// ---------------------------------------------------------------------------

describe('ImageChallengePool -- custom provider', () => {
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

  it('returns null from getChallenge when the pool is empty', async () => {
    const pool = new ImageChallengePool({
      provider: { type: 'static', images: [] },
    })
    await pool.initialize()
    expect(pool.size).toBe(0)
    expect(pool.getChallenge()).toBeNull()
    pool.destroy()
  })
})

// ---------------------------------------------------------------------------
// Answer normalisation (unchanged behaviour -- regression guard)
// ---------------------------------------------------------------------------

describe('answer normalization', () => {
  let pool: ImageChallengePool
  beforeEach(async () => {
    pool = new ImageChallengePool({
      provider: {
        type: 'static',
        images: [
          {
            type: 'object_count',
            imageUrl: 'data:image/png;base64,fake',
            question: 'How many cats?',
            answer: '3',
            acceptableAnswers: ['three', '3 cats'],
          },
        ],
      },
    })
    await pool.initialize()
  })

  it('accepts the canonical answer', () => {
    const c = pool.getChallenge()!
    expect(pool.verifyAnswer(c.id, '3')).toBe(true)
  })

  it('accepts whitespace-padded answers', () => {
    const c = pool.getChallenge()!
    expect(pool.verifyAnswer(c.id, '   3   ')).toBe(true)
  })

  it('accepts any of the alternative phrasings', () => {
    const c = pool.getChallenge()!
    expect(pool.verifyAnswer(c.id, 'three')).toBe(true)
    expect(pool.verifyAnswer(c.id, '3 CATS')).toBe(true)
  })

  it('rejects empty / whitespace-only submissions', () => {
    const c = pool.getChallenge()!
    expect(pool.verifyAnswer(c.id, '   ')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Pollinations provider -- unit tests with mocked fetch
// ---------------------------------------------------------------------------

describe('ImageChallengePool -- pollinations provider', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds the correct Pollinations URL and populates the pool', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', mockFetch)

    const pool = new ImageChallengePool({
      provider: { type: 'pollinations', width: 256, height: 256, model: 'flux', nologo: true },
      poolSize: 2,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    expect(pool.size).toBe(2)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\//)
    expect(calledUrl).toContain('width=256')
    expect(calledUrl).toContain('height=256')
    expect(calledUrl).toContain('model=flux')
    expect(calledUrl).toContain('nologo=true')
    expect(calledUrl).toContain('seed=')

    pool.destroy()
  })

  it('stores correct metadata on generated challenges', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', mockFetch)

    const pool = new ImageChallengePool({
      provider: { type: 'pollinations', model: 'turbo', seed: 42 },
      poolSize: 1,
      challengeTypes: ['scene_description'],
      concurrency: 1,
    })
    await pool.initialize()

    const challenge = pool.getChallenge()!
    expect(challenge.metadata?.provider).toBe('pollinations')
    expect(challenge.metadata?.model).toBe('turbo')
    expect(challenge.metadata?.seed).toBe(42)
    expect(challenge.imageUrl).toContain('seed=42')

    pool.destroy()
  })

  it('uses HEAD request (no image download) for URL verification', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', mockFetch)

    const pool = new ImageChallengePool({
      provider: { type: 'pollinations' },
      poolSize: 1,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('image.pollinations.ai'),
      { method: 'HEAD' },
    )

    pool.destroy()
  })

  it('skips failed images (non-200) and does not add them to the pool', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' })
    vi.stubGlobal('fetch', mockFetch)

    const pool = new ImageChallengePool({
      provider: { type: 'pollinations' },
      poolSize: 3,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    // All generations failed -- pool should be empty (not throw)
    expect(pool.size).toBe(0)
    expect(pool.getChallenge()).toBeNull()

    pool.destroy()
  })

  it('encodes special characters in the prompt URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', mockFetch)

    const pool = new ImageChallengePool({
      provider: { type: 'pollinations' },
      poolSize: 1,
      challengeTypes: ['text_recognition'],
      concurrency: 1,
    })
    await pool.initialize()

    const calledUrl: string = mockFetch.mock.calls[0][0]
    // The prompt portion (between /prompt/ and ?) must be URL-encoded -- no raw spaces
    const promptPart = calledUrl.split('/prompt/')[1].split('?')[0]
    expect(promptPart).not.toContain(' ')

    pool.destroy()
  })

  it('uses default dimensions (512x512) when not specified', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
    vi.stubGlobal('fetch', mockFetch)

    const pool = new ImageChallengePool({
      provider: { type: 'pollinations' },
      poolSize: 1,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    const calledUrl: string = mockFetch.mock.calls[0][0]
    expect(calledUrl).toContain('width=512')
    expect(calledUrl).toContain('height=512')

    pool.destroy()
  })
})

// ---------------------------------------------------------------------------
// Picsum provider -- unit tests (URL-only, no network calls)
// ---------------------------------------------------------------------------

describe('ImageChallengePool -- picsum provider', () => {
  it('builds correct Picsum URLs with default dimensions', async () => {
    const pool = new ImageChallengePool({
      provider: { type: 'picsum' },
      poolSize: 3,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    expect(pool.size).toBe(3)
    const challenge = pool.getChallenge()!
    expect(challenge.imageUrl).toMatch(/^https:\/\/picsum\.photos\/seed\/\d+\/512\/512$/)
    expect(challenge.metadata?.provider).toBe('picsum')

    pool.destroy()
  })

  it('respects custom width and height', async () => {
    const pool = new ImageChallengePool({
      provider: { type: 'picsum', width: 320, height: 240 },
      poolSize: 1,
      challengeTypes: ['color_identification'],
      concurrency: 1,
    })
    await pool.initialize()

    const challenge = pool.getChallenge()!
    expect(challenge.imageUrl).toContain('/320/240')

    pool.destroy()
  })

  it('appends grayscale query param when requested', async () => {
    const pool = new ImageChallengePool({
      provider: { type: 'picsum', grayscale: true },
      poolSize: 1,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    const challenge = pool.getChallenge()!
    expect(challenge.imageUrl).toContain('grayscale')
    expect(challenge.metadata?.grayscale).toBe(true)

    pool.destroy()
  })

  it('appends blur query param when requested', async () => {
    const pool = new ImageChallengePool({
      provider: { type: 'picsum', blur: 3 },
      poolSize: 1,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    const challenge = pool.getChallenge()!
    expect(challenge.imageUrl).toContain('blur=3')
    expect(challenge.metadata?.blur).toBe(3)

    pool.destroy()
  })

  it('uses sequential seeds in non-random mode', async () => {
    const pool = new ImageChallengePool({
      provider: { type: 'picsum', randomSeed: false, seedStart: 100 },
      poolSize: 3,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    const seeds: number[] = []
    for (let i = 0; i < 3; i++) {
      const c = pool.getChallenge()
      if (c) seeds.push(c.metadata?.seed as number)
    }

    expect(seeds).toContain(100)
    expect(seeds).toContain(101)
    expect(seeds).toContain(102)

    pool.destroy()
  })

  it('does not call fetch (URL-only, no network verification needed)', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const pool = new ImageChallengePool({
      provider: { type: 'picsum' },
      poolSize: 2,
      challengeTypes: ['object_count'],
      concurrency: 1,
    })
    await pool.initialize()

    expect(fetchSpy).not.toHaveBeenCalled()

    pool.destroy()
    vi.restoreAllMocks()
  })
})

// ---------------------------------------------------------------------------
// Provider type exports -- compile-time type assignment checks
// ---------------------------------------------------------------------------

describe('Provider type exports', () => {
  it('PollinationsProviderConfig is assignable', () => {
    const config: PollinationsProviderConfig = {
      type: 'pollinations',
      width: 1024,
      height: 768,
      nologo: true,
      seed: 12345,
      model: 'flux-realism',
    }
    expect(config.type).toBe('pollinations')
  })

  it('PicsumProviderConfig is assignable', () => {
    const config: PicsumProviderConfig = {
      type: 'picsum',
      width: 640,
      height: 480,
      randomSeed: false,
      seedStart: 50,
      grayscale: false,
      blur: 2,
    }
    expect(config.type).toBe('picsum')
  })
})

// Regression coverage for CONSOLIDATED#3 (2026-07-02 audit): confirm
// Pollinations + Picsum are reachable through the package's public surface
// (i.e. `imrobot/core`) after build. The tests above use the src tree; this
// one loads the built `dist/core` output that npm consumers actually get.
//
// Note: CI runs `npm test` BEFORE `npm run build`, so dist/core doesn't exist
// during CI. These tests are runtime-guarded so they skip cleanly on CI and
// exercise the built output locally after `npm run build && npm test`.

import { existsSync as _existsSync } from 'node:fs'
import { fileURLToPath as _fileURLToPath } from 'node:url'
import { dirname as _dirname, resolve as _resolve } from 'node:path'

const _distCorePath = _resolve(
  _dirname(_fileURLToPath(import.meta.url)),
  '../dist/core/index.js',
)
const _distCoreExists = _existsSync(_distCorePath)

describe('imrobot/core public API — Pollinations + Picsum providers ship', () => {
  it.runIf(_distCoreExists)(
    'dist/core/index.js re-exports ImageChallengePool + IMAGE_CHALLENGE_TEMPLATES',
    async () => {
      const distCore = await import(/* @vite-ignore */ _distCorePath)
      expect(typeof distCore.ImageChallengePool).toBe('function')
      // IMAGE_CHALLENGE_TEMPLATES is a Record<ImageChallengeType, ImageChallengeTemplate>
      expect(distCore.IMAGE_CHALLENGE_TEMPLATES).toBeTypeOf('object')
      expect(Object.keys(distCore.IMAGE_CHALLENGE_TEMPLATES).length).toBeGreaterThan(0)
    },
  )

  it.runIf(_distCoreExists)(
    'ImageChallengePool from dist/core accepts pollinations provider without runtime error',
    async () => {
      const { ImageChallengePool } = await import(/* @vite-ignore */ _distCorePath)
      // Just constructing must not throw -- confirms the type union accepts the config
      // shape in the built output. Actual network flow is covered by the mocked tests above.
      const pool = new ImageChallengePool({
        poolSize: 1,
        refillThreshold: 0,
        provider: { type: 'pollinations', width: 128, height: 128 },
      })
      expect(pool).toBeDefined()
    },
  )

  it.runIf(_distCoreExists)(
    'ImageChallengePool from dist/core accepts picsum provider without runtime error',
    async () => {
      const { ImageChallengePool } = await import(/* @vite-ignore */ _distCorePath)
      const pool = new ImageChallengePool({
        poolSize: 1,
        refillThreshold: 0,
        provider: { type: 'picsum', width: 128, height: 128 },
      })
      expect(pool).toBeDefined()
    },
  )
})
