/**
 * Web Bot Auth — verify HTTP Message Signatures from AI agents.
 *
 * Implements the verifier side of draft-ietf-webbotauth-httpsig-protocol-01
 * (2026-10-29) on top of RFC 9421 (HTTP Message Signatures):
 *
 * - `Signature-Agent` discovery: a Dictionary whose member (keyed by the
 *   signature label) is an https URL of the agent's JWK Set. The legacy bare
 *   sf-string form is accepted too. Only the covered member is used.
 * - Key-directory fetch + cache: no redirects, 5 s timeout, 64 kB / 100-key
 *   caps, HTTP `Cache-Control: max-age` honoured (clamped 60 s .. 24 h), stale
 *   entries survive a failed refetch, negative entries expire after 60 s.
 * - Signature-Input checks: `tag="web-bot-auth"`, `created`, `expires`
 *   (both required), `keyid` = RFC 7638 JWK thumbprint, optional `alg`
 *   must be `ed25519`, `@authority` (or `@target-uri`) must be covered.
 * - `nonce` replay check with a pluggable store (atomic check-and-record).
 * - Optional signed directory responses (`tag="http-message-signatures-directory"`,
 *   `("@authority";req "content-digest")`, draft -01 Appendix B.1).
 *
 * Use it to recognise agents that carry a Web Bot Auth signature and let them
 * skip the imrobot challenge (see {@link evaluateWebBotAuth}).
 *
 * Native `fetch` + Web Crypto. Zero external dependencies. Needs Ed25519 in
 * Web Crypto (Node 20+, Deno, Bun, Cloudflare Workers, modern browsers).
 *
 * @example Trust a known set of agents (recommended)
 * ```typescript
 * import { WebBotAuthVerifier } from 'imrobot/server'
 *
 * const verifier = new WebBotAuthVerifier({
 *   trustedSignatureAgents: ['https://agent.example'],
 * })
 * const result = await verifier.verify(req)
 * if (result.verified) {
 *   // signed agent: skip the challenge
 * }
 * ```
 */

import {
  parseDictionary,
  parseItem,
  serializeBareItem,
  serializeMember,
  serializeParams,
  StructuredFieldError,
  type InnerList,
  type Item,
  type Member,
} from './structured-fields'
import {
  base64ToBytes,
  contentDigest,
  jwkThumbprint,
  KNOWN_TEST_KEY_X,
  timingSafeEqualStr,
  utf8Bytes,
} from './wba-crypto'

const DEFAULT_TAG = 'web-bot-auth'
const DIRECTORY_TAG = 'http-message-signatures-directory'
/** Max signature age counted from `created` (draft -01: expires SHOULD be <= 24 h after created). */
const DEFAULT_MAX_AGE_SECONDS = 86_400
const DEFAULT_CLOCK_SKEW_SECONDS = 60
const DEFAULT_DIRECTORY_CACHE_MS = 300_000
const MIN_DIRECTORY_CACHE_MS = 60_000
const MAX_DIRECTORY_CACHE_MS = 86_400_000
const NEGATIVE_CACHE_MS = 60_000
const UNKNOWN_KEY_REFETCH_MS = 60_000
const FETCH_TIMEOUT_MS = 5_000
const MAX_DIRECTORY_BYTES = 64_000
const MAX_DIRECTORY_KEYS = 100
const MAX_CACHED_DIRECTORIES = 256
const MAX_SIGNATURE_CANDIDATES = 4
export const WELL_KNOWN_DIRECTORY_PATH = '/.well-known/http-message-signatures-directory'
export const DIRECTORY_MEDIA_TYPE = 'application/http-message-signatures-directory+json'

/**
 * Value for an `Accept-Signature` response header (RFC 9421 5.1) telling a
 * client what a Web Bot Auth signature must look like. draft -01 5.3: a
 * refusal SHOULD include it.
 */
export const WEB_BOT_AUTH_ACCEPT_SIGNATURE =
  'sig1=("@authority" "signature-agent";key="sig1");created;expires;keyid;tag="web-bot-auth"'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Atomic check-and-record store for signature nonces. */
export interface WebBotAuthNonceStore {
  /**
   * Record `key` for `ttlMs` milliseconds. Return true when the key was new,
   * false when it is still recorded (a replay). Redis: `SET key 1 NX PX ttlMs`.
   */
  checkAndRecord(key: string, ttlMs: number): boolean | Promise<boolean>
}

/** In-process nonce store (bounded). Use a shared store across workers. */
export class MemoryNonceStore implements WebBotAuthNonceStore {
  private readonly seen = new Map<string, number>()
  constructor(private readonly capacity = 100_000) {}

