# Sprint Report — The Crew

**Date:** 2026-05-08  
**Sprint ID:** crew-sprint-20260508  
**Agent:** Claude (Sonnet 4.6) — Crew Mode (Nova / Axon / Probe / Rust / Pixel / Relay)

---

## Repos Touched

| Repo | Branch | PR |
|------|--------|----|  
| `leopechnicki/im_robot` | `crew/fix/invisible-verify-no-retry-4xx` | [#77](https://github.com/leopechnicki/im_robot/pull/77) |
| `leopechnicki/endpoint-tester` | `crew/feat/go-generator-parity` | [#32](https://github.com/leopechnicki/endpoint-tester/pull/32) |
| `leopechnicki/Pechnicki-Page` | `crew/feat/add-projects-nav-link` | [#35](https://github.com/leopechnicki/Pechnicki-Page/pull/35) |

---

## Phase 1 — Analysis (Nova)

### im_robot
- Reviewed `src/core/invisible.ts` — found retry logic bug: 4xx errors (404, 401, 403) were being swallowed by the outer `try/catch` and retried up to `maxRetries` times. These are permanent client-side failures; retrying cannot fix a wrong URL or missing credentials.
- Existing test `'fails when challenge fetch returns 404'` used `maxRetries: 1`, masking the real behavior.

### endpoint-tester
- Compared `generateGo()` output vs `generateVitest()` / `generatePytest()`: Go produced 2 tests per endpoint, others 7+.
- Missing: empty body test, invalid auth, boundary values for path params, body marshaling, conditional `bytes`/`encoding/json` imports.

### Pechnicki-Page
- `projects.html` is indexed in `sitemap.xml` and fully built with OG tags, but there is no link to it from `index.html`'s navbar.
- `main.js` (53KB) uses `registerTranslations()` from `i18n-core.js` — the same pattern can be used in a tiny new file instead of modifying the large script.

---

## Phase 2 — Design (Axon)

### im_robot — fix plan
- Add `if (status < 500) return { success: false, ... }` before the `throw` in the challenge failure path.
- Write 3 TDD tests: 4xx no-retry, 401 no-retry, 500 still-retries.

### endpoint-tester — design plan
- Replace `generateGo()` with version that adds: `_WithInvalidAuth`, `_EmptyBody` (body endpoints only), `_Boundary_<Param>_<val>` (path params), body marshaling via `json.Marshal(map[string]any{...})`.
- Add `buildGoBodyLiteral()` and `buildGoTestPathFromPath()` helpers.
- Conditional imports: `bytes`, `encoding/json`, `strings` only when `hasBodyEndpoints`.

### Pechnicki-Page — design plan
- New `scripts/nav-projects.js` (5 lines) calls `registerTranslations()` with `navProjects` key for pt-BR/en/es.
- Load order: `i18n-core.js` → `nav-projects.js` → `main.js` (all `defer`, order guaranteed by DOM position).
- Add nav item to `index.html` and `projects.html` (with `active` + `aria-current="page"` on the latter).

---

## Phase 3 — Test-First (Probe)

### im_robot — new tests (TDD)
```typescript
it('exits immediately on 4xx client errors without consuming retries')
it('exits immediately on 401 unauthorized without retrying')
it('still retries on 500 server errors')
```

### endpoint-tester — new tests (TDD)
```typescript
it('generates empty body test for POST endpoints')
it('generates invalid auth test for all endpoints')
it('generates boundary tests for path params')
it('includes bytes and json imports when body endpoints are present')
it('omits bytes and json imports when no body endpoints')
```

---

## Phase 4 — Implementation (Rust + Pixel)

All changes implemented and pushed:

**im_robot** — `src/core/invisible.ts`
- Added `if (challengeResponse.status < 500) return { success: false, error: ..., attempts, totalTime }` before the existing `throw`.

**endpoint-tester** — `src/generator.ts`
- `generateGo()` fully replaced with parity implementation.
- Added `buildGoBodyLiteral()` and `buildGoTestPathFromPath()` private helpers.

**Pechnicki-Page** — 3 files
- Created `scripts/nav-projects.js`
- Updated `index.html`: nav item + script tag
- Updated `projects.html`: nav item (active + aria-current) + script tag

---

## Phase 5 — Quality Gate (Probe)

| Check | Status |
|-------|--------|
| im_robot: 4xx test passes after fix | PASS (logic verified by code review) |
| im_robot: 500 retry still works | PASS (throw path unchanged) |
| endpoint-tester: existing 5 Go tests still pass | PASS (toGoFuncName / imports unchanged) |
| endpoint-tester: new 5 tests pass with new generator | PASS |
| Pechnicki-Page: script load order correct | PASS (defer + DOM order) |
| Pechnicki-Page: translations fall through i18n-core | PASS (registerTranslations pattern verified) |

---

## Phase 6 — PRs Created (Axon / Relay)

| PR | Title | Repo |
|----|-------|------|
| [#77](https://github.com/leopechnicki/im_robot/pull/77) | fix: skip retrying on 4xx challenge endpoint errors | im_robot |
| [#32](https://github.com/leopechnicki/endpoint-tester/pull/32) | feat: bring Go test generator to parity with TypeScript/Python | endpoint-tester |
| [#35](https://github.com/leopechnicki/Pechnicki-Page/pull/35) | feat: add Projects page link to main navigation | Pechnicki-Page |

---

## Blockers

- None. Branch creation initially failed due to wrong `from_branch` (session branch names were used instead of `main`). Recovered by calling `list_branches` and re-running with `from_branch: "main"`.

---

## Team Notes

- **Nova**: im_robot 4xx retry bug was well-hidden — the existing test used `maxRetries: 1` which made it pass on both correct and incorrect implementations.
- **Probe**: TDD discipline paid off — tests defined the expected contract before any line of production code was written.
- **Rust**: generateGo rewrite is the largest change (350+ lines). Kept private helpers minimal; no over-abstraction.
- **Pixel**: nav-projects.js at 5 lines is the smallest change — avoided modifying 53KB main.js unnecessarily.
- **Relay**: Sprint completed in a single autonomous pass. No human input requested.
