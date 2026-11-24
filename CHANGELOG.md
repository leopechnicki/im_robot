# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-11-24

0.8.0 was tagged and has a GitHub release, but it never reached npm or PyPI (both uploads were
refused for credentials). 0.9.0 is the first npm release since 0.7.3, the first release of the
Python SDK on PyPI, and contains everything listed under 0.8.0 below.

### Added

- Web Bot Auth, first class (draft-ietf-webbotauth-httpsig-protocol-01):
  - `Signature-Agent` discovery (Dictionary form plus the legacy string form).
  - Key-directory fetch and cache: no redirects, 5 s timeout, 64 kB / 100-key caps, `Cache-Control` lifetime,
    a negative cache, no eviction on a failed refetch, and an SSRF guard for `allowAnySignatureAgent`.
  - `created`/`expires`/`keyid`/`tag`/`nonce` checks, a pluggable nonce store, test-key rejection,
    verified / invalid / unverified outcomes, and optional signed key directories.
  - Policy "valid signed agent => skip the challenge, otherwise challenge" in `requireAgent`, `requireAgentHono`,
    `createNextMiddleware` and FastAPI `require_agent(web_bot_auth=...)`. A refusal carries `Accept-Signature`.
  - SSRF guard: trailing dots, numeric or hex hosts (`127.1`, `0x7f000001`) and every non-global IP
    literal (including NAT64, 6to4, Teredo and site-local IPv6) are refused. Python reads the
    directory against an overall 5 s deadline, and one cancelled request no longer cancels other
    requests waiting on the same directory fetch.
  - Byte-exact test vectors from the draft (Appendix E.2.1, E.2.2, E.2.3) and from cloudflare/web-bot-auth.
- `imrobot/agent` (npm) and `imrobot.agent` (Python): a signing client with Ed25519 keygen, `signRequest` /
  `sign_request`, `createSignedFetch`, key-directory publishing and signed directory responses.
- Python `imrobot.web_bot_auth` verifier. New `wba` extra (`cryptography`).
- Agent frameworks: `passGate` (npm `imrobot/agent`) and `pass_gate` / `apass_gate` (Python
  `imrobot.gate`) pass a site's gate in one call: discovery or the default mount, solve, verify,
  proof token. Private hosts are refused unless `allowPrivateHosts`, only same-origin discovery
  endpoints, no redirects, 10 s timeout (headers and body), 256 kB response cap, stable `GateError`
  codes. The site's challenge is solved under `SOLVE_LIMITS` (Python `SOLVE_LIMITS`), so a hostile
  pipeline is refused instead of hanging the agent.
- Agent tools `imrobot_pass_gate` and `imrobot_solve_challenge`: `imrobotTools()` (framework-neutral,
  JSON Schema), `imrobot.langchain.get_langchain_tools()` and `imrobot.crewai.get_crewai_tools()`.
  New Python extras `langchain` and `crewai`.
- `npx imrobot mcp` runs the MCP server over stdio, with a new `pass-gate` tool
  (`--allow-private-hosts` for local sites).
- Examples: `examples/claude-agent-sdk.ts` (in-process tools and stdio MCP),
  `examples/pass-gate.ts`, `examples/demo-site.ts`, `python/examples/langchain_agent.py`,
  `python/examples/crewai_agent.py`.
- Timing gate: `minSolveMs` / `maxSolveMs` on `createVerifier` (Python `min_solve_ms` / `max_solve_ms`).
  The solve time is measured on the server clock from the signed issue time. New `VerifyResult`
  reasons `too_fast` and `too_slow`. Both are off by default.
- `sha256` operation: a real SHA-256 of the UTF-8 bytes (pure JS, FIPS 180-4; Python `hashlib`).
  `sha256: true` on the verifier puts exactly one in every pipeline. It is opt-in because solvers
  older than 0.9 cannot run it.
- `constantTimeEqual` (`imrobot/core`) and Python `constant_time_equal`.
- `docs/THREAT_MODEL.md`: what the checks prove, and what a human running the open-source solver can
  still do.

### Changed

- BREAKING (Web Bot Auth only): `WebBotAuthVerifier` now enforces draft -01.
  - `created`, `expires`, `tag` and a thumbprint `keyid` are required, and `@authority` must be covered.
  - A signature whose `keyid` is not in the directory is no longer checked against a lone key.
  - The constructor needs `directoryUrl`, `trustedSignatureAgents` or `allowAnySignatureAgent`.
    A pinned `directoryUrl` must be https (`allowInsecureDirectory` for local tests).
  - `directoryUrl` is optional now. A bare-origin agent URL tries
    `/.well-known/http-message-signatures-directory` first, then the literal URL on 404/410.
  - `maxAgeSeconds` (default 300 s) now caps every signature's age from `created`. It used to apply
    only to signatures without `expires`.
  - A `Signature-Agent` header that is present but not covered by the signature fails verification.
  - Duplicate component identifiers fail verification (RFC 9421 2.5).
  - `@authority` is compared with the default port removed (RFC 9421 2.2.3).
  - Directory keys must use the canonical base64url spelling.
  - At most 2 key directories are fetched per request.
  - Results carry an `outcome`.
