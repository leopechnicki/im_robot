# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
