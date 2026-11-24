/**
 * Agent side of the imrobot challenge flow: find a site's challenge endpoint,
 * solve the challenge and trade the answer for a proof token.
 *
 * This is what an agent framework tool calls. It is deliberately narrow:
 * - only http(s), only the origin of the URL you pass (discovery endpoints that
 *   point elsewhere are refused), no redirects;
 * - private, loopback and link-local hosts are refused unless you opt in
 *   (an LLM can be talked into calling internal URLs);
 * - responses are size capped and time limited, and only the parsed result is
 *   returned, never the raw body.
 */

import { solveChallenge } from '../core/solver'
import type { SignedChallenge } from '../core/types'
import { isPrivateHost } from '../server/web-bot-auth'

export const DISCOVERY_PATH = '/.well-known/imrobot.json'
export const DEFAULT_CHALLENGE_PATH = '/imrobot/challenge'
export const DEFAULT_VERIFY_PATH = '/imrobot/verify'
export const DEFAULT_PROOF_HEADER = 'X-Agent-Proof'
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 256 * 1024

export type GateErrorCode =
  | 'invalid_url'
  | 'private_host'
  | 'network'
  | 'timeout'
  | 'bad_response'
  | 'unsupported_challenge'
  | 'rejected'

/** Thrown by {@link passGate}. `code` is stable; `message` is for people. */
export class GateError extends Error {
  readonly code: GateErrorCode
  /** Server's `reason` when it rejected the answer (`code === 'rejected'`). */
  readonly reason?: string
  readonly status?: number
  constructor(code: GateErrorCode, message: string, extra?: { reason?: string; status?: number }) {
    super(message)
    this.name = 'GateError'
    this.code = code
    this.reason = extra?.reason
    this.status = extra?.status
  }
}

export interface PassGateOptions {
  /** fetch to use, e.g. `createSignedFetch(...)` to also send Web Bot Auth. Default: global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  /** Sent as `agentId` with the answer; servers put it in the proof token. */
  agentId?: string
  /** Per request. Default 10 s. */
  timeoutMs?: number
  /** Allow private / loopback / link-local hosts (local development). Default false. */
  allowPrivateHosts?: boolean
}

export interface PassGateResult {
  /** The proof token. Send it as `proofHeader` on later requests. */
  proofToken: string
  proofHeader: string
  challengeUrl: string
  verifyUrl: string
  /** Milliseconds between issue and verification, as the server measured it. */
  elapsed?: number
  difficulty?: string
  /** Where the endpoints came from. */
  source: 'discovery' | 'url' | 'default'
}

interface Endpoints {
  challenge: URL
  verify: URL
  proofHeader: string
  source: PassGateResult['source']
}