  checkAndRecord(key: string, ttlMs: number): boolean {
    const now = Date.now()
    const expiresAtMs = now + Math.max(0, ttlMs)
    const prev = this.seen.get(key)
    if (prev !== undefined && prev > now) return false
    if (this.seen.size >= this.capacity) this.sweep(now)
    if (this.seen.size >= this.capacity) {
      // Still full of live entries: drop the oldest insertion.
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    this.seen.delete(key)
    this.seen.set(key, expiresAtMs)
    return true
  }

  private sweep(now: number): void {
    for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k)
  }
}

/** Configuration for {@link WebBotAuthVerifier}. */
export interface WebBotAuthConfig {
  /**
   * Pinned key directory (a JWK Set URL). Every signature is checked against
   * this directory only; `Signature-Agent` is not used for key lookup.
   */
  directoryUrl?: string
  /**
   * Discovery allow-list: agent identifiers (JWK Set URLs) or origins whose
   * `Signature-Agent` URLs may be fetched. An origin entry (`https://agent.example`)
   * matches any URL on that origin.
   */
  trustedSignatureAgents?: string[]
  /**
   * Fetch the key directory of ANY https `Signature-Agent` (except IP-literal
   * private/loopback/link-local hosts and `localhost`). Hostnames that resolve
   * to private addresses cannot be detected from portable JS: prefer
   * `trustedSignatureAgents` on servers that can reach internal services.
   * Default: false.
   */
  allowAnySignatureAgent?: boolean
  /** Required `tag`. Default `'web-bot-auth'`; `null` accepts any tag. */
  expectedTag?: string | null
  /** Verify only this Signature-Input label (default: every member with the expected tag). */
  label?: string
  /** Maximum age of a signature, counted from `created`. Default 86400 (24 h). */
  maxAgeSeconds?: number
  /** Allowed clock skew in seconds for `created` / `expires`. Default 60. */
  clockSkewSeconds?: number
  /** Directory cache lifetime when the response has no usable `max-age`. Default 300000 (5 min). */
  directoryCacheMs?: number
  /** Nonce replay store. Default: an in-process {@link MemoryNonceStore}. `false` disables it. */
  nonceStore?: WebBotAuthNonceStore | false
  /** Reject signatures without a `nonce`. Default false. */
  requireNonce?: boolean
  /**
   * Reject the published RFC 9421 / RFC 8037 test keys (draft -01 6.8 SHOULD).
   * Default true. Tests that use the spec vectors set this to false.
   */
  rejectTestKeys?: boolean
  /**
   * Only accept directory keys that carry a valid directory response signature
   * (draft -01 Appendix B.1). Default false (optional in -01).
   */
  requireSignedDirectory?: boolean
  /** `fetch` implementation (default: global fetch). */
  fetch?: typeof fetch
  /** Clock in Unix seconds (tests). Default: `Date.now() / 1000`. */
  now?: () => number
}

/** Reasons a Web Bot Auth verification can fail. */
export type WebBotAuthFailReason =
  | 'no_signature'
  | 'malformed'
  | 'missing_param'
  | 'unsupported_component'
  | 'missing_authority'
  | 'missing_signature_agent'
  | 'untrusted_agent'
  | 'unsupported_alg'
  | 'tag_mismatch'
  | 'not_yet_valid'
  | 'expired'
  | 'missing_nonce'
  | 'replayed_nonce'
  | 'unknown_key'
  | 'test_key'
  | 'directory_error'
  | 'bad_signature'

/**
 * `verified`: the signature checks out. `invalid`: a signature is present but
 * wrong (tampered, expired, replayed, malformed). `unverified`: no signature,
 * or it could not be checked (untrusted agent, directory unreachable, key not
 * found). draft -01 Appendix C.1 asks to keep the three apart.
 */
export type WebBotAuthOutcome = 'verified' | 'invalid' | 'unverified'

/** Result of a Web Bot Auth verification. */
export interface WebBotAuthResult {
  verified: boolean
  outcome: WebBotAuthOutcome
  reason?: WebBotAuthFailReason
  /** Signature-Input label that was checked. */
  label?: string
  /** `keyid` parameter (RFC 7638 thumbprint of the agent key). */
  keyid?: string
  tag?: string
  created?: number
  expires?: number
  nonce?: string
  /** Agent identifier: the resolved `Signature-Agent` URL (query dropped), or the pinned directory URL. */
  agent?: string
}

/**
 * Minimal request shape needed to rebuild the signature base. Compatible with
 * `MiddlewareRequest` (Express, Koa, raw Node). For Fetch API requests use
 * {@link signedRequestFromFetch}.
 */
export interface SignedHttpRequest {
  method?: string
  /** Request target — path with optional query (e.g. `/api?x=1`) or an absolute URL. */
  url?: string
  /** Express keeps the full path here when the router is mounted on a prefix. */
  originalUrl?: string
  headers: Record<string, string | string[] | undefined>
  /** `host[:port]` override when the Host header is not available. */
  authority?: string
  /** `http` / `https`, needed only for `@target-uri` / `@scheme`. */
  scheme?: string
}

