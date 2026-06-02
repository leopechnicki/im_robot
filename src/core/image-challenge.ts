/**
 * AI Image Challenge — foundation for AI-generated image verification.
 *
 * This module provides the types, configuration, and pool management
 * for image-based challenges where AI-generated images serve as
 * verification material.
 *
 * **Concept:** Pre-generate pools of AI images with known ground truth
 * (e.g., "a kitchen with 3 apples" -> answer is "3"), then serve them
 * as challenges. Agents parse the structured challenge data; humans
 * would need to visually interpret the scene AND solve the pipeline.
 *
 * **Supported providers:**
 * - `pollinations` -- Pollinations.ai (free, no auth, zero-deps fetch)
 * - `picsum`       -- Lorem Picsum placeholder images (free, no auth)
 * - `openai`       -- OpenAI DALL-E (requires API key)
 * - `stability`    -- Stability AI (requires API key)
 * - `custom`       -- bring your own generator function
 * - `static`       -- serve from pre-built image arrays (no network)
 *
 * @example
 * ```typescript
 * import { ImageChallengePool } from 'imrobot/core'
 *
 * // Pollinations.ai -- free, no API key required
 * const pool = new ImageChallengePool({
 *   provider: { type: 'pollinations' },
 *   poolSize: 20,
 *   challengeTypes: ['object_count', 'spatial_reasoning'],
 * })
 * await pool.initialize()
 *
 * const challenge = pool.getChallenge()
 * // { type: 'object_count', imageUrl: 'https://image.pollinations.ai/prompt/...', ... }
 * ```
 */

import type { Difficulty } from './types'

// ---------------------------------------------------------------------------
// Image Challenge Types
// ---------------------------------------------------------------------------

/** Types of visual challenges that can be generated */
export type ImageChallengeType =
  | 'object_count' // "How many X are in the image?"
  | 'spatial_reasoning' // "What is to the left of the red car?"
  | 'color_identification' // "What color is the largest object?"
  | 'scene_description' // "Describe the scene in one word"
  | 'text_recognition' // "What text appears in the image?"
  | 'odd_one_out' // "Which image doesn't belong?" (multi-image)

/** A single image challenge with known ground truth */
export interface ImageChallenge {
  /** Unique challenge identifier */
  id: string
  /** Challenge type */
  type: ImageChallengeType
  /** URL or base64 data URI of the generated image */
  imageUrl: string
  /** The question posed to the agent */
  question: string
  /** The correct answer (ground truth from generation prompt) */
  answer: string
  /** The prompt used to generate the image (for auditing) */
  generationPrompt: string
  /** When this challenge was generated */
  generatedAt: number
  /** Difficulty level */
  difficulty: Difficulty
  /** Optional: alternative acceptable answers */
  acceptableAnswers?: string[]
  /** Optional: image dimensions */
  dimensions?: { width: number; height: number }
  /** Optional: additional metadata from the provider */
  metadata?: Record<string, unknown>
}

/** Template for generating image challenges */
export interface ImageChallengeTemplate {
  /** Challenge type this template produces */
  type: ImageChallengeType
  /** Function that generates a prompt and expected answer */
  generate: (difficulty: Difficulty) => {
    prompt: string
    question: string
    answer: string
    acceptableAnswers?: string[]
  }
}

// ---------------------------------------------------------------------------
// Provider Configuration
// ---------------------------------------------------------------------------

/**
 * Pollinations.ai provider -- free, no API key, zero external dependencies.
 *
 * Uses the public Pollinations.ai image API which accepts a text prompt
 * and returns a generated image as a direct URL. The URL itself IS the
 * image (redirect to CDN), making it safe to embed in <img src>.
 *
 * @see https://pollinations.ai
 *
 * @example
 * ```typescript
 * const pool = new ImageChallengePool({
 *   provider: { type: 'pollinations' },
 * })
 * ```
 */
