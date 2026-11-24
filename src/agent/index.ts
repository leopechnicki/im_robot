/**
 * imrobot/agent — the signing side of Web Bot Auth
 * (draft-ietf-webbotauth-httpsig-protocol-01, RFC 9421).
 *
 * For people who RUN an agent:
 * 1. `generateAgentKey()` once; keep `privateJwk` secret (env / secret store).
 * 2. Publish `buildKeyDirectory([publicJwk])` at
 *    `https://<your-agent-host>/.well-known/http-message-signatures-directory`
 *    (or any https JWK Set URL), e.g. with `createKeyDirectoryHandler`.
 * 3. Sign outgoing requests with `signRequest` or wrap fetch with `createSignedFetch`.
 *    Sites running imrobot's verifier (or Cloudflare's) let you skip the challenge.
 *
 * Web Crypto only, zero dependencies (Node 20+, Deno, Bun, Workers).
 *
 * @example
 * ```ts
 * import { createSignedFetch } from 'imrobot/agent'
 *
 * const signedFetch = createSignedFetch({
 *   privateJwk: JSON.parse(process.env.AGENT_PRIVATE_JWK!),
 *   signatureAgent: 'https://agent.example/.well-known/http-message-signatures-directory',
 * })
 * const res = await signedFetch('https://site.example/api/data')
 * ```
 */

import {
  bytesToBase64,
  contentDigest,
  jwkThumbprint,
  utf8Bytes,
  type Ed25519PrivateJwk,
  type Ed25519PublicJwk,
} from '../server/wba-crypto'
import { serializeBareItem } from '../server/structured-fields'

export { jwkThumbprint }
export type { Ed25519PrivateJwk, Ed25519PublicJwk }

export const WEB_BOT_AUTH_TAG = 'web-bot-auth'
export const DIRECTORY_TAG = 'http-message-signatures-directory'
export const WELL_KNOWN_DIRECTORY_PATH = '/.well-known/http-message-signatures-directory'
export const DIRECTORY_MEDIA_TYPE = 'application/http-message-signatures-directory+json'
/** draft -01 recommends at most 24 h; short lifetimes limit replay. */
const DEFAULT_EXPIRES_IN_SECONDS = 60
const MAX_EXPIRES_IN_SECONDS = 86_400

/** A freshly generated agent key pair. */
export interface AgentKey {
  /** Keep secret. Contains `d`. `kid` is the RFC 7638 thumbprint. */
  privateJwk: Ed25519PrivateJwk
  /** Safe to publish in the key directory. `kid` is the RFC 7638 thumbprint. */
  publicJwk: Ed25519PublicJwk
  /** RFC 7638 thumbprint: the `keyid` sent in Signature-Input. */
  keyid: string
}

/** Generate an Ed25519 agent key. */
export async function generateAgentKey(): Promise<AgentKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as { x: string; d: string }
  const keyid = await jwkThumbprint({ kty: 'OKP', crv: 'Ed25519', x: jwk.x })
  const publicJwk: Ed25519PublicJwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    x: jwk.x,
    kid: keyid,
    use: 'sig',
  }
  return { privateJwk: { ...publicJwk, d: jwk.d }, publicJwk, keyid }
}

/** Strip the private part of a JWK and set `kid` to its thumbprint. */
export async function toPublicJwk(
  jwk: Ed25519PublicJwk | Ed25519PrivateJwk,
): Promise<Ed25519PublicJwk> {
  const kid = await jwkThumbprint(jwk)
  const out: Ed25519PublicJwk = { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid, use: 'sig' }
  if (typeof jwk.nbf === 'number') out.nbf = jwk.nbf
  if (typeof jwk.exp === 'number') out.exp = jwk.exp
  return out
}

/**
 * The key directory document (a JWK Set). Serve it with
 * `Content-Type: application/http-message-signatures-directory+json`.
 */
export async function buildKeyDirectory(
  keys: Array<Ed25519PublicJwk | Ed25519PrivateJwk>,
): Promise<{
  keys: Ed25519PublicJwk[]
}> {
  return { keys: await Promise.all(keys.map(toPublicJwk)) }
}

async function importPrivate(jwk: Ed25519PrivateJwk): Promise<CryptoKey> {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.d || !jwk.x) {
    throw new Error('imrobot/agent: privateJwk must be an Ed25519 OKP key with d and x')
  }
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x: jwk.x, d: jwk.d },
    { name: 'Ed25519' },
    false,
    ['sign'],
  )
}

function randomNonce(): string {
  // 64 random bytes, base64 (the length Cloudflare's implementation uses).
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  return bytesToBase64(bytes)
}

