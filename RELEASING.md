# Releasing imrobot

One version, two registries: npm `imrobot` and PyPI `imrobot` ship together
under the same version number.

## How a release happens

1. Work lands on `main` through PRs. Write the user-facing notes under
   `## [Unreleased]` in `CHANGELOG.md` as you go.
2. To cut a release, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`
   (keep an empty `## [Unreleased]` above it) and set the version everywhere:

   ```bash
   npm version X.Y.Z --no-git-tag-version
   node scripts/release-plan.mjs bump X.Y.Z   # package.json, python/pyproject.toml, python/src/imrobot/_version.py
   ```

   Merge that PR. `test/release-plan.test.ts` fails if the three versions drift.
3. **Auto Release (Friday)** runs every Friday at 12:00 UTC, or on demand
   (Actions -> Auto Release (Friday) -> Run workflow). It runs
   `node scripts/release-plan.mjs plan` and then:
   - creates tag `vX.Y.Z` + the GitHub release (notes from the CHANGELOG section),
   - publishes to npm (`publish.yml`, with `--provenance`) and checks that npm serves the version,
   - pushes tag `py-vX.Y.Z` on the same commit, which starts **Publish Python SDK**
     (`publish-python.yml`, PyPI trusted publishing) and checks that PyPI serves the version,
   - opens the `chore: bump version to X.Y.(Z+1)` PR for the next cycle.

## What the colours mean

| Auto Release | Meaning |
|---|---|
| green, "up to date" | Everything on main is released. |
| green, "release vX.Y.Z" | A release was just made. Check the Publish Python SDK run too. |
| green, "nothing to release" | The version was bumped but main has no other commit since the last tag. |
| **red, "N unreleased commit(s) on main since vX.Y.Z"** | main has work no release will pick up. Merge the bump PR (it is reopened for you) or bump the version, then re-run. Do not close the bump PR without bumping another way; that is exactly how 0.7.3 -> 0.8.0 stalled for eight weeks behind green runs. |
| red, "version drift" | `package.json`, `pyproject.toml` and `_version.py` disagree. |
| red, "py-vX.Y.Z exists but PyPI does not serve" | The Python publish failed. Fix and re-run Publish Python SDK for that tag. |

A tag that exists without its npm or PyPI upload is finished by the next run.

## One-time registry setup

- **npm**: the `NPM_TOKEN` repo secret (granular token with publish rights on
  `imrobot`). npm granular write tokens expire; when a publish fails with E401/E403,
  either issue a new token, or switch to npm trusted publishing: npmjs.com ->
  `imrobot` -> Settings -> Trusted publishing -> GitHub Actions, repository
  `leopechnicki/im_robot`, workflow `auto-release.yml` (the workflow that calls
  `publish.yml`; npm validates the calling workflow's filename, per npm's
  trusted-publisher docs, so a manual run of `publish.yml` on its own would then
  still need `NPM_TOKEN`). `publish.yml` already runs npm >= 11.5.1 and has
  `id-token: write`, so no code change is needed.
- **PyPI** (trusted publishing, no token): pypi.org -> Your account -> Publishing ->
  add a (pending) GitHub publisher: project `imrobot`, owner `leopechnicki`,
  repository `im_robot`, workflow `publish-python.yml`, environment `pypi`.

## Checking a release by hand

```bash
npm view imrobot version
curl -s https://pypi.org/pypi/imrobot/json | python -c "import json,sys; print(json.load(sys.stdin)['info']['version'])"
node scripts/release-plan.mjs verify --npm X.Y.Z --timeout-s 60
node scripts/release-plan.mjs verify --pypi X.Y.Z --timeout-s 60
```