export interface PollinationsProviderConfig {
  type: 'pollinations'
  /**
   * Image width in pixels (default: 512).
   * Pollinations supports 64-2048.
   */
  width?: number
  /**
   * Image height in pixels (default: 512).
   * Pollinations supports 64-2048.
   */
  height?: number
  /**
   * Suppress the Pollinations.ai watermark logo (default: true).
   */
  nologo?: boolean
  /**
   * Optional seed for reproducible generations (default: random).
   * Set a fixed seed if you want the same prompt to always produce the same image.
   */
  seed?: number
  /**
   * Pollinations model name (default: 'flux').
   * Available: 'flux', 'flux-realism', 'flux-anime', 'flux-3d', 'turbo'
   */
  model?: 'flux' | 'flux-realism' | 'flux-anime' | 'flux-3d' | 'turbo'
}

/**
 * Lorem Picsum provider -- deterministic placeholder images (free, no auth).
 *
 * Useful for development, testing, and pre-production environments where
 * real AI generation is not needed. Images are served from a CDN with
 * consistent URLs based on a numeric seed.
 *
 * Note: Picsum images are generic photographs, not prompt-matched. Use this
 * provider when you need a fast, reliable image source and do NOT need the
 * visual content to match the challenge prompt.
 *
 * @see https://picsum.photos
 *
 * @example
 * ```typescript
 * const pool = new ImageChallengePool({
 *   provider: { type: 'picsum' },
 * })
 * ```
 */
export interface PicsumProviderConfig {
  type: 'picsum'
  /** Image width in pixels (default: 512) */
  width?: number
  /** Image height in pixels (default: 512) */
  height?: number
  /**
   * Whether to use a random seed per image (default: true).
   * Set false to use sequential seeds starting from seedStart.
   */
  randomSeed?: boolean
  /** Starting seed for sequential mode (default: 1) */
  seedStart?: number
  /** Apply a grayscale filter (default: false) */
  grayscale?: boolean
  /** Blur radius 1-10 (default: undefined = no blur) */
  blur?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
}

/** OpenAI DALL-E provider configuration */
export interface OpenAIProviderConfig {
  type: 'openai'
  /** OpenAI API key */
  apiKey: string
  /** Model to use (default: 'dall-e-3') */
  model?: 'dall-e-2' | 'dall-e-3'
  /** Image size (default: '512x512') */
  size?: '256x256' | '512x512' | '1024x1024'
  /** Image quality (default: 'standard') */
  quality?: 'standard' | 'hd'
}

/** Stability AI provider configuration */
export interface StabilityProviderConfig {
  type: 'stability'
  /** Stability AI API key */
  apiKey: string
  /** Engine/model ID (default: 'stable-diffusion-xl-1024-v1-0') */
  engineId?: string
  /** Image dimensions */
  width?: number
  height?: number
}

/** Custom provider -- bring your own image generator */
export interface CustomProviderConfig {
  type: 'custom'
  /**
   * Generate an image from a text prompt.
   * Must return a URL or base64 data URI.
   */
  generate: (prompt: string) => Promise<{ imageUrl: string; metadata?: Record<string, unknown> }>
}

/** Static provider -- serve from pre-generated image pool (no API needed) */
export interface StaticProviderConfig {
  type: 'static'
  /** Pre-generated images with their challenge data */
  images: Array<{
    imageUrl: string
    type: ImageChallengeType
    question: string
    answer: string
    acceptableAnswers?: string[]
    metadata?: Record<string, unknown>
  }>
}

export type ImageProviderConfig =
  | PollinationsProviderConfig
  | PicsumProviderConfig
  | OpenAIProviderConfig
  | StabilityProviderConfig
  | CustomProviderConfig
  | StaticProviderConfig

// ---------------------------------------------------------------------------
// Pool Configuration
// ---------------------------------------------------------------------------

