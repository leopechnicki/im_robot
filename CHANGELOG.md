# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Hono adapter (`imrobot/hono`) — `createHonoAgentRouter()` + `requireAgentHono()` for Bun, Cloudflare Workers, and Deno. Shares the same `ImRobotVerifier` and `ProofTokenIssuer` as the Express middleware, so JWTs verify identically across both runtimes. (#123)
- Python SDK (`pip install imrobot`) — companion package for LangChain / CrewAI / AutoGPT agents and FastAPI / Starlette servers. Byte-identical wire format with the JS SDK (interop tests pin FNV-1a, HMAC-SHA256, and base64url reference outputs). Python 3.9–3.13 supported. PyPI auto-publish via OIDC trusted publishing. (#125)
- `imrobot test-agent <url>` CLI command — probes any URL for imrobot support by checking `.well-known/imrobot.json`, `data-imrobot-challenge` DOM attributes, and `<script>`/`<meta>` markers. Useful in CI scripts. Exit codes: `0` = accepts agents, `1` = no signals, `2` = network/usage error. (#122)
- Vitest coverage tooling and Codecov badges. (#121)

### Changed

- `formatOperation({ op: 'sha256_hash' })` documentation updated to make clear the operation uses cascaded FNV-1a, not RFC 6234 SHA-256. Wire format unchanged. (#124)
- Demo site: accessibility and responsive polish — improved ARIA labels, focus management, mobile navigation, and layout at small viewports. (#119)

## [0.7.2] - 2026-07-12

Republish of `0.7.1` after the auto-release publish guard landed in `#117`. No source changes vs `0.7.1`; the bump exists so that Friday's Auto Release workflow could ship the fixed publish pipeline as a clean version on npm.

### Changed

- Version bump only (`package.json` 0.7.1 → 0.7.2). (#118)

## [0.7.1] - 2026-07-03

### Fixed

- Auto Release (Friday) workflow now queries the npm registry via `npm view <pkg> versions --json` before invoking the reusable `publish.yml` and skips the publish job when the current `package.json` version is already on npm. This prevents the E403 "cannot publish over the previously published version" error observed on run 28647189182 (2026-07-03) after a manual publish had already shipped v0.7.0. `publish.yml` itself is untouched. (#117)

### Changed

- `vite` bumped from 8.0.8 → 8.0.16 in the root project and from 7.3.2 → 8.0.16 in `demo/`. `esbuild` removed as a direct `demo/` dependency (still pulled transitively through vite). (#107)

## [0.7.0] - 2026-07-03

### Added

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