- Behaviour change: `webBotAuth` on `requireAgent`, `requireAgentHono` and `createNextMiddleware` now
  lets a verified agent skip the challenge. `RequireAgentOptions` already had the option, but only
  `createAgentRouter` used it, so an existing config gains this bypass. The adapters warn when
  `authorities` is not set.
- New `WebBotAuthVerifier` options: `authorities` (rejects a signature made for another host:
  `wrong_authority`) and `requireComponents` (`missing_component`). Python: `authorities`,
  `require_components`, `allow_insecure_directory`.
- A throwing `accept` rule now challenges the request instead of rejecting the middleware promise.
- BREAKING (server SDK): the challenge HMAC uses message format `v2`, which also signs the issue time
  and the seed. Before, a client could back-date `timestamp`. Challenges issued by 0.8 or earlier fail
  with `invalid_hmac` after the upgrade, until their TTL runs out (seconds). Upgrade every verifier
  that shares a secret together (JS and Python services included): while 0.8 and 0.9 run side by
  side, a challenge issued by one and verified by the other fails. The JS and Python 0.9 verifiers
  are interoperable.
- Signed challenge fields must have their real types (integer `timestamp` / `expiresAt`, string
  `id` / `seed` / `verification` / `difficulty`), otherwise `invalid_hmac`. Python used to answer a
  string timestamp with a `TypeError` (HTTP 500 in an adapter).
- The verification hash and the answer are compared in constant time. Python compares UTF-8 bytes, so
  a non-ASCII signature is refused instead of raising `TypeError`.
- A malformed challenge object is refused with `invalid_hmac`.
- `ttl` (constructor and `generate()` override) must be a positive integer number of milliseconds.

### Fixed

- README: the HATCHA comparison said HATCHA is closed source, needs the monday.com CDN and uses image
  recognition. Its public README says MIT, self-hosted, text and math challenges. The table is
  rewritten from that README.

## [0.8.0] - 2026-11-24

### Removed