interface SignatureInputParams {
  created?: number
  expires?: number
  keyid?: string
  alg?: string
  tag?: string
  nonce?: string
}

/** One parsed Signature-Input member. */
export interface ParsedSignatureInput {
  label: string
  /** Covered component names, lowercased, without quotes or parameters. */
  components: string[]
  /** Covered components with their parameters (e.g. `"signature-agent";key="sig1"`). */
  componentItems: Item[]
  /** Exact `(...)` + params text: the `@signature-params` value. */
  rawParams: string
  params: SignatureInputParams
}

interface Ed25519Jwk {
  kty?: string
  crv?: string
  x?: string
  kid?: string
  nbf?: number
  exp?: number
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase()
  let v = headers[lower]
  if (v === undefined) {
    // Some frameworks keep the original casing.
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) {
        v = headers[k]
        break
      }
    }
  }
  if (v === undefined) return undefined
  // RFC 9421 2.1: trim each field line, join multiple lines with ", ".
  return Array.isArray(v) ? v.map((s) => s.trim()).join(', ') : v.trim()
}

function stringParam(m: Member, key: string): string | undefined {
  const p = m.params.get(key)
  return p?.type === 'string' ? p.value : undefined
}

function integerParam(m: Member, key: string): number | undefined {
  const p = m.params.get(key)
  return p?.type === 'integer' ? p.value : undefined
}

function toParsed(label: string, member: Member): ParsedSignatureInput | null {
  if (member.kind !== 'inner-list') return null
  const list = member as InnerList & { raw: string }
  const components: string[] = []
  for (const item of list.items) {
    if (item.value.type !== 'string') return null
    components.push(item.value.value.toLowerCase())
  }
  return {
    label,
    components,
    componentItems: list.items,
    rawParams: member.raw,
    params: {
      created: integerParam(member, 'created'),
      expires: integerParam(member, 'expires'),
      keyid: stringParam(member, 'keyid'),
      alg: stringParam(member, 'alg'),
      tag: stringParam(member, 'tag'),
      nonce: stringParam(member, 'nonce'),
    },
  }
}

/** Parse every member of a Signature-Input header. Returns null when malformed. */
export function parseSignatureInputs(value: string): ParsedSignatureInput[] | null {
  let dict: Map<string, Member>
  try {
    dict = parseDictionary(value)
  } catch (e) {
    if (e instanceof StructuredFieldError) return null
    throw e
  }
  const out: ParsedSignatureInput[] = []
  for (const [label, member] of dict) {
    const parsed = toParsed(label, member)
    if (!parsed) return null
    out.push(parsed)
  }
  return out
}

/**
 * Parse one Signature-Input member: the given `label`, or the first member.
 * Returns null when the header is malformed or the label is absent.
 */
export function parseSignatureInput(value: string, label?: string): ParsedSignatureInput | null {
  const all = parseSignatureInputs(value)
  if (!all || all.length === 0) return null
  if (label === undefined) return all[0]
  return all.find((p) => p.label === label) ?? null
}

const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i

function pathAndQuery(req: SignedHttpRequest): { path: string; query: string } {
  let target = req.originalUrl ?? req.url ?? '/'
  if (ABSOLUTE_URL.test(target)) {
    const u = new URL(target)
    target = u.pathname + u.search
  }
  const q = target.indexOf('?')
  const path = q === -1 ? target : target.slice(0, q)
  return { path: path === '' ? '/' : path, query: q === -1 ? '?' : target.slice(q) }
}

function authorityOf(req: SignedHttpRequest): string | undefined {
  const raw = headerValue(req.headers, 'host') ?? req.authority
  if (!raw && req.url && ABSOLUTE_URL.test(req.url)) return new URL(req.url).host
  return raw?.toLowerCase()
}