export interface ImageChallengePoolConfig {
  /** Image generation provider */
  provider: ImageProviderConfig
  /** Number of challenges to keep in pool (default: 50) */
  poolSize?: number
  /** Which challenge types to generate (default: all) */
  challengeTypes?: ImageChallengeType[]
  /** How often to rotate the pool in ms (default: 1 hour) */
  rotationIntervalMs?: number
  /** Difficulty level for generated challenges (default: 'medium') */
  difficulty?: Difficulty
  /** Maximum concurrent generation requests (default: 5) */
  concurrency?: number
}

// ---------------------------------------------------------------------------
// Built-in Challenge Templates
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const range = max - min + 1
    const bytes = crypto.getRandomValues(new Uint32Array(1))
    return min + (bytes[0] % range)
  }
  throw new Error(
    'randomInt: crypto.getRandomValues is not available -- cannot generate secure random values',
  )
}

function pickRandom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)]
}

const OBJECTS = ['apples', 'chairs', 'books', 'cups', 'birds', 'flowers', 'cars', 'trees']
const COLORS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'white', 'black']
const SCENES = ['kitchen', 'park', 'office', 'street', 'beach', 'forest', 'classroom', 'garden']
const POSITIONS = ['left', 'right', 'above', 'below', 'behind', 'in front of']

/** Built-in templates for each challenge type */
export const IMAGE_CHALLENGE_TEMPLATES: Record<ImageChallengeType, ImageChallengeTemplate> = {
  object_count: {
    type: 'object_count',
    generate: (difficulty) => {
      const count =
        difficulty === 'easy'
          ? randomInt(1, 3)
          : difficulty === 'medium'
            ? randomInt(2, 5)
            : randomInt(3, 8)
      const object = pickRandom(OBJECTS)
      const color = pickRandom(COLORS)
      const scene = pickRandom(SCENES)
      return {
        prompt: `A photorealistic ${scene} scene containing exactly ${count} ${color} ${object}. Clear, well-lit, easy to count. No ambiguity.`,
        question: `How many ${color} ${object} are in the image?`,
        answer: String(count),
        acceptableAnswers: [String(count)],
      }
    },
  },

  spatial_reasoning: {
    type: 'spatial_reasoning',
    generate: (_difficulty) => {
      const obj1 = pickRandom(OBJECTS)
      const obj2 = pickRandom(OBJECTS.filter((o) => o !== obj1))
      const position = pickRandom(POSITIONS)
      const color = pickRandom(COLORS)
      return {
        prompt: `A clear scene with a ${color} ${obj1} positioned ${position} a ${obj2}. Simple layout, photorealistic.`,
        question: `What is ${position} the ${obj2}?`,
        answer: `${color} ${obj1}`,
        acceptableAnswers: [`${color} ${obj1}`, obj1, `a ${color} ${obj1}`],
      }
    },
  },

  color_identification: {
    type: 'color_identification',
    generate: () => {
      const color = pickRandom(COLORS)
      const object = pickRandom(OBJECTS)
      const scene = pickRandom(SCENES)
      return {
        prompt: `A ${scene} with one large ${color} ${object} as the dominant object. Photorealistic, clear.`,
        question: 'What color is the largest object in the image?',
        answer: color,
        acceptableAnswers: [color],
      }
    },
  },

  scene_description: {
    type: 'scene_description',
    generate: () => {
      const scene = pickRandom(SCENES)
      return {
        prompt: `A typical ${scene} scene. Photorealistic, no text, clear subject.`,
        question: 'What type of place is shown in this image? (one word)',
        answer: scene,
        acceptableAnswers: [scene],
      }
    },
  },

  text_recognition: {
    type: 'text_recognition',
    generate: (difficulty) => {
      const words = ['HELLO', 'ROBOT', 'VERIFY', 'AGENT', 'ACCESS', 'SECURE', 'TOKEN', 'PROOF']
      const word = pickRandom(words)
      const distortion = difficulty === 'hard' ? 'slightly distorted' : 'clear'
      return {
        prompt: `A sign or banner displaying the word "${word}" in large ${distortion} letters. Simple background, easy to read.`,
        question: 'What word is displayed in the image?',
        answer: word,
        acceptableAnswers: [word, word.toLowerCase()],
      }
    },
  },

  odd_one_out: {
    type: 'odd_one_out',
    generate: () => {
      const mainObject = pickRandom(OBJECTS)
      const oddObject = pickRandom(OBJECTS.filter((o) => o !== mainObject))
      return {
        prompt: `Four ${mainObject} and one ${oddObject} arranged in a row. Photorealistic, clear difference.`,
        question: 'Which object does not belong with the others?',
        answer: oddObject,
        acceptableAnswers: [oddObject, `the ${oddObject}`, `a ${oddObject}`],
      }
    },
  },
}

