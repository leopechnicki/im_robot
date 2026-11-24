/**
 * Agent side of the imrobot challenge flow: find a site's challenge endpoint,
 * solve the challenge and trade the answer for a proof token.
 *
 * This is what an agent framework tool calls. It is deliberately narrow:
 * - only http(s), only the origin of the URL you pass (discovery endpoints that
 *   point elsewhere are refused), no redirects;
 * - private, loopback and link-local hosts are refused unless you opt in
 *   (an LLM can be talked into calling internal URLs);
 * - responses are size capped and time limited (headers and body), and only the
 *   parsed result is returned, never the raw body;
 * - the challenge comes from an untrusted server, so it is solved step by step
 *   under {@link SOLVE_LIMITS} instead of trusting its parameters.
 *
 * Host names are not resolved: a public name that resolves (or rebinds) to a
 * private address is not caught. In production, run agents behind an egress
 * filter or an allow-list of sites.
 */

import { executeOperation } from '../core/operations'
import type { Operation, SignedChallenge } from '../core/types'
import { isPrivateHost } from '../server/web-bot-auth'

export const DISCOVERY_PATH = '/.well-known/imrobot.json'
export const DEFAULT_CHALLENGE_PATH = '/imrobot/challenge'
export const DEFAULT_VERIFY_PATH = '/imrobot/verify'
export const DEFAULT_PROOF_HEADER = 'X-Agent-Proof'
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 256 * 1024

/**
 * Bounds for solving a challenge from an untrusted server. imrobot servers send
 * at most 8 operations, `repeat` 2-3 times and `hash_chain` 2-5 rounds, so
 * these are far above anything real; they stop a hostile site from making the
 * agent allocate gigabytes or spin forever.
 */
export const SOLVE_LIMITS = {
  maxOperations: 32,
  /** Seed and every intermediate value, in UTF-16 code units. */
  maxValueLength: 256 * 1024,
  maxHashRounds: 10_000,
  maxKeyLength: 1024,
} as const

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

/** A response plus the deadline that also bounds reading its body. */
interface Timed {
  res: Response
  url: URL
  deadline: number
  timeoutMs: number
  abort(): void
}

/** `p`, or a `timeout` GateError once `t.deadline` passes. */
async function beforeDeadline<T>(t: Timed, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new GateError('timeout', `${t.url.origin}: no answer within ${t.timeoutMs} ms`)),
      Math.max(0, t.deadline - Date.now()),
    )
  })
  try {
    return await Promise.race([p, expired])
  } finally {
    clearTimeout(timer)
  }
}

function discard(t: Timed): void {
  void Promise.resolve(t.res.body?.cancel?.()).catch(() => undefined)
}

async function readJson(t: Timed, what: string): Promise<unknown> {
  const { res } = t
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) {
    discard(t)
    throw new GateError('bad_response', `${what}: response too large`)
  }
  const reader = res.body?.getReader()
  let text = ''
  if (reader) {
    const decoder = new TextDecoder()
    let total = 0
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>
      try {
        chunk = await beforeDeadline(t, reader.read())
      } catch (err) {
        t.abort()
        void reader.cancel().catch(() => undefined)
        if (err instanceof GateError) throw err
        throw new GateError(
          'network',
          `${what}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      const { done, value } = chunk
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
    text = await beforeDeadline(t, res.text())
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
): Promise<Timed> {
  const controller = new AbortController()
  const deadline = Date.now() + timeoutMs
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await doFetch(url.toString(), {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json', ...(init.headers as Record<string, string>) },
    })
    return { res, url, deadline, timeoutMs, abort: () => controller.abort() }
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
  if (res.res.status === 200) {
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
    discard(res)
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

function tooBig(what: string): GateError {
  return new GateError('unsupported_challenge', `refusing to solve: ${what}`)
}

/** Reject a step whose parameters would blow up time or memory (see SOLVE_LIMITS). */
function checkStep(value: string, op: Operation): void {
  const o = op as unknown as Record<string, unknown>
  const L = SOLVE_LIMITS
  const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v)
  switch (o.op) {
    case 'repeat':
      if (!int(o.times) || (o.times as number) < 0) throw tooBig('repeat.times is not a count')
      if (value.length * (o.times as number) > L.maxValueLength) throw tooBig('repeat too large')
      return
    case 'pad_start':
      if (!int(o.length) || (o.length as number) > L.maxValueLength)
        throw tooBig('pad_start.length too large')
      return
    case 'replace': {
      if (typeof o.search !== 'string' || typeof o.replacement !== 'string')
        throw tooBig('replace needs string search and replacement')
      const hits = o.search === '' ? value.length + 1 : Math.floor(value.length / o.search.length)
      if (value.length + hits * o.replacement.length > L.maxValueLength)
        throw tooBig('replace result too large')
      return
    }
    case 'hash_chain':
      if (!int(o.rounds) || (o.rounds as number) > L.maxHashRounds)
        throw tooBig(`hash_chain.rounds over ${L.maxHashRounds}`)
      return
    case 'byte_xor':
      if (!Array.isArray(o.key) || o.key.length > L.maxKeyLength)
        throw tooBig(`byte_xor.key longer than ${L.maxKeyLength}`)
      return
  }
}

/** Solve under SOLVE_LIMITS, one operation at a time. */
function boundedSolve(c: SignedChallenge): string {
  const L = SOLVE_LIMITS
  if (c.pipeline.length > L.maxOperations)
    throw tooBig(`${c.pipeline.length} operations (limit ${L.maxOperations})`)
  let value = c.seed
  if (value.length > L.maxValueLength) throw tooBig('seed too long')
  for (const op of c.pipeline) {
    if (!op || typeof op !== 'object') throw tooBig('an operation is not an object')
    checkStep(value, op)
    try {
      value = executeOperation(value, op)
    } catch (err) {
      throw new GateError(
        'unsupported_challenge',
        `cannot solve this challenge: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    if (value.length > L.maxValueLength) throw tooBig('an intermediate value is too large')
  }
  return value
}

/**
 * Solve a challenge object (or its JSON text) under {@link SOLVE_LIMITS}.
 * Throws GateError (`unsupported_challenge`) on an unknown operation or a
 * pipeline over the limits.
 */
export function solveChallengeInput(challenge: unknown): string {
  let value = challenge
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new GateError('bad_response', 'challenge is not valid JSON')
    }
  }
  return boundedSolve(asChallenge(value))
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
  const challengeStatus = challengeRes.res.status
  if (challengeStatus !== 200) {
    discard(challengeRes)
    throw new GateError(
      'bad_response',
      `challenge endpoint ${endpoints.challenge.pathname} answered HTTP ${challengeStatus}`,
      { status: challengeStatus },
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
  const verifyStatus = verifyRes.res.status
  const body = (await readJson(verifyRes, 'verify').catch((err) => {
    if (verifyStatus !== 200 && !(err instanceof GateError && err.code === 'timeout')) return {}
    throw err
  })) as { proofToken?: unknown; reason?: unknown; code?: unknown; elapsed?: unknown }
  if (verifyStatus !== 200 || typeof body.proofToken !== 'string') {
    const reason =
      typeof body.reason === 'string'
        ? body.reason
        : typeof body.code === 'string'
          ? body.code
          : undefined
    throw new GateError(
      'rejected',
      `verify endpoint refused the answer (HTTP ${verifyStatus}${reason ? `, ${reason}` : ''})`,
      { reason, status: verifyStatus },
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