function schemeOf(req: SignedHttpRequest): string | undefined {
  if (req.scheme) return req.scheme.toLowerCase()
  if (req.url && /^https?:\/\//i.test(req.url)) return new URL(req.url).protocol.slice(0, -1)
  return undefined
}

/** Value of one covered component, or undefined when unsupported / absent. */
function resolveComponent(item: Item, req: SignedHttpRequest): string | undefined {
  if (item.value.type !== 'string') return undefined
  const name = item.value.value.toLowerCase()
  const keyParam = item.params.get('key')
  const otherParams = [...item.params.keys()].filter((k) => k !== 'key')
  if (otherParams.length > 0) return undefined // ;sf ;bs ;req ;tr ;name: not supported on requests

  if (name.startsWith('@')) {
    if (keyParam) return undefined
    switch (name) {
      case '@method':
        return (req.method ?? 'GET').toUpperCase()
      case '@authority':
        return authorityOf(req)
      case '@path':
        return pathAndQuery(req).path
      case '@query':
        return pathAndQuery(req).query
      case '@scheme':
        return schemeOf(req)
      case '@target-uri': {
        const scheme = schemeOf(req)
        const authority = authorityOf(req)
        if (!scheme || !authority) return undefined
        const { path, query } = pathAndQuery(req)
        return `${scheme}://${authority}${path}${query === '?' ? '' : query}`
      }
      default:
        return undefined
    }
  }

  const raw = headerValue(req.headers, name)
  if (raw === undefined) return undefined
  if (!keyParam) return raw
  if (keyParam.type !== 'string') return undefined
  // Dictionary member (RFC 9421 2.1.2). Legacy sf-string Signature-Agent has no members.
  try {
    const member = parseDictionary(raw).get(keyParam.value)
    return member ? serializeMember(member) : undefined
  } catch {
    return undefined
  }
}

/** `"name";key="x"` with the component name lowercased (RFC 9421 2.1). */
function componentIdentifier(item: Item): string {
  const name =
    item.value.type === 'string'
      ? { ...item.value, value: item.value.value.toLowerCase() }
      : item.value
  return serializeBareItem(name) + serializeParams(item.params)
}

/** Rebuild the RFC 9421 signature base, or null when a component is unsupported / missing. */
export function buildSignatureBase(
  parsed: ParsedSignatureInput,
  req: SignedHttpRequest,
): string | null {
  const lines: string[] = []
  for (const item of parsed.componentItems) {
    const value = resolveComponent(item, req)
    if (value === undefined) return null
    lines.push(`${componentIdentifier(item)}: ${value}`)
  }
  lines.push(`"@signature-params": ${parsed.rawParams}`)
  return lines.join('\n')
}

/**
 * Build a {@link SignedHttpRequest} from a Fetch API `Request` (Hono, Next.js
 * App Router, Workers, Deno, Bun).
 */
export function signedRequestFromFetch(request: {
  method?: string
  url: string
  headers: {
    forEach?(cb: (value: string, key: string) => void): void
    get?(name: string): string | null
  }
}): SignedHttpRequest {
  const headers: Record<string, string> = {}
  if (typeof request.headers.forEach === 'function') {
    request.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
  } else if (typeof request.headers.get === 'function') {
    // Header bags without iteration: read the fields Web Bot Auth signs. A
    // signature covering anything else fails closed (bad_signature).
    for (const name of FETCH_FALLBACK_HEADERS) {
      const v = request.headers.get(name)
      if (v !== null && v !== undefined) headers[name] = v
    }
  }
  const u = new URL(request.url)
  return {
    method: request.method ?? 'GET',
    url: u.pathname + u.search,
    headers,
    authority: u.host,
    scheme: u.protocol.slice(0, -1),
  }
}

const FETCH_FALLBACK_HEADERS = [
  'signature',
  'signature-input',
  'signature-agent',
  'host',
  'content-digest',
  'content-type',
  'content-length',
  'user-agent',
  'date',
]

// ---------------------------------------------------------------------------
// Signature-Agent
// ---------------------------------------------------------------------------

type AgentLookup =
  | { ok: true; url: URL }
  | { ok: false; reason: WebBotAuthFailReason }
  | { ok: 'absent' }

/** Resolve the Signature-Agent URL a signature covers (draft -01 5.2.1). */
function resolveSignatureAgent(parsed: ParsedSignatureInput, req: SignedHttpRequest): AgentLookup {
  const covered = parsed.componentItems.filter(
    (i) => i.value.type === 'string' && i.value.value.toLowerCase() === 'signature-agent',
  )
  const raw = headerValue(req.headers, 'signature-agent')
  if (covered.length === 0) {
    return raw === undefined ? { ok: 'absent' } : { ok: false, reason: 'missing_signature_agent' }
  }
  if (covered.length > 1 || raw === undefined)
    return { ok: false, reason: 'missing_signature_agent' }

  const keyParam = covered[0].params.get('key')
  let value: string | undefined
  try {
    if (raw.startsWith('"')) {
      // Legacy bare sf-string: only valid when covered without a key.
      if (keyParam) return { ok: false, reason: 'missing_signature_agent' }
      const item = parseItem(raw)
      if (item.value.type === 'string' && item.params.size === 0) value = item.value.value
    } else {
      if (!keyParam || keyParam.type !== 'string')
        return { ok: false, reason: 'missing_signature_agent' }
      const member = parseDictionary(raw).get(keyParam.value)
      // A member that carries parameters MUST be ignored (draft -01 5.2.1).
      if (
        member &&
        member.kind === 'item' &&
        member.value.type === 'string' &&
        member.params.size === 0
      ) {
        value = member.value.value
      }
    }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (value === undefined) return { ok: false, reason: 'missing_signature_agent' }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    return { ok: false, reason: 'untrusted_agent' }
  url.search = ''
  url.hash = ''
  return { ok: true, url }
}

/** IP-literal private / loopback / link-local hosts and localhost (draft -01 6.7). */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal')
  )
    return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (v4) {
    const a = Number(v4[1])
    const b = Number(v4[2])
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    )
  }
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true
    if (/^f[cd]/.test(h) || /^fe[89ab]/.test(h)) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
    if (mapped) return isPrivateHost(mapped[1])
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(h)) return true // mapped, hex form: refuse
    return false
  }
  return false
}

