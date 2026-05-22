/**
 * Web Bot Auth — verify HTTP Message Signatures from AI agents.
 *
 * Implements verification for the IETF "Web Bot Auth" architecture
 * (draft-meunier-web-bot-auth-architecture) layered on RFC 9421 (HTTP Message
 * Signatures). An agent signs selected request components with an Ed25519 key and
 * publishes its public key in a `.well-known/http-message-signatures-directory`
 * (a JWK Set). This verifier reconstructs the signature base, fetches the key
 * directory, and verifies the Ed25519 signature.
 *
 * This is the cryptographic-identity counterpart to imrobot's challenge flow:
 * use it to recognise agents that already carry a Web Bot Auth signature
 * (e.g. OpenAI Operator, Cloudflare signed agents) instead of challenging them.
 *
 * Native `fetch` + Web Crypto (`crypto.subtle`). Zero external dependencies.
 * Requires a runtime with Ed25519 in Web Crypto (Node 20+, Deno, modern browsers).
 *
 * Supported covered components: `@method`, `@authority`, `@path`, `@query`, and
 * any HTTP header field. A single signature (the common Web Bot Auth case) is
 * verified — if multiple are present, the first is used.
 *
 * @example
 * ```typescript
 * import { WebBotAuthVerifier } from 'imrobot/server'
 *
 * const verifier = new WebBotAuthVerifier({
 *   directoryUrl: 'https://my-agent.example/.well-known/http-message-signatures-directory',
 * })
 *
 * const result = await verifier.verify(req)
 * if (result.verified) {
 *   // trusted signed agent — skip the challenge
 * }
 * ```
 */

const DEFAULT_MAX_AGE_SECONDS = 300
const DEFAULT_TAG = 'web-bot-auth'
const DEFAULT_DIRECTORY_CACHE_MS = 300_000
const CLOCK_SKEW_SECONDS = 60

/** Configuration for {@link WebBotAuthVerifier}. */
export interface WebBotAuthConfig {
  /**
   * URL of the agent's key directory — its
   * `.well-known/http-message-signatures-directory` (a JWK Set, `{ keys: [...] }`).
   */
  directoryUrl: string
  /**
   * Maximum age (seconds) between the signature's `created` time and now, used
   * when the signature has no explicit `expires`. Default: 300.
   */
  maxAgeSeconds?: number
  /**
   * Required `tag` parameter. Default: `'web-bot-auth'`. Set to `null` to skip
   * the tag check entirely.
   */
  expectedTag?: string | null
  /** How long to cache the fetched directory, in ms. Default: 300000 (5 min). */
  directoryCacheMs?: number
}

/** Reasons a Web Bot Auth verification can fail. */
export type WebBotAuthFailReason =
  | 'no_signature'
  | 'malformed'
  | 'unsupported_component'
  | 'unsupported_alg'
  | 'tag_mismatch'
  | 'not_yet_valid'
  | 'expired'
  | 'unknown_key'
  | 'directory_error'
  | 'bad_signature'

/** Result of a Web Bot Auth verification. */
export interface WebBotAuthResult {
  /** Whether the signature verified against a key in the directory. */
  verified: boolean
  /** The `keyid` parameter from the signature, if present. */
  keyid?: string
  /** The `tag` parameter from the signature, if present. */
  tag?: string
  /** The `created` parameter (Unix seconds), if present. */
  created?: number
  /** The `expires` parameter (Unix seconds), if present. */
  expires?: number
  /** Failure reason when `verified` is false. */
  reason?: WebBotAuthFailReason
}

/**
 * Minimal request shape needed to reconstruct the signature base.
 * Compatible with {@link MiddlewareRequest} (Express, Koa, raw Node, etc.).
 */
export interface SignedHttpRequest {
  method?: string
  /** Request target — path with optional query string, e.g. `/api/data?x=1`. */
  url?: string
  headers: Record<string, string | string[] | undefined>
}

interface SignatureInputParams {
  created?: number
  expires?: number
  keyid?: string
  alg?: string
  tag?: string
  nonce?: string
}

interface ParsedSignatureInput {
  label: string
  /** Covered component names, lowercased, without surrounding quotes. */
  components: string[]
  /** The exact `(...)` + params string — the `@signature-params` value. */
  rawParams: string
  params: SignatureInputParams
}

interface JsonWebKey {
  kty?: string
  crv?: string
  x?: string
  kid?: string
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name.toLowerCase()]
  if (v === undefined) return undefined
  return Array.isArray(v) ? v.join(', ') : v
}