// ---------------------------------------------------------------------------
// Provider Implementations -- internal helpers
// ---------------------------------------------------------------------------

/**
 * Generate an image via Pollinations.ai (free, no auth).
 *
 * The Pollinations image API accepts a URL-encoded prompt and returns
 * the image directly. The stable URL format is:
 *   https://image.pollinations.ai/prompt/{encoded-prompt}?width=N&height=N&nologo=true&model=flux
 *
 * The URL is a CDN redirect -- it can be embedded directly in <img src>
 * or downloaded. No API key, no rate-limit headers, no auth needed.
 *
 * Latency: ~2-8 s cold, ~300 ms cached (CDN hit on identical prompt+seed).
 * Rate:    ~10 req/min anonymous; stable for reasonable pool sizes.
 */
async function generatePollinations(
  prompt: string,
  config: PollinationsProviderConfig,
): Promise<{ imageUrl: string; metadata: Record<string, unknown> }> {
  const width = config.width ?? 512
  const height = config.height ?? 512
  const nologo = config.nologo ?? true
  const model = config.model ?? 'flux'

  // Use a random seed per generation unless the caller pins one.
  // A seed in the URL makes the image deterministic and cacheable by Pollinations CDN.
  const seed = config.seed ?? Math.floor(Math.random() * 1_000_000)

  const encodedPrompt = encodeURIComponent(prompt)
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: String(nologo),
    model,
    seed: String(seed),
  })

  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?${params}`

  // Verify the URL resolves (HEAD request -- no image download, saves bandwidth).
  // Pollinations returns 200 on valid prompts; errors return 4xx/5xx.
  const response = await fetch(imageUrl, { method: 'HEAD' })
  if (!response.ok) {
    throw new Error(
      `Pollinations.ai returned ${response.status} ${response.statusText} for prompt: "${prompt.slice(0, 80)}"`,
    )
  }

  return {
    imageUrl,
    metadata: {
      provider: 'pollinations',
      model,
      width,
      height,
      seed,
      promptLength: prompt.length,
    },
  }
}

/**
 * Generate an image URL via Lorem Picsum (free, no auth).
 *
 * Picsum serves random photographs from Unsplash. Images are NOT
 * prompt-matched -- they are selected by a numeric seed only.
 * Use this provider for testing, CI, or any scenario where you need
 * a reliable image URL without real AI generation.
 *
 * URL format: https://picsum.photos/seed/{seed}/{width}/{height}
 * The /seed/{n}/ path makes images deterministic per seed.
 */
function generatePicsum(
  _prompt: string,
  config: PicsumProviderConfig,
  sequentialIndex: number,
): { imageUrl: string; metadata: Record<string, unknown> } {
  const width = config.width ?? 512
  const height = config.height ?? 512

  // Build a numeric seed. In random mode pick a fresh integer per call;
  // in sequential mode increment from seedStart.
  const useRandom = config.randomSeed ?? true
  const seed = useRandom
    ? Math.floor(Math.random() * 100_000)
    : (config.seedStart ?? 1) + sequentialIndex

  let url = `https://picsum.photos/seed/${seed}/${width}/${height}`
  const extras: string[] = []
  if (config.grayscale) extras.push('grayscale')
  if (config.blur !== undefined) extras.push(`blur=${config.blur}`)
  if (extras.length > 0) url += `?${extras.join('&')}`

  return {
    imageUrl: url,
    metadata: {
      provider: 'picsum',
      seed,
      width,
      height,
      grayscale: config.grayscale ?? false,
      blur: config.blur,
    },
  }
}