interface TrustedAgent {
  origin: string
  href: string
  originOnly: boolean
}

function normalizeTrusted(entry: string): TrustedAgent | null {
  try {
    const u = new URL(entry)
    if (u.protocol !== 'https:') return null
    u.search = ''
    u.hash = ''
    return { origin: u.origin, href: u.href, originOnly: u.pathname === '/' }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Directory fetch + cache
// ---------------------------------------------------------------------------

interface DirectoryEntry {
  ok: boolean
  /** thumbprint -> x */
  keys: Map<string, string>
  expiresAt: number
  lastRefetchAt: number
}

class DirectoryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

interface RawResponse {
  status?: number
  ok?: boolean
  headers?: { get(name: string): string | null }
  body?: ReadableStream<Uint8Array> | null
  text?: () => Promise<string>
  json?: () => Promise<unknown>
}

async function readCapped(res: RawResponse): Promise<string> {
  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_DIRECTORY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new DirectoryError('directory too large')
      }
      chunks.push(value)
    }
    const all = new Uint8Array(total)
    let off = 0
    for (const c of chunks) {
      all.set(c, off)
      off += c.byteLength
    }
    return new TextDecoder().decode(all)
  }
  if (typeof res.text === 'function') {
    const t = await res.text()
    if (utf8Bytes(t).byteLength > MAX_DIRECTORY_BYTES)
      throw new DirectoryError('directory too large')
    return t
  }
  if (typeof res.json === 'function') return JSON.stringify(await res.json())
  throw new DirectoryError('unreadable directory response')
}

function cacheLifetimeMs(headers: RawResponse['headers'], fallback: number): number {
  const cc = headers?.get('cache-control') ?? ''
  if (/\b(no-store|no-cache)\b/i.test(cc)) return MIN_DIRECTORY_CACHE_MS
  const m = /\bmax-age=(\d+)/i.exec(cc)
  const ms = m ? Number(m[1]) * 1000 : fallback
  return Math.min(MAX_DIRECTORY_CACHE_MS, Math.max(MIN_DIRECTORY_CACHE_MS, ms))
}

async function ed25519Verify(x: string, signatureB64: string, base: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x },
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify('Ed25519', key, base64ToBytes(signatureB64), utf8Bytes(base))
  } catch {
    return false
  }
}

/**
 * Verify the per-key signatures on a key-directory response (draft -01
 * Appendix B.1). Returns the thumbprints whose key produced a valid
 * `tag="http-message-signatures-directory"` signature over
 * `("@authority";req "content-digest")`, with a Content-Digest that matches the body.
 */
export async function verifyDirectoryResponse(input: {
  body: string
  headers: { get(name: string): string | null }
  /** Authority of the request that fetched the directory (`host[:port]`). */
  authority: string
  /** thumbprint -> x for the keys in the body. */
  keys: Map<string, string>
  /** Unix seconds. */
  now?: number
  clockSkewSeconds?: number
}): Promise<Set<string>> {
  const verified = new Set<string>()
  const sigInput = input.headers.get('signature-input')
  const sig = input.headers.get('signature')
  const digest = input.headers.get('content-digest')?.trim()
  if (!sigInput || !sig || !digest) return verified
  if (!timingSafeEqualStr(digest, await contentDigest(input.body))) return verified
  const parsedAll = parseSignatureInputs(sigInput)
  if (!parsedAll) return verified
  let sigDict: Map<string, Member>
  try {
    sigDict = parseDictionary(sig)
  } catch {
    return verified
  }
  const now = input.now ?? Math.floor(Date.now() / 1000)
  const skew = input.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
  for (const parsed of parsedAll.slice(0, MAX_DIRECTORY_KEYS)) {
    const p = parsed.params
    if (p.tag !== DIRECTORY_TAG || !p.keyid || p.created === undefined || p.expires === undefined)
      continue
    if (p.created > now + skew || p.expires < now - skew) continue
    if (p.alg !== undefined && p.alg !== 'ed25519') continue
    const x = input.keys.get(p.keyid)
    const member = sigDict.get(parsed.label)
    if (!x || !member || member.kind !== 'item' || member.value.type !== 'binary') continue
    const lines: string[] = []
    const seen = new Set<string>()
    let ok = true
    for (const item of parsed.componentItems) {
      const id = componentIdentifier(item)
      seen.add(id)
      if (id === '"@authority";req') lines.push(`${id}: ${input.authority.toLowerCase()}`)
      else if (id === '"content-digest"') lines.push(`${id}: ${digest}`)
      else ok = false
    }
    if (!ok || !seen.has('"@authority";req') || !seen.has('"content-digest"')) continue
    lines.push(`"@signature-params": ${parsed.rawParams}`)
    if (await ed25519Verify(x, member.value.value, lines.join('\n'))) verified.add(p.keyid)
  }
  return verified
}