/** Cut a Signature-Input dictionary down to its first member. */
function firstSignatureMember(value: string): string {
  const m = value.match(/,\s*[A-Za-z0-9_-]+=\(/)
  return m && m.index !== undefined ? value.slice(0, m.index) : value
}

/** Parse a Signature-Input header value (single signature). */
export function parseSignatureInput(value: string): ParsedSignatureInput | null {
  const member = firstSignatureMember(value).trim()
  const eq = member.indexOf('=')
  if (eq <= 0) return null

  const label = member.slice(0, eq).trim()
  const rawParams = member.slice(eq + 1).trim() // '("@authority" ...);created=...;...'
  if (!rawParams.startsWith('(')) return null

  const close = rawParams.indexOf(')')
  if (close === -1) return null

  const inner = rawParams.slice(1, close).trim()
  const paramStr = rawParams.slice(close + 1)

  const components: string[] = []
  if (inner.length > 0) {
    for (const token of inner.split(/\s+/)) {
      const nameMatch = token.match(/^"([^"]*)"$/)
      // Component-level params (e.g. "@query-param";name="x") are not supported.
      if (!nameMatch) return null
      components.push(nameMatch[1].toLowerCase())
    }
  }

  const params: SignatureInputParams = {}
  for (const part of paramStr.split(';')) {
    const seg = part.trim()
    if (!seg) continue
    const i = seg.indexOf('=')
    if (i === -1) continue
    const key = seg.slice(0, i).trim()
    const rawVal = seg.slice(i + 1).trim()
    if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
      const strVal = rawVal.slice(1, -1)
      if (key === 'keyid') params.keyid = strVal
      else if (key === 'alg') params.alg = strVal
      else if (key === 'tag') params.tag = strVal
      else if (key === 'nonce') params.nonce = strVal
    } else if (/^\d+$/.test(rawVal)) {
      const num = Number(rawVal)
      if (key === 'created') params.created = num
      else if (key === 'expires') params.expires = num
    }
  }

  return { label, components, rawParams, params }
}

/** Resolve a single covered component to its value, or undefined if unsupported/missing. */
function resolveComponent(name: string, req: SignedHttpRequest): string | undefined {
  if (name.startsWith('@')) {
    switch (name) {
      case '@method':
        return (req.method ?? '').toUpperCase()
      case '@authority':
        return headerValue(req.headers, 'host')?.toLowerCase()
      case '@path': {
        const url = req.url ?? '/'
        const q = url.indexOf('?')
        const path = q === -1 ? url : url.slice(0, q)
        return path === '' ? '/' : path
      }
      case '@query': {
        const url = req.url ?? ''
        const q = url.indexOf('?')
        return q === -1 ? '?' : url.slice(q)
      }
      default:
        // @target-uri, @scheme, @request-target, @status, etc. need transport
        // details we don't have framework-agnostically.
        return undefined
    }
  }
  return headerValue(req.headers, name)
}

/** Reconstruct the RFC 9421 signature base, or null if a component is unsupported/missing. */
export function buildSignatureBase(
  parsed: ParsedSignatureInput,
  req: SignedHttpRequest,
): string | null {
  const lines: string[] = []
  for (const comp of parsed.components) {
    const value = resolveComponent(comp, req)
    if (value === undefined) return null
    lines.push(`"${comp}": ${value}`)
  }
  lines.push(`"@signature-params": ${parsed.rawParams}`)
  return lines.join('\n')
}

/** UTF-8 encode into an ArrayBuffer-backed view (avoids SharedArrayBuffer typing). */
function utf8Bytes(str: string): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder().encode(str)
  const out = new Uint8Array(enc.byteLength)
  out.set(enc)
  return out
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64')
    const bytes = new Uint8Array(buf.byteLength)
    bytes.set(buf)
    return bytes
  }
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Extract the raw signature bytes for a given label from a Signature header. */
function extractSignature(signatureHeader: string, label: string): Uint8Array<ArrayBuffer> | null {
  // sf-binary: label=:base64:
  const re = new RegExp(`(?:^|,)\\s*${label}=:([^:]*):`)
  const m = signatureHeader.match(re)
  if (!m) return null
  try {
    return base64ToBytes(m[1])
  } catch {
    return null
  }
}

interface DirectoryCacheEntry {
  fetchedAt: number
  keys: JsonWebKey[]
}

/**
 * Verifies Web Bot Auth HTTP Message Signatures against a published key directory.
 *
 * The directory is fetched lazily and cached (default 5 min). Zero external
 * dependencies — Ed25519 verification uses Web Crypto.
 */
export class WebBotAuthVerifier {
  private readonly config: WebBotAuthConfig
  private cache?: DirectoryCacheEntry

  constructor(config: WebBotAuthConfig) {
    if (!config.directoryUrl || config.directoryUrl.trim().length === 0) {
      throw new Error('WebBotAuthVerifier: directoryUrl is required.')
    }
    this.config = config
  }