// ---------------------------------------------------------------------------
// Image Challenge Pool
// ---------------------------------------------------------------------------

/**
 * Manages a rotating pool of pre-generated image challenges.
 *
 * For production use, pre-generate images in batch (e.g., nightly cron)
 * and use the `static` provider to serve them. This avoids real-time
 * generation latency and API costs.
 *
 * For development/testing, use the `picsum` provider for instant, free
 * placeholder images, or the `pollinations` provider for real AI images
 * with no API key required.
 *
 * @example Pollinations.ai (recommended free default)
 * ```typescript
 * const pool = new ImageChallengePool({
 *   provider: { type: 'pollinations' },
 *   poolSize: 20,
 * })
 * await pool.initialize()
 * const challenge = pool.getChallenge()
 * ```
 *
 * @example Picsum (fast test/dev placeholder)
 * ```typescript
 * const pool = new ImageChallengePool({
 *   provider: { type: 'picsum' },
 *   poolSize: 10,
 * })
 * await pool.initialize()
 * ```
 */
export class ImageChallengePool {
  private readonly config: Required<
    Pick<
      ImageChallengePoolConfig,
      'poolSize' | 'challengeTypes' | 'rotationIntervalMs' | 'difficulty' | 'concurrency'
    >
  > & { provider: ImageProviderConfig }

  private pool: ImageChallenge[] = []
  private usedIds = new Set<string>()
  private rotationTimer?: ReturnType<typeof setInterval>
  private picsumSequentialIndex = 0

  constructor(config: ImageChallengePoolConfig) {
    this.config = {
      provider: config.provider,
      poolSize: config.poolSize ?? 50,
      challengeTypes: config.challengeTypes ?? [
        'object_count',
        'spatial_reasoning',
        'color_identification',
      ],
      rotationIntervalMs: config.rotationIntervalMs ?? 3_600_000,
      difficulty: config.difficulty ?? 'medium',
      concurrency: config.concurrency ?? 5,
    }
  }

  /**
   * Initialize the pool. For static providers, loads immediately.
   * For API providers, generates the initial batch.
   */
  async initialize(): Promise<void> {
    if (this.config.provider.type === 'static') {
      this.pool = this.config.provider.images.map((img, i) => ({
        id: `img_${Date.now()}_${i}`,
        type: img.type,
        imageUrl: img.imageUrl,
        question: img.question,
        answer: img.answer,
        generationPrompt: '(static)',
        generatedAt: Date.now(),
        difficulty: this.config.difficulty,
        acceptableAnswers: img.acceptableAnswers,
        metadata: img.metadata,
      }))
      return
    }

    await this.fillPool()

    // Start rotation timer
    if (this.config.rotationIntervalMs > 0) {
      this.rotationTimer = setInterval(() => {
        this.rotatePool()
      }, this.config.rotationIntervalMs)
      this.rotationTimer.unref?.()
    }
  }

  /**
   * Get a random challenge from the pool.
   * Marks it as used to avoid repetition within a session.
   */
  getChallenge(): ImageChallenge | null {
    const available = this.pool.filter((c) => !this.usedIds.has(c.id))
    if (available.length === 0) {
      // Reset used set if all have been used
      this.usedIds.clear()
      if (this.pool.length === 0) return null
      return this.pool[Math.floor(Math.random() * this.pool.length)]
    }

    const challenge = available[Math.floor(Math.random() * available.length)]
    this.usedIds.add(challenge.id)
    return challenge
  }