function parseTarget(input: string, allowPrivate: boolean): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new GateError('invalid_url', `Not a URL: ${input}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new GateError('invalid_url', `Only http(s) URLs are supported (got ${url.protocol})`)
  }
  if (url.username || url.password) {
    throw new GateError('invalid_url', 'URLs with credentials are not supported')
  }
  if (!allowPrivate && isPrivateHost(url.hostname)) {
    throw new GateError(
      'private_host',
      `${url.hostname} is a private or local address (allowPrivateHosts, or --allow-private-hosts on "imrobot mcp", for local development)`,
    )
  }
  return url
}

/** A discovery endpoint must be a root-relative path on the same origin. */
function sameOriginPath(origin: URL, value: unknown): URL | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return undefined
  if (value.includes('\\')) return undefined
  const url = new URL(value, origin)
  return url.origin === origin.origin ? url : undefined
}

async function readJson(res: Response, what: string): Promise<unknown> {
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) {
    await Promise.resolve(res.body?.cancel?.()).catch(() => undefined)
    throw new GateError('bad_response', `${what}: response too large`)
  }
  const reader = res.body?.getReader()
  let text = ''
  if (reader) {
    const decoder = new TextDecoder()
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new GateError('bad_response', `${what}: response too large`)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
  } else {
    text = await res.text()
    if (text.length > MAX_BODY_BYTES)
      throw new GateError('bad_response', `${what}: response too large`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new GateError('bad_response', `${what}: not JSON`, { status: res.status })
  }
}

async function request(
  doFetch: NonNullable<PassGateOptions['fetch']>,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await doFetch(url.toString(), {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json', ...(init.headers as Record<string, string>) },
    })
  } catch (err) {
    if (controller.signal.aborted) {
      throw new GateError('timeout', `${url.origin}: no answer within ${timeoutMs} ms`)
    }
    throw new GateError(
      'network',
      `${url.origin}: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

async function findEndpoints(
  doFetch: NonNullable<PassGateOptions['fetch']>,
  target: URL,
  timeoutMs: number,
): Promise<Endpoints> {
  // 1. The URL itself is a challenge endpoint (`.../challenge`): verify is its sibling.
  if (target.pathname.endsWith('/challenge')) {
    const verify = new URL(target)
    verify.pathname = target.pathname.slice(0, -'/challenge'.length) + '/verify'
    verify.search = ''
    return { challenge: target, verify, proofHeader: DEFAULT_PROOF_HEADER, source: 'url' }
  }
  // 2. Discovery document on the origin.
  const res = await request(doFetch, new URL(DISCOVERY_PATH, target), { method: 'GET' }, timeoutMs)
  if (res.status === 200) {
    const doc = (await readJson(res, 'discovery document')) as {
      protocol?: unknown
      endpoints?: { challenge?: unknown; verify?: unknown; proofHeader?: unknown }
    }
    if (doc && doc.protocol === 'imrobot') {
      const challenge = sameOriginPath(target, doc.endpoints?.challenge)
      const verify = sameOriginPath(target, doc.endpoints?.verify)
      if (!challenge || !verify) {
        throw new GateError(
          'bad_response',
          'discovery document endpoints must be paths on the same origin',
        )
      }
      const header = doc.endpoints?.proofHeader
      return {
        challenge,
        verify,
        proofHeader:
          typeof header === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(header)
            ? header
            : DEFAULT_PROOF_HEADER,
        source: 'discovery',
      }
    }
  } else {
    await Promise.resolve(res.body?.cancel?.()).catch(() => undefined)
  }
  // 3. The default mount point of every imrobot adapter.
  return {
    challenge: new URL(DEFAULT_CHALLENGE_PATH, target),
    verify: new URL(DEFAULT_VERIFY_PATH, target),
    proofHeader: DEFAULT_PROOF_HEADER,
    source: 'default',
  }
}

function asChallenge(value: unknown): SignedChallenge {
  const c = value as Partial<SignedChallenge> | null
  if (
    !c ||
    typeof c !== 'object' ||
    typeof c.id !== 'string' ||
    typeof c.seed !== 'string' ||
    !Array.isArray(c.pipeline)
  ) {
    throw new GateError('bad_response', 'challenge endpoint did not return an imrobot challenge')
  }
  return c as SignedChallenge
}

/** Solve a challenge object (or its JSON text). Throws GateError on an unknown operation. */
export function solveChallengeInput(challenge: unknown): string {
  let value = challenge
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new GateError('bad_response', 'challenge is not valid JSON')
    }
  }
  const c = asChallenge(value)
  try {
    return solveChallenge(c)
  } catch (err) {
    throw new GateError(
      'unsupported_challenge',
      `cannot solve this challenge: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Pass an imrobot gate: discover the endpoints of `url`, solve the challenge and
 * return the proof token.
 *
 * `url` may be the site (`https://site.example`), any page on it, or the
 * challenge endpoint itself (`https://site.example/imrobot/challenge`).
 *
 * @example
 * ```ts
 * import { passGate } from 'imrobot/agent'
 *
 * const { proofToken, proofHeader } = await passGate('https://site.example')
 * await fetch('https://site.example/api/data', { headers: { [proofHeader]: proofToken } })
 * ```
 */
export async function passGate(
  url: string,
  options: PassGateOptions = {},
): Promise<PassGateResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const target = parseTarget(url, options.allowPrivateHosts === true)
  const endpoints = await findEndpoints(doFetch, target, timeoutMs)

  const challengeRes = await request(doFetch, endpoints.challenge, { method: 'GET' }, timeoutMs)
  if (challengeRes.status !== 200) {
    await Promise.resolve(challengeRes.body?.cancel?.()).catch(() => undefined)
    throw new GateError(
      'bad_response',
      `challenge endpoint ${endpoints.challenge.pathname} answered HTTP ${challengeRes.status}`,
      { status: challengeRes.status },
    )
  }
  const challenge = asChallenge(await readJson(challengeRes, 'challenge'))
  const answer = solveChallengeInput(challenge)

  const verifyRes = await request(
    doFetch,
    endpoints.verify,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challenge,
        answer,
        ...(options.agentId ? { agentId: options.agentId } : {}),
      }),
    },
    timeoutMs,
  )
  const body = (await readJson(verifyRes, 'verify').catch((err) => {
    if (verifyRes.status !== 200) return {}
    throw err
  })) as { proofToken?: unknown; reason?: unknown; code?: unknown; elapsed?: unknown }
  if (verifyRes.status !== 200 || typeof body.proofToken !== 'string') {
    const reason =
      typeof body.reason === 'string'
        ? body.reason
        : typeof body.code === 'string'
          ? body.code
          : undefined
    throw new GateError(
      'rejected',
      `verify endpoint refused the answer (HTTP ${verifyRes.status}${reason ? `, ${reason}` : ''})`,
      { reason, status: verifyRes.status },
    )
  }
  return {
    proofToken: body.proofToken,
    proofHeader: endpoints.proofHeader,
    challengeUrl: endpoints.challenge.toString(),
    verifyUrl: endpoints.verify.toString(),
    elapsed: typeof body.elapsed === 'number' ? body.elapsed : undefined,
    difficulty: typeof challenge.difficulty === 'string' ? challenge.difficulty : undefined,
    source: endpoints.source,
  }
}