  /**
   * Verify the Web Bot Auth signature on a request.
   */
  async verify(req: SignedHttpRequest): Promise<WebBotAuthResult> {
    const sigInputRaw = headerValue(req.headers, 'signature-input')
    const sigRaw = headerValue(req.headers, 'signature')
    if (!sigInputRaw || !sigRaw) {
      return { verified: false, reason: 'no_signature' }
    }

    const parsed = parseSignatureInput(sigInputRaw)
    if (!parsed) {
      return { verified: false, reason: 'malformed' }
    }

    const expectedTag =
      this.config.expectedTag === undefined ? DEFAULT_TAG : this.config.expectedTag
    if (expectedTag !== null && parsed.params.tag !== expectedTag) {
      return { verified: false, reason: 'tag_mismatch', tag: parsed.params.tag }
    }

    if (parsed.params.alg && parsed.params.alg !== 'ed25519') {
      return { verified: false, reason: 'unsupported_alg' }
    }

    const timing = this.checkTiming(parsed.params)
    if (timing) {
      return {
        verified: false,
        reason: timing,
        created: parsed.params.created,
        expires: parsed.params.expires,
      }
    }

    const sigBytes = extractSignature(sigRaw, parsed.label)
    if (!sigBytes) {
      return { verified: false, reason: 'malformed' }
    }

    const base = buildSignatureBase(parsed, req)
    if (base === null) {
      return { verified: false, reason: 'unsupported_component' }
    }

    let key: CryptoKey | null
    try {
      key = await this.resolveKey(parsed.params.keyid)
    } catch {
      return { verified: false, reason: 'directory_error' }
    }
    if (!key) {
      return { verified: false, reason: 'unknown_key', keyid: parsed.params.keyid }
    }

    let ok = false
    try {
      ok = await crypto.subtle.verify('Ed25519', key, sigBytes, utf8Bytes(base))
    } catch {
      return { verified: false, reason: 'bad_signature', keyid: parsed.params.keyid }
    }

    if (!ok) {
      return { verified: false, reason: 'bad_signature', keyid: parsed.params.keyid }
    }

    return {
      verified: true,
      keyid: parsed.params.keyid,
      tag: parsed.params.tag,
      created: parsed.params.created,
      expires: parsed.params.expires,
    }
  }

  private checkTiming(params: SignatureInputParams): 'not_yet_valid' | 'expired' | undefined {
    const now = Math.floor(Date.now() / 1000)
    if (params.created !== undefined && params.created > now + CLOCK_SKEW_SECONDS) {
      return 'not_yet_valid'
    }
    if (params.expires !== undefined) {
      if (now > params.expires + CLOCK_SKEW_SECONDS) return 'expired'
    } else if (params.created !== undefined) {
      const maxAge = this.config.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS
      if (now - params.created > maxAge) return 'expired'
    }
    return undefined
  }

  private async resolveKey(keyid: string | undefined): Promise<CryptoKey | null> {
    const keys = await this.fetchDirectory()
    let jwk: JsonWebKey | undefined
    if (keyid) {
      jwk = keys.find((k) => k.kid === keyid)
    }
    // Fall back to the sole key when no keyid match (single-key directories).
    if (!jwk && keys.length === 1) {
      jwk = keys[0]
    }
    if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) {
      return null
    }

    try {
      return await crypto.subtle.importKey(
        'jwk',
        { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
        { name: 'Ed25519' },
        false,
        ['verify'],
      )
    } catch {
      return null
    }
  }

  private async fetchDirectory(): Promise<JsonWebKey[]> {
    const ttl = this.config.directoryCacheMs ?? DEFAULT_DIRECTORY_CACHE_MS
    if (this.cache && Date.now() - this.cache.fetchedAt < ttl) {
      return this.cache.keys
    }

    const response = await fetch(this.config.directoryUrl, {
      headers: {
        accept: 'application/http-message-signatures-directory+json, application/json',
      },
    })
    const data = (await response.json()) as { keys?: JsonWebKey[] }
    const keys = Array.isArray(data?.keys) ? data.keys : []
    this.cache = { fetchedAt: Date.now(), keys }
    return keys
  }
}

/**
 * Verify a Web Bot Auth signature without holding a verifier instance.
 *
 * Standalone counterpart to {@link WebBotAuthVerifier} — no directory caching
 * across calls. Prefer the class for repeated verifications.
 */
export async function verifyWebBotAuthSignature(
  req: SignedHttpRequest,
  config: WebBotAuthConfig,
): Promise<WebBotAuthResult> {
  return new WebBotAuthVerifier(config).verify(req)
}
