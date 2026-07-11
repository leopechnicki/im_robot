/**
 * imrobot / Hono adapter
 *
 * Hono is a Web Standards-first router (Bun, Cloudflare Workers, Deno, Node).
 * Its context/handler shape is very different from Express, so we ship a
 * dedicated adapter instead of trying to reuse the generic middleware layer.
 *
 * Everything defers to the framework-agnostic `ImRobotVerifier` and
 * `ProofTokenIssuer` classes from `imrobot/server`.
 *
 * @example Bun + Hono
 * ```ts
 * import { Hono } from 'hono'
 * import {
 *   createHonoAgentRouter,
 *   requireAgentHono,
 * } from 'imrobot/hono'
 *
 * const app = new Hono()
 * const secret = process.env.IMROBOT_SECRET!
 *
 * // Mount /imrobot/challenge and /imrobot/verify
 * const router = createHonoAgentRouter({ secret })
 * router.mount(app, '/imrobot')
 *
 * // Protect a route
 * app.get('/api/agent-data', requireAgentHono({ secret }), (c) =>
 *   c.json({ secret: 'only bots see this' }),
 * )
 *
 * export default app
 * ```
 */

import type {
  SignedChallenge,
  Difficulty,
  VerifyResult,
  AgentProofToken,
} from "../core/types";
import { ImRobotVerifier } from "../server/verifier";
import { ProofTokenIssuer } from "../server/proof-token";
import type { ChallengeReplayGuard } from "../server/replay-guard";
import { fnv1a } from "../core/hash";

// ---------------------------------------------------------------------------
// Minimal Hono type surface — we DON'T import from `hono` at runtime so that
// this module has zero peer dependencies. Consumers who use it must have Hono
// installed themselves (declared as an optional peerDependency).
// ---------------------------------------------------------------------------

/** Subset of Hono Context we rely on. Structural typing keeps us decoupled. */
export interface HonoContext {
  req: {
    header(name: string): string | undefined;
    json<T = unknown>(): Promise<T>;
    url: string;
    method: string;
    raw: Request;
  };
  json(body: unknown, status?: number): Response;
  text(body: string, status?: number): Response;
  status(status: number): void;
  header(name: string, value: string): void;
  set(key: string, value: unknown): void;
  get<T = unknown>(key: string): T;
}

/** Hono middleware handler shape. */
export type HonoMiddleware = (
  c: HonoContext,
  next: () => Promise<void>,
) => Promise<Response | void>;

/** Hono handler shape (leaf routes). */
export type HonoHandler = (c: HonoContext) => Promise<Response> | Response;