// ---------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------

const UNVERIFIED_REASONS: ReadonlySet<WebBotAuthFailReason> = new Set([
  'no_signature',
  'untrusted_agent',
  'directory_error',
  'unknown_key',
])

function fail(
  reason: WebBotAuthFailReason,
  extra: Partial<WebBotAuthResult> = {},
): WebBotAuthResult {
  return {
    ...extra,
    verified: false,
    outcome: UNVERIFIED_REASONS.has(reason) ? 'unverified' : 'invalid',
    reason,
  }
}

/**
 * Verifies Web Bot Auth signatures (draft-ietf-webbotauth-httpsig-protocol-01).
 * Hold one instance per process: it caches key directories and nonces.
 */
export class WebBotAuthVerifier {
  private readonly config: WebBotAuthConfig
  private readonly trusted: TrustedAgent[]
  private readonly cache = new Map<string, DirectoryEntry>()
  private readonly inflight = new Map<string, Promise<DirectoryEntry>>()
  private readonly nonceStore: WebBotAuthNonceStore | undefined

  constructor(config: WebBotAuthConfig) {
    const pinned = config.directoryUrl
    const trusted = (config.trustedSignatureAgents ?? []).map(normalizeTrusted)
    if (trusted.some((t) => t === null)) {
      throw new Error(
        'WebBotAuthVerifier: trustedSignatureAgents entries must be absolute https URLs.',
      )
    }
    if (pinned !== undefined && pinned.trim().length === 0) {
      throw new Error('WebBotAuthVerifier: directoryUrl is empty.')
    }
    if (!pinned && trusted.length === 0 && !config.allowAnySignatureAgent) {
      throw new Error(
        'WebBotAuthVerifier: set directoryUrl (pinned directory), trustedSignatureAgents, or allowAnySignatureAgent.',
      )
    }
    this.config = config
    this.trusted = trusted as TrustedAgent[]
    this.nonceStore =
      config.nonceStore === false ? undefined : (config.nonceStore ?? new MemoryNonceStore())
  }

  private now(): number {
    return this.config.now ? this.config.now() : Math.floor(Date.now() / 1000)
  }

  /** Verify the Web Bot Auth signature on a request. Never throws. */
  async verify(req: SignedHttpRequest): Promise<WebBotAuthResult> {
    const sigInputRaw = headerValue(req.headers, 'signature-input')
    const sigRaw = headerValue(req.headers, 'signature')
    if (!sigInputRaw || !sigRaw) return fail('no_signature')

    const all = parseSignatureInputs(sigInputRaw)
    if (!all || all.length === 0) return fail('malformed')
    let signatures: Map<string, Member>
    try {
      signatures = parseDictionary(sigRaw)
    } catch {
      return fail('malformed')
    }

    const expectedTag =
      this.config.expectedTag === undefined ? DEFAULT_TAG : this.config.expectedTag
    let candidates = this.config.label ? all.filter((p) => p.label === this.config.label) : all
    if (candidates.length === 0) return fail('no_signature')
    if (expectedTag !== null) {
      const tagged = candidates.filter((p) => p.params.tag === expectedTag)
      if (tagged.length === 0) {
        return fail('tag_mismatch', { tag: candidates[0].params.tag, label: candidates[0].label })
      }
      candidates = tagged
    }

    let first: WebBotAuthResult | undefined
    for (const parsed of candidates.slice(0, MAX_SIGNATURE_CANDIDATES)) {
      let result: WebBotAuthResult
      try {
        result = await this.verifyOne(parsed, signatures, req)
      } catch {
        result = fail('malformed', { label: parsed.label })
      }
      if (result.verified) return result
      first ??= result
    }
    return first as WebBotAuthResult
  }

