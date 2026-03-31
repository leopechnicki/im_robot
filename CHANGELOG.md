# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `.well-known/imrobot.json` discovery endpoint inspired by A2A Agent Card pattern
- `buildDiscoveryDocument()` for framework-agnostic discovery document generation
- `createDiscoveryHandler()` Express-compatible middleware for serving discovery documents
- `DiscoveryConfig` and `DiscoveryDocument` TypeScript types
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