/** Minimal Hono router surface we produce (`get`/`post`). */
export interface HonoRouterLike {
  get(path: string, handler: HonoHandler): unknown;
  post(path: string, handler: HonoHandler): unknown;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface HonoAgentRouterConfig {
  secret: string;
  difficulty?: Difficulty;
  ttl?: number;
  /** Where to write the proof token as a response header. Default: 'X-Agent-Proof' */
  proofHeader?: string;
  /** Issuer name embedded in the JWT `iss` claim. Default: 'imrobot' */
  issuer?: string;
  /** Proof token TTL in ms. Default: 1 hour */
  tokenTTL?: number;
  /** Optional replay guard. If provided, verified challenge IDs are recorded. */
  replayGuard?: ChallengeReplayGuard;
  /**
   * How to derive an `agentId` for the issued JWT `sub` claim.
   * Defaults to a per-request fnv1a of the challenge id + timestamp — anonymous but stable.
   */
  agentIdFrom?: (c: HonoContext, challenge: SignedChallenge) => string;
}

export interface RequireAgentHonoOptions {
  secret: string;
  /** Where to read the proof token. Default: 'X-Agent-Proof' */
  headerName?: string;
  /** Issuer name to enforce on tokens (must match router). Default: 'imrobot' */
  issuer?: string;
  /** Allowed clock skew in seconds for iat/nbf/exp. Default: 5 */
  clockSkewSec?: number;
  /** Custom bypass — return true to allow request through without verification. */
  bypass?: (c: HonoContext) => boolean | Promise<boolean>;
  /** Optional key id (`kid`) for the current signing secret. */
  keyId?: string;
  /** Additional accepted secrets for graceful key rotation. */
  previousSecrets?: Array<{ keyId: string; secret: string }>;
  /** Where the verified proof gets stashed on the context. Default: 'agentProof' */
  contextKey?: string;
}

const DEFAULT_PROOF_HEADER = "X-Agent-Proof";
const DEFAULT_ISSUER = "imrobot";
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

function defaultAgentId(_c: HonoContext, challenge: SignedChallenge): string {
  // Anonymous but per-verification stable — the challenge id is unique enough.
  return `agent_${fnv1a(challenge.id + ":" + challenge.timestamp)}`;
}

// ---------------------------------------------------------------------------
// Router (mount at /imrobot or wherever you like)
// ---------------------------------------------------------------------------

/**
 * Returns two Hono handlers — `challenge` (GET) and `verify` (POST) — plus a
 * `mount()` helper that wires them onto a Hono app.
 *
 * Usage:
 *   const router = createHonoAgentRouter({ secret })
 *   router.mount(app, '/imrobot')
 * or manually:
 *   app.get('/imrobot/challenge', router.challenge)
 *   app.post('/imrobot/verify', router.verify)
 */
export function createHonoAgentRouter(config: HonoAgentRouterConfig) {
  const verifier = new ImRobotVerifier({
    secret: config.secret,
    difficulty: config.difficulty,
    ttl: config.ttl,
    replayGuard: config.replayGuard,
  });
  const issuer = new ProofTokenIssuer({
    secret: config.secret,
    issuer: config.issuer ?? DEFAULT_ISSUER,
    tokenTTL: config.tokenTTL ?? DEFAULT_TOKEN_TTL_MS,
  });
  const proofHeader = config.proofHeader ?? DEFAULT_PROOF_HEADER;
  const agentIdFrom = config.agentIdFrom ?? defaultAgentId;

  const challenge: HonoHandler = async (c) => {
    const signed = await verifier.generate();
    return c.json(signed);
  };

  const verify: HonoHandler = async (c) => {
    let body: { challenge?: SignedChallenge; answer?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ valid: false, reason: "invalid_json" }, 400);
    }
    if (!body.challenge || typeof body.answer !== "string") {
      return c.json({ valid: false, reason: "missing_fields" }, 400);
    }

    const result: VerifyResult = await verifier.verify(
      body.challenge,
      body.answer,
    );
    if (!result.valid) {
      return c.json(result, 400);
    }

    const token = await issuer.issue({
      agentId: agentIdFrom(c, body.challenge),
      challengeId: body.challenge.id,
      difficulty: body.challenge.difficulty,
      solveTimeMs: result.elapsed ?? 0,
      suspicious: result.suspicious ?? false,
    });

    c.header(proofHeader, token);
    return c.json({ ...result, proofToken: token });
  };

  const mount = (app: HonoRouterLike, basePath = "/imrobot") => {
    const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
    app.get(`${base}/challenge`, challenge);
    app.post(`${base}/verify`, verify);
  };

  return { challenge, verify, mount };
}

// ---------------------------------------------------------------------------
// requireAgent — middleware that gates a route
// ---------------------------------------------------------------------------

/**
 * Hono middleware that enforces the presence of a valid proof token.
 * Attaches the decoded token to `c.set('agentProof', ...)`.
 *
 * @example
 * ```ts
 * app.get('/api/agent-only', requireAgentHono({ secret }), (c) => {
 *   const proof = c.get<AgentProofToken>('agentProof')
 *   return c.json({ msg: 'hello agent', proof })
 * })
 * ```
 */
export function requireAgentHono(
  options: RequireAgentHonoOptions,
): HonoMiddleware {
  const issuer = new ProofTokenIssuer({
    secret: options.secret,
    issuer: options.issuer ?? DEFAULT_ISSUER,
    clockSkewSec: options.clockSkewSec ?? 5,
    keyId: options.keyId,
    previousSecrets: options.previousSecrets,
  });
  const headerName = options.headerName ?? DEFAULT_PROOF_HEADER;
  const contextKey = options.contextKey ?? "agentProof";

  return async (c, next) => {
    if (options.bypass) {
      const skip = await options.bypass(c);
      if (skip) {
        await next();
        return;
      }
    }

    const token = c.req.header(headerName);
    if (!token) {
      return c.json(
        {
          error: "agent_proof_required",
          message: `Missing ${headerName} header — call the /imrobot/verify endpoint first.`,
        },
        401,
      );
    }

    const result = await issuer.verify(token);
    if (!result.valid || !result.payload) {
      return c.json(
        {
          error: "agent_proof_invalid",
          reason: result.reason ?? "unknown",
        },
        401,
      );
    }

    c.set(contextKey, result.payload as AgentProofToken);
    c.set("agentVerified", true);
    await next();
  };
}