  private async verifyOne(
    parsed: ParsedSignatureInput,
    signatures: Map<string, Member>,
    req: SignedHttpRequest,
  ): Promise<WebBotAuthResult> {
    const p = parsed.params
    const info: Partial<WebBotAuthResult> = {
      label: parsed.label,
      keyid: p.keyid,
      tag: p.tag,
      created: p.created,
      expires: p.expires,
      nonce: p.nonce,
    }
    if (p.created === undefined || p.expires === undefined || !p.keyid || !p.tag) {
      return fail('missing_param', info)
    }
    if (p.alg !== undefined && p.alg !== 'ed25519') return fail('unsupported_alg', info)
    if (!parsed.components.includes('@authority') && !parsed.components.includes('@target-uri')) {
      return fail('missing_authority', info)
    }

    const now = this.now()
    const skew = this.config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS
    const maxAge = this.config.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS
    if (p.created > p.expires) return fail('malformed', info)
    if (p.created > now + skew) return fail('not_yet_valid', info)
    if (p.expires < now - skew || now - p.created > maxAge + skew) return fail('expired', info)
    if (this.config.requireNonce && !p.nonce) return fail('missing_nonce', info)

    const sigMember = signatures.get(parsed.label)
    if (!sigMember || sigMember.kind !== 'item' || sigMember.value.type !== 'binary')
      return fail('malformed', info)

    // Which directory?
    const agent = resolveSignatureAgent(parsed, req)
    if (agent.ok === false) return fail(agent.reason, info)
    let directoryUrl: string
    if (this.config.directoryUrl) {
      directoryUrl = this.config.directoryUrl.trim()
    } else {
      if (agent.ok !== true) return fail('missing_signature_agent', info)
      if (!this.isTrusted(agent.url))
        return fail('untrusted_agent', { ...info, agent: agent.url.href })
      directoryUrl = agent.url.href
    }
    info.agent = directoryUrl

    const base = buildSignatureBase(parsed, req)
    if (base === null) return fail('unsupported_component', info)

    let x: string | undefined
    try {
      x = await this.lookupKey(directoryUrl, p.keyid)
    } catch {
      return fail('directory_error', info)
    }
    if (!x) return fail('unknown_key', info)
    if ((this.config.rejectTestKeys ?? true) && KNOWN_TEST_KEY_X.has(x))
      return fail('test_key', info)

    if (!(await ed25519Verify(x, sigMember.value.value, base))) return fail('bad_signature', info)

    // Record the nonce only after the signature verified, so junk cannot fill the store.
    if (p.nonce && this.nonceStore) {
      const fresh = await this.nonceStore.checkAndRecord(
        `${directoryUrl}|${p.keyid}|${p.nonce}`,
        // Long enough to cover the whole window in which the signature stays acceptable.
        (Math.min(p.expires, p.created + maxAge) + skew - now + 1) * 1000,
      )
      if (!fresh) return fail('replayed_nonce', info)
    }
    return { ...info, verified: true, outcome: 'verified' }
  }

  private isTrusted(url: URL): boolean {
    for (const t of this.trusted) {
      if (t.originOnly ? url.origin === t.origin : url.href === t.href) return true
    }
    if (this.config.allowAnySignatureAgent) return !isPrivateHost(url.hostname)
    return false
  }

  /** Find the key whose thumbprint is `keyid` in the directory at `url`. */
  private async lookupKey(url: string, keyid: string): Promise<string | undefined> {
    let entry = this.cache.get(url)
    const nowMs = Date.now()
    if (!entry || nowMs >= entry.expiresAt) {
      entry = await this.refresh(url, entry)
    } else if (
      entry.ok &&
      !entry.keys.has(keyid) &&
      nowMs - entry.lastRefetchAt >= UNKNOWN_KEY_REFETCH_MS
    ) {
      // A key we do not know: the agent may have rotated. Refetch at most once a minute.
      entry = await this.refresh(url, entry)
    }
    if (!entry.ok) throw new DirectoryError('directory unavailable')
    for (const [thumb, x] of entry.keys) {
      if (timingSafeEqualStr(thumb, keyid)) return x
    }
    return undefined
  }

  private refresh(url: string, previous: DirectoryEntry | undefined): Promise<DirectoryEntry> {
    const running = this.inflight.get(url)
    if (running) return running
    const p = this.fetchDirectory(url)
      .catch((): DirectoryEntry => {
        const nowMs = Date.now()
        // A failed fetch MUST NOT evict a cached entry (draft -01 6.10).
        if (previous?.ok)
          return { ...previous, expiresAt: nowMs + NEGATIVE_CACHE_MS, lastRefetchAt: nowMs }
        return {
          ok: false,
          keys: new Map(),
          expiresAt: nowMs + NEGATIVE_CACHE_MS,
          lastRefetchAt: nowMs,
        }
      })
      .then((entry) => {
        this.store(url, entry)
        return entry
      })
      .finally(() => this.inflight.delete(url))
    this.inflight.set(url, p)
    return p
  }