- BREAKING: removed the Pollinations image provider and `PollinationsProviderConfig` export. `ImageChallengePool` now throws at construction when `provider` is missing or its `type` is unsupported (including `'pollinations'`), instead of producing a silently empty pool. Use `picsum`, `static`, or `custom` (bring your own generator). (#136)

### Added

- Python SDK set up for PyPI (`pip install imrobot`); the upload did not go through, so the first PyPI release is 0.9.0. The JS and Python SDKs now release in lockstep under one version (`package.json`, `python/pyproject.toml` and `python/src/imrobot/_version.py`); a test fails on drift.
- `scripts/release-plan.mjs`: the release decision as a pure, unit-tested function (`test/release-plan.test.ts`), plus `notes`, `bump` and `verify` commands used by the workflows.
- npm and PyPI publish runs now poll the registry after publishing and fail unless the new version is actually served.
- npm publish refuses a tarball whose files mention the removed Pollinations provider.
- `RELEASING.md`: how a release happens, the one-time registry setup, and what a red Auto Release means.

### Fixed

- Auto Release (Friday) reported success every week from 2026-10-02 to 2026-11-20 and published nothing. The bump PR for 0.7.4 (#135) had been closed, so `package.json` stayed at 0.7.3; the workflow saw that tag v0.7.3 already existed, printed a warning, saw the stale bump branch, and exited 0. It now fails (job `guard`) while main has unreleased commits behind an already-released version, and recreates a stale bump branch and its PR instead of skipping.
- Every release published to npm twice: the release App's token starts `release: published` runs, so `publish.yml` ran from the release event and again through `workflow_call`, and the second run failed with E403 (v0.7.3, run 36708042343). `publish.yml` no longer listens to the release event.
- A tag that existed without its npm or PyPI publish was never healed; the planner now finishes it on the next run.
- Release notes come from this file's section for the version instead of a raw commit list (commit list is the fallback, with a warning).
- Python sdist now ships the `LICENSE` file it declared.

### Changed

- `vitest` and `@vitest/coverage-v8` bumped to ^4.1.12 (advisory fix), plus grouped dev-dependency bumps. (#137, #138)
- `publish.yml` upgrades npm to >= 11.5.1 so npm trusted publishing (OIDC) can replace the `NPM_TOKEN` secret once a trusted publisher is configured on npmjs.com.

## [0.7.3] - 2026-09-30

### Changed

- Dev-dependency bumps only (#132); version bump (#131). No source changes vs 0.7.2.

## [0.7.2] - 2026-07-17

Correction (2026-11-24): this entry used to say "republish of 0.7.1, no source changes". The v0.7.2 tag was cut from main on 2026-07-17 and the npm package contains everything below.

### Added

- Hono adapter (`imrobot/hono`) — `createHonoAgentRouter()` + `requireAgentHono()` for Bun, Cloudflare Workers, and Deno. Shares the same `ImRobotVerifier` and `ProofTokenIssuer` as the Express middleware, so JWTs verify identically across both runtimes. (#123)
- Python SDK source (`python/`) — companion package for LangChain / CrewAI / AutoGPT agents and FastAPI / Starlette servers. Byte-identical wire format with the JS SDK (interop tests pin FNV-1a, HMAC-SHA256, and base64url reference outputs). Python 3.9–3.13 supported. The PyPI publish workflow was added here, but the package first reached PyPI in 0.9.0. (#125)
- `imrobot test-agent <url>` CLI command — probes any URL for imrobot support by checking `.well-known/imrobot.json`, `data-imrobot-challenge` DOM attributes, and `<script>`/`<meta>` markers. Useful in CI scripts. Exit codes: `0` = accepts agents, `1` = no signals, `2` = network/usage error. (#122)
- Vitest coverage tooling and Codecov badges. (#121)
- Demo: build-time version injection replaces hard-coded version badges, with a regression suite. (#129, #130)

### Changed

- `formatOperation({ op: 'sha256_hash' })` documentation updated to make clear the operation uses cascaded FNV-1a, not RFC 6234 SHA-256. Wire format unchanged. (#124)
- Demo site: accessibility and responsive polish — improved ARIA labels, focus management, mobile navigation, and layout at small viewports. (#119)
- Version bump (`package.json` 0.7.1 → 0.7.2). (#118)

### Fixed

- Web component (`<imrobot-widget>`): the "✓ Verified" and "✗ Failed" status spans were rendering visibly stacked in the widget footer at initial idle state, before the user had attempted verification. The spans carried `hidden = true`, but the `.imrobot-status` class rule set `display: flex` with higher CSS specificity than the browser's UA `[hidden] { display: none }` — so the hide never took effect. Added an explicit `.imrobot-status[hidden] { display: none }` rule that re-asserts hiding for both status spans regardless of parent flex layout. Three new regression tests in `test/web-component.test.ts` lock in the fix (initial idle hides both, wrong answer shows only failed, correct answer shows only verified) by asserting `getComputedStyle(...).display` — not just the `hidden` attribute.

## [0.7.1] - 2026-07-03

### Fixed

- Auto Release (Friday) workflow now queries the npm registry via `npm view <pkg> versions --json` before invoking the reusable `publish.yml` and skips the publish job when the current `package.json` version is already on npm. This prevents the E403 "cannot publish over the previously published version" error observed on run 28647189182 (2026-07-03) after a manual publish had already shipped v0.7.0. `publish.yml` itself is untouched. (#117)

### Changed

- `vite` bumped from 8.0.8 → 8.0.16 in the root project and from 7.3.2 → 8.0.16 in `demo/`. `esbuild` removed as a direct `demo/` dependency (still pulled transitively through vite). (#107)

## [0.7.0] - 2026-07-03

### Added

- Documented 2026-11-24, shipped in this release but missing from the notes:
  - Web Bot Auth verifier (`WebBotAuthVerifier`, `verifyWebBotAuthSignature` in `imrobot/server`): RFC 9421 HTTP Message Signatures with Ed25519 keys from a key directory, usable as an Express middleware mode. (#87)
  - MCP server (`imrobot/mcp`): `generate-challenge`, `solve-challenge`, `verify-answer`, `create-token`, `get-discovery-document` tools. (#93)
  - `RedisReplayStore`: Redis-backed replay guard for multi-instance deployments. (#93)
  - `ChallengeOTelExporter`: OpenTelemetry metrics for challenge analytics. (#93)
- `./next` package subpath is now actually shipped: added to `exports`, wired into `tsup` entrypoints, and declared as an optional peer dependency. `import { createNextMiddleware, createNextApiHandler } from 'imrobot/next'` now resolves against the built `dist/next` bundle instead of falling through to the root export. (#110)
- Dist-level regression tests that import `imrobot/core` and `imrobot/next` from the compiled output to catch missing subpath exports before publish. (#111)
- Pollinations.ai and Picsum AI image providers are officially documented as shipped in the README and provider matrix. (#111)

### Changed

- `formatOperation({ op: 'sha256_hash' })` now returns `fnv1a_cascade() /* was: sha256_hash — deprecated alias */` instead of `sha256_hash()`, making the naming mistake visible at the display layer. The wire format (`op: 'sha256_hash'`) is unchanged for backwards compatibility.
- README: live playground link promoted above the fold — first thing users see after the badges.
- README: added HATCHA (Monday.com) comparison table covering framework support, token format, self-hosting, CLI, MCP integration, adaptive difficulty, and discovery endpoint.

### Deprecated

- `{ op: 'sha256_hash' }` — this operation has always been a cascaded FNV-1a hash, not RFC 6234 SHA-256. It emits a `console.warn` on first use and will be removed in a future major version. Use `{ op: 'fnv1a_cascade' }` (identical wire output) or `{ op: 'fnv1a_hash' }` for single-pass hashing in new code.

### Fixed

- `createAgentRouter()` now honors the `replayGuard` option — it wires the guard into the underlying `ImRobotVerifier` so `POST /verify` actually rejects duplicate challenge IDs with `reason: 'replay'` instead of silently accepting replays. (#109)
- Removed a duplicate `replayGuard` local identifier introduced during the wiring change that broke the server build under stricter TypeScript targets. (#112)

## [0.6.0] - 2026-04-17

### Added

- `ChallengeReplayGuard` class for in-memory challenge replay protection with automatic expiry cleanup
- `ChallengeAnalytics` class for server-side verification metrics tracking
- `replayGuard` option on `createVerifier()` to enable built-in replay detection
- `'replay'` as a new `VerifyResult.reason` when duplicate challenge IDs are rejected
- CI auto-release workflow (Friday schedule)
- Comprehensive replay guard test suite (14 tests)

### Changed

- `randomHex()` and `randomInt()` now throw when `crypto.getRandomValues` is unavailable instead of silently falling back to `Math.random()`
- HMAC signature in `ImRobotVerifier` now covers full pipeline to prevent pipeline-swap attacks
- `getClientIp()` extracts client IP from `X-Forwarded-For` and `X-Real-IP` proxy headers before falling back to `req.ip`
- Updated version badges to v0.6.0

### Fixed

- **HIGH**: Replay attack vulnerability — `ImRobotVerifier.verify()` now calls `replayGuard.markUsed()` to reject duplicate challenge submissions
- **HIGH**: `base64url()` in proof tokens now handles non-Latin1 Unicode correctly using `TextEncoder` + `btoa` (browser) or `Buffer` (Node)
- **MEDIUM**: `escapeHtml()` in web component now escapes single quotes (`'` → `&#39;`) to prevent XSS via attribute injection
- **MEDIUM**: Svelte component replaced self-referential `'imrobot/core'` and `'imrobot'` imports with relative paths
- **MEDIUM**: `ChallengeReplayGuard` and `ReplayGuardConfig` now properly exported from server index

### Security

- Full April 2026 security audit addressing HIGH and MEDIUM findings
- Enforced LF line endings via `.gitattributes`

## [0.5.0] - 2026-03-21

### Added

- Adaptive difficulty engine (`AdaptiveDifficulty`) that auto-adjusts challenge difficulty per agent based on behavioral patterns (failure rate, timing, rapid attempts)
- Risk scoring with 4 weighted factors and levels: low, medium, high, critical
- AI image challenge foundation (`ImageChallengePool`) with 4 provider types (OpenAI, Stability AI, custom, static) and 6 challenge types (object_count, spatial_reasoning, color_identification, scene_description, text_recognition, odd_one_out)
- Built-in prompt templates for all image challenge types with difficulty-scaled parameters
- 4 new pipeline operations: `vowel_count`, `consonant_extract`, `run_length_encode`, `atbash` (27 total)
- Compact widget mode via `size="compact"` prop (320px max-width, smaller typography)
- ARIA live regions and `role="alert"` for accessibility on status changes
- 94 new tests for adaptive difficulty, image challenges, and new operations (344 total)
- `.well-known/imrobot.json` discovery endpoint inspired by A2A Agent Card pattern
- `buildDiscoveryDocument()` for framework-agnostic discovery document generation
- `createDiscoveryHandler()` Express-compatible middleware for serving discovery documents
- `DiscoveryConfig` and `DiscoveryDocument` TypeScript types
- `.handler` property on `createAgentRouter()` for combined GET/POST routing (routes GET → challenge, POST → verify)
- 10 new tests for discovery module (222 total)
- Documentation: discovery endpoint section in README and docs page
- Natural-language challenge formatting (`formatOperationNL`, `formatPipelineNL`) with 3–4 randomised phrasings per operation — makes regex-based scraping of display text unreliable
- In-memory sliding window `RateLimiter` class with automatic expired-entry cleanup
- Rate limiting support for both `createAgentRouter` and `requireAgent` middleware via `rateLimit` config option
- Standard HTTP rate limit response headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`
- `RateLimiter.getStatus(key)` for inspecting remaining requests and reset time
- `RateLimiter.reset(key?)` to clear individual or all rate limit entries
- `RateLimiter.destroy()` for graceful shutdown cleanup
- `onLimitReached` callback option for rate limiter events
- 39 new tests for rate limiter (234 total)

### Changed

- Updated docs page with discovery endpoint section
- Updated docs page with rate limiting section and `RateLimiter` API reference
- Updated demo page middleware example to include `rateLimit` config
- Bumped version to 0.5.0

## [0.4.0] - 2026-03-16

### Added

- 5 new crypto pipeline operations: `sha256_hash`, `byte_xor`, `hash_chain`, `nibble_swap`, `bit_rotate` (23 total)
- JWT-like Proof-of-Agent tokens with HMAC-SHA256 signing (`ProofTokenIssuer`, `createTokenIssuer`)
- Framework-agnostic `requireAgent()` middleware with per-IP rate limiting
- `createAgentRouter()` factory for mounting challenge/verify endpoints
- Invisible zero-UI verification (`invisibleVerify`) with retry and exponential backoff
- CLI tool: `npx imrobot challenge|solve|verify|benchmark|info`
- 39 new tests covering all v0.4 features (195 total)

### Changed

- HMAC signature now covers the full pipeline (prevents pipeline-swap attacks)
- Updated demo page with v0.4 feature tabs (Middleware, Invisible, CLI) and 8 feature cards
- Updated docs page with Middleware, Proof-of-Agent Tokens, Invisible Verify, and CLI sections
- Bumped version to 0.4.0

### Fixed

- Pipeline tampering detection: HMAC now signs `id + verification + expiresAt + difficulty + pipeline`

## [0.3.1] - 2026-03-13

### Added

- `format:check` step in CI pipeline to catch formatting drift before merge
- npm package metadata: `repository`, `homepage`, `bugs`, and `author` fields
- Animated cyberpunk hero section with AI-generated visuals for demo site

### Changed

- Auto-formatted 7 source files with Prettier to match project style
- Bumped svelte from 4.2.20 to 5.53.5
- Bumped happy-dom from 14.12.3 to 20.8.3
- Bumped esbuild and vite in demo site

## [0.3.0] - 2026-03-13

### Added

- HMAC-SHA256 server SDK (`imrobot/server`) for tamper-proof, stateless challenge verification
- 6 new challenge operations: caesar, xor_encode, count_chars, slice_alternate, fnv1a_hash, length
- Comprehensive test suite: 130 tests across 5 suites (core, operations, server, screenshot shield, web component)
- Developer tooling: eslint, prettier, vitest, editorconfig
- CI pipeline with Node 18, 20, 22 matrix
- GitHub issue templates and PR template
- Project docs: CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, CHANGELOG.md

## [0.2.0] - 2026-03-12

### Fixed

- Harsh color transition between hero and body sections in dark mode

### Changed

- Improved README with npm badges, "Why" section, and demo link
- Streamlined README content for clarity

## [0.1.1] - 2026-03-06

### Added

- Screenshot protection with blur-by-default and JavaScript shield

### Fixed

- Auto-solve animation speed to avoid TTL expiry
- GitHub links pointing to correct repository

### Changed

- Synced README with code: fixed TTL defaults and added suspicious field docs

## [0.1.0] - 2026-02-26

### Added

- Core challenge generation, solving, and verification engine
- 12 string operations: reverse, base64_encode, to_upper, to_lower, rot13, hex_encode, sort_chars, char_code_sum, substring, repeat, replace, pad_start
- React component (`imrobot/react`)
- Vue 3 component (`imrobot/vue`)
- Svelte component (`imrobot/svelte`)
- Web Component (`imrobot/web-component`)
- Headless core API (`imrobot/core`)
- Anti-cheat protections: TTL expiry, hidden nonce, suspicious timing detection, anti-copy
- Light and dark theme support
- Interactive demo site deployed to Vercel
- Difficulty levels: easy, medium, hard
- Zero runtime dependencies
- Full TypeScript types with declaration maps