  /**
   * Verify an answer against an image challenge.
   * Supports fuzzy matching via acceptableAnswers.
   */
  verifyAnswer(challengeId: string, answer: string): boolean {
    const challenge = this.pool.find((c) => c.id === challengeId)
    if (!challenge) return false

    const normalizedAnswer = answer.trim().toLowerCase()
    const acceptable = [challenge.answer, ...(challenge.acceptableAnswers ?? [])].map((a) =>
      a.toLowerCase(),
    )

    return acceptable.includes(normalizedAnswer)
  }

  /** Get current pool size */
  get size(): number {
    return this.pool.length
  }

  /** Destroy the pool and stop rotation */
  destroy(): void {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer)
      this.rotationTimer = undefined
    }
    this.pool = []
    this.usedIds.clear()
  }

  // ---- Private helpers ----

  private async fillPool(): Promise<void> {
    const needed = this.config.poolSize - this.pool.length
    if (needed <= 0) return

    const batches = Math.ceil(needed / this.config.concurrency)
    for (let b = 0; b < batches; b++) {
      const batchSize = Math.min(this.config.concurrency, needed - b * this.config.concurrency)
      const promises = Array.from({ length: batchSize }, (_, i) =>
        this.generateOne(b * this.config.concurrency + i),
      )
      const results = await Promise.allSettled(promises)
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          this.pool.push(result.value)
        }
      }
    }
  }

  private async generateOne(index: number): Promise<ImageChallenge | null> {
    const type = pickRandom(this.config.challengeTypes)
    const template = IMAGE_CHALLENGE_TEMPLATES[type]
    if (!template) return null

    const { prompt, question, answer, acceptableAnswers } = template.generate(
      this.config.difficulty,
    )

    try {
      const { imageUrl, metadata } = await this.generateImage(prompt, index)
      return {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type,
        imageUrl,
        question,
        answer,
        generationPrompt: prompt,
        generatedAt: Date.now(),
        difficulty: this.config.difficulty,
        acceptableAnswers,
        metadata,
      }
    } catch {
      return null
    }
  }

  private async generateImage(
    prompt: string,
    index: number,
  ): Promise<{ imageUrl: string; metadata?: Record<string, unknown> }> {
    const provider = this.config.provider

    switch (provider.type) {
      case 'pollinations':
        return generatePollinations(prompt, provider)

      case 'picsum': {
        const result = generatePicsum(prompt, provider, this.picsumSequentialIndex + index)
        this.picsumSequentialIndex++
        return result
      }

      case 'custom':
        return provider.generate(prompt)

      case 'static':
        // Static provider is handled entirely in initialize(); this branch
        // is unreachable at runtime but satisfies the exhaustive type check.
        throw new Error('Static provider does not support dynamic generation')

      case 'openai':
        // OpenAI DALL-E integration is planned.
        // Use the 'custom' provider with your own OpenAI wrapper for now:
        //   provider: { type: 'custom', generate: async (p) => callDallE(p) }
        throw new Error(
          `OpenAI DALL-E provider: pass your API key via the 'custom' provider until direct integration ships. ` +
            `Example: { type: 'custom', generate: async (prompt) => callDallEWrapper(prompt) }`,
        )

      case 'stability':
        // Stability AI integration is planned.
        // Use the 'custom' provider with your own Stability wrapper for now.
        throw new Error(
          `Stability AI provider: pass your API key via the 'custom' provider until direct integration ships. ` +
            `Example: { type: 'custom', generate: async (prompt) => callStabilityWrapper(prompt) }`,
        )
    }
  }

  private async rotatePool(): Promise<void> {
    // Remove oldest 20% and regenerate
    const removeCount = Math.ceil(this.pool.length * 0.2)
    this.pool.splice(0, removeCount)
    this.usedIds.clear()
    await this.fillPool()
  }
}