  private store(url: string, entry: DirectoryEntry): void {
    this.cache.delete(url)
    this.cache.set(url, entry)
    while (this.cache.size > MAX_CACHED_DIRECTORIES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest)
    }
  }

  private async fetchDirectory(url: string): Promise<DirectoryEntry> {
    const target = new URL(url)
    // Bare origin (the draft's own vectors use one): try the well-known path,
    // fall back to the literal URL on 404/410 (Cloudflare's resolution rule).
    const attempts =
      target.pathname === '/' ? [new URL(WELL_KNOWN_DIRECTORY_PATH, target), target] : [target]
    let lastError: unknown
    for (const attempt of attempts) {
      try {
        return await this.fetchOne(attempt)
      } catch (e) {
        lastError = e
        if (!(e instanceof DirectoryError && (e.status === 404 || e.status === 410))) break
      }
    }
    throw lastError
  }

  private async fetchOne(target: URL): Promise<DirectoryEntry> {
    const doFetch = this.config.fetch ?? fetch
    const init: RequestInit = {
      headers: { accept: `${DIRECTORY_MEDIA_TYPE}, application/jwk-set+json, application/json` },
      redirect: 'manual',
    }
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
    }
    const res = (await doFetch(target.href, init)) as unknown as RawResponse
    const status = typeof res.status === 'number' ? res.status : res.ok ? 200 : 0
    // No redirects (draft -01 5.5); `redirect: 'manual'` surfaces them as 3xx / opaque status 0.
    if (status !== 200) throw new DirectoryError(`directory status ${status}`, status)
    const body = await readCapped(res)
    let data: unknown
    try {
      data = JSON.parse(body)
    } catch {
      throw new DirectoryError('directory is not JSON')
    }
    const list = (data as { keys?: unknown } | null)?.keys
    if (!Array.isArray(list)) throw new DirectoryError('directory has no keys array')
    if (list.length > MAX_DIRECTORY_KEYS) throw new DirectoryError('directory has too many keys')

    const isWellKnown = target.pathname === WELL_KNOWN_DIRECTORY_PATH
    const nowS = this.now()
    const keys = new Map<string, string>()
    for (const k of list as Ed25519Jwk[]) {
      if (
        !k ||
        k.kty !== 'OKP' ||
        k.crv !== 'Ed25519' ||
        typeof k.x !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(k.x)
      ) {
        continue
      }
      if (typeof k.nbf === 'number' && k.nbf > nowS) continue
      if (typeof k.exp === 'number' && k.exp < nowS) continue
      const thumb = await jwkThumbprint(k)
      // At the well-known path a kid, when present, MUST be the thumbprint.
      if (isWellKnown && typeof k.kid === 'string' && k.kid !== thumb) continue
      keys.set(thumb, k.x)
    }

    if (this.config.requireSignedDirectory) {
      const signed = await verifyDirectoryResponse({
        body,
        headers: res.headers ?? { get: () => null },
        authority: target.host,
        keys,
        now: nowS,
        clockSkewSeconds: this.config.clockSkewSeconds,
      })
      for (const thumb of [...keys.keys()]) if (!signed.has(thumb)) keys.delete(thumb)
    }

    const nowMs = Date.now()
    return {
      ok: true,
      keys,
      expiresAt:
        nowMs +
        cacheLifetimeMs(res.headers, this.config.directoryCacheMs ?? DEFAULT_DIRECTORY_CACHE_MS),
      lastRefetchAt: nowMs,
    }
  }
}

/**
 * Verify without holding a verifier (no cache, no nonce memory across calls).
 * Prefer a long-lived {@link WebBotAuthVerifier}.
 */
export async function verifyWebBotAuthSignature(
  req: SignedHttpRequest,
  config: WebBotAuthConfig,
): Promise<WebBotAuthResult> {
  return new WebBotAuthVerifier(config).verify(req)
}

// ---------------------------------------------------------------------------
// Policy: "valid signed agent => skip challenge, else challenge"
// ---------------------------------------------------------------------------

/** Options shared by every framework adapter's `webBotAuth` setting. */
export type WebBotAuthPolicyConfig = WebBotAuthConfig & {
  /** Reuse a verifier (shares its directory cache and nonce store). */
  verifier?: WebBotAuthVerifier
  /**
   * Extra acceptance rule for a verified agent (e.g. only some agents or keys).
   * Return false to make it solve the challenge anyway. Default: accept all verified.
   */
  accept?: (result: WebBotAuthResult) => boolean | Promise<boolean>
}

/** Decision of {@link evaluateWebBotAuth}. */
export interface WebBotAuthDecision {
  /** true: let the request through without an imrobot proof token. */
  skipChallenge: boolean
  result: WebBotAuthResult
}

/** Build (or reuse) the verifier for a policy config. */
export function webBotAuthVerifierFor(config: WebBotAuthPolicyConfig): WebBotAuthVerifier {
  return config.verifier ?? new WebBotAuthVerifier(config)
}

/**
 * The imrobot policy: a request with a valid Web Bot Auth signature (that
 * `accept` also approves) skips the challenge; everything else is challenged.
 */
export async function evaluateWebBotAuth(
  verifier: WebBotAuthVerifier,
  req: SignedHttpRequest,
  accept?: WebBotAuthPolicyConfig['accept'],
): Promise<WebBotAuthDecision> {
  const result = await verifier.verify(req)
  if (!result.verified) return { skipChallenge: false, result }
  const ok = accept ? await accept(result) : true
  return { skipChallenge: ok, result }
}