/** Options for {@link signRequest}. */
export interface SignRequestOptions {
  privateJwk: Ed25519PrivateJwk
  /**
   * Your key directory URL (https). Sent as `Signature-Agent: <label>="<url>"`
   * and covered by the signature. Required by draft -01.
   */
  signatureAgent: string
  /** Signature label. Default `'sig1'`. */
  label?: string
  /** Signature lifetime in seconds (max 86400). Default 60. */
  expiresInSeconds?: number
  /** `created` in Unix seconds. Default: now. */
  created?: number
  /** Explicit `expires` (Unix seconds); overrides `expiresInSeconds`. */
  expires?: number
  /** Nonce. Default: 64 random bytes, base64. `false` sends none. */
  nonce?: string | false
  /**
   * Extra covered components after `@authority` and `signature-agent`, e.g.
   * `['@method', '@path']`. Supported: `@method`, `@path`, `@query`, `@target-uri`,
   * `@scheme` and plain header names (present on the request).
   */
  components?: string[]
  /** Include `alg="ed25519"`. Default true. */
  includeAlg?: boolean
}

/** Headers to add to a request. */
export interface SignatureHeaders {
  'Signature-Agent': string
  'Signature-Input': string
  Signature: string
}

/** Minimal request description to sign. */
export interface RequestToSign {
  method?: string
  /** Absolute URL. */
  url: string
  headers?: Record<string, string>
}

function componentValue(
  name: string,
  url: URL,
  method: string,
  headers: Record<string, string>,
): string {
  switch (name) {
    case '@method':
      return method.toUpperCase()
    case '@authority':
      return url.host.toLowerCase()
    case '@path':
      return url.pathname || '/'
    case '@query':
      return url.search || '?'
    case '@scheme':
      return url.protocol.slice(0, -1)
    case '@target-uri':
      return url.href
    default: {
      if (name.startsWith('@')) throw new Error(`imrobot/agent: unsupported component ${name}`)
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name)
      if (key === undefined) throw new Error(`imrobot/agent: header ${name} is not on the request`)
      return headers[key].trim()
    }
  }
}

/**
 * Sign a request. Returns the three headers to add. Covers `@authority` and
 * the `Signature-Agent` member, plus `components`.
 */
export async function signRequest(
  request: RequestToSign,
  options: SignRequestOptions,
): Promise<SignatureHeaders> {
  const url = new URL(request.url)
  const agentUrl = new URL(options.signatureAgent)
  if (agentUrl.protocol !== 'https:')
    throw new Error('imrobot/agent: signatureAgent must be an https URL')
  const label = options.label ?? 'sig1'
  if (!/^[a-z*][a-z0-9_\-.*]*$/.test(label)) throw new Error('imrobot/agent: invalid label')
  const created = options.created ?? Math.floor(Date.now() / 1000)
  const lifetime = Math.min(
    options.expiresInSeconds ?? DEFAULT_EXPIRES_IN_SECONDS,
    MAX_EXPIRES_IN_SECONDS,
  )
  const expires = options.expires ?? created + lifetime
  const nonce = options.nonce === false ? undefined : (options.nonce ?? randomNonce())
  const keyid = await jwkThumbprint(options.privateJwk)

  const agentMember = serializeBareItem({ type: 'string', value: options.signatureAgent })
  const signatureAgentHeader = `${label}=${agentMember}`
  const method = request.method ?? 'GET'
  const headers = request.headers ?? {}

  const extra = (options.components ?? []).map((c) => c.toLowerCase())
  const lines: string[] = [`"@authority": ${componentValue('@authority', url, method, headers)}`]
  const ids: string[] = ['"@authority"', `"signature-agent";key="${label}"`]
  lines.push(`"signature-agent";key="${label}": ${agentMember}`)
  for (const name of extra) {
    if (name === '@authority' || name === 'signature-agent') continue
    lines.push(`"${name}": ${componentValue(name, url, method, headers)}`)
    ids.push(`"${name}"`)
  }

  let params = `(${ids.join(' ')});created=${created};keyid="${keyid}"`
  if (options.includeAlg ?? true) params += ';alg="ed25519"'
  params += `;expires=${expires}`
  if (nonce) params += `;nonce=${serializeBareItem({ type: 'string', value: nonce })}`
  params += `;tag="${WEB_BOT_AUTH_TAG}"`
  lines.push(`"@signature-params": ${params}`)

  const key = await importPrivate(options.privateJwk)
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, utf8Bytes(lines.join('\n'))))
  return {
    'Signature-Agent': signatureAgentHeader,
    'Signature-Input': `${label}=${params}`,
    Signature: `${label}=:${bytesToBase64(sig)}:`,
  }
}

/**
 * Wrap `fetch` so every request carries a Web Bot Auth signature.
 * The returned function has the same signature as `fetch`.
 */
export function createSignedFetch(
  options: SignRequestOptions & { fetch?: typeof fetch },
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const baseFetch = options.fetch ?? fetch
  return async (input, init) => {
    const req = new Request(input, init)
    const headers: Record<string, string> = {}
    req.headers.forEach((v, k) => {
      headers[k] = v
    })
    const sig = await signRequest({ method: req.method, url: req.url, headers }, options)
    const signed = new Request(req, {
      headers: { ...headers, ...sig },
    })
    return baseFetch(signed)
  }
}

/** Options for {@link signDirectoryResponse}. */
export interface SignDirectoryOptions {
  /** The keys to sign with (each signs once, label `binding<i>`). */
  privateJwks: Ed25519PrivateJwk[]
  /** Authority (`host[:port]`) the directory is served from. */
  authority: string
  created?: number
  /** Lifetime in seconds. Default 86400. */
  expiresInSeconds?: number
}

/**
 * Headers for a signed key-directory response (draft -01 Appendix B.1): one
 * signature per key over `("@authority";req "content-digest")`, tag
 * `http-message-signatures-directory`. Returns `Content-Digest`,
 * `Signature-Input` and `Signature`.
 */
export async function signDirectoryResponse(
  body: string,
  options: SignDirectoryOptions,
): Promise<{ 'Content-Digest': string; 'Signature-Input': string; Signature: string }> {
  const digest = await contentDigest(body)
  const created = options.created ?? Math.floor(Date.now() / 1000)
  const expires = created + (options.expiresInSeconds ?? 86_400)
  const inputs: string[] = []
  const sigs: string[] = []
  for (let i = 0; i < options.privateJwks.length; i++) {
    const jwk = options.privateJwks[i]
    const label = options.privateJwks.length === 1 ? 'binding' : `binding${i}`
    const keyid = await jwkThumbprint(jwk)
    const params = `("@authority";req "content-digest");created=${created};expires=${expires};keyid="${keyid}";tag="${DIRECTORY_TAG}"`
    const base = [
      `"@authority";req: ${options.authority.toLowerCase()}`,
      `"content-digest": ${digest}`,
      `"@signature-params": ${params}`,
    ].join('\n')
    const key = await importPrivate(jwk)
    const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, utf8Bytes(base)))
    inputs.push(`${label}=${params}`)
    sigs.push(`${label}=:${bytesToBase64(sig)}:`)
  }
  return {
    'Content-Digest': digest,
    'Signature-Input': inputs.join(', '),
    Signature: sigs.join(', '),
  }
}

/**
 * A Fetch-API handler that serves your key directory (signed) at the
 * well-known path. Mount it on any Fetch-style router (Hono, Next.js route
 * handler, Workers, Deno, Bun).
 *
 * @example Next.js `app/.well-known/http-message-signatures-directory/route.ts`
 * ```ts
 * import { createKeyDirectoryHandler } from 'imrobot/agent'
 * export const GET = createKeyDirectoryHandler({
 *   privateJwks: [JSON.parse(process.env.AGENT_PRIVATE_JWK!)],
 * })
 * ```
 */
export function createKeyDirectoryHandler(options: {
  privateJwks: Ed25519PrivateJwk[]
  /** Cache-Control max-age in seconds. Default 3600. */
  maxAgeSeconds?: number
}): (request: Request) => Promise<Response> {
  const directory = buildKeyDirectory(options.privateJwks)
  return async (request) => {
    const body = JSON.stringify(await directory)
    const authority = new URL(request.url).host
    const sig = await signDirectoryResponse(body, { privateJwks: options.privateJwks, authority })
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': DIRECTORY_MEDIA_TYPE,
        'Cache-Control': `max-age=${options.maxAgeSeconds ?? 3600}`,
        ...sig,
      },
    })
  }
}

// Passing an imrobot challenge, and tool definitions for agent frameworks.
export {
  DEFAULT_CHALLENGE_PATH,
  DEFAULT_PROOF_HEADER,
  DEFAULT_VERIFY_PATH,
  DISCOVERY_PATH,
  GateError,
  passGate,
  SOLVE_LIMITS,
  solveChallengeInput,
} from './gate'
export type { GateErrorCode, PassGateOptions, PassGateResult } from './gate'
export {
  imrobotTools,
  PASS_GATE_DESCRIPTION,
  PASS_GATE_TOOL_NAME,
  SOLVE_DESCRIPTION,
  SOLVE_TOOL_NAME,
} from './tools'
export type { ImRobotTool, ToolInputSchema } from './tools'
