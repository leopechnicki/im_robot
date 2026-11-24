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
   - dispatches **Publish to npm** (`publish.yml`, trusted publishing, `--provenance`) and waits until npm serves the version,
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

- **npm** (trusted publishing, no token): npmjs.com -> `imrobot` -> Settings ->
  Trusted publishing -> GitHub Actions, repository `leopechnicki/im_robot`, workflow
  `publish.yml`. npm matches the filename of the TOP-LEVEL workflow, so `publish.yml`
  must never become a reusable workflow again: Auto Release dispatches it
  (`gh workflow run publish.yml`) and waits until npm serves the version. When it
  was called with `workflow_call` the token said `auto-release.yml`, npm fell back
  to `NPM_TOKEN`, and the v0.9.0 publish died with EOTP (run 45456381801).
  `NPM_TOKEN` is only a fallback and needs a one-time password, so it cannot
  publish from CI.
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

## Consumer smoke test (after every release)

Registry checks prove an upload, not that a consumer can use it. In a throwaway
directory (delete it afterwards):

```bash
npm init -y && npm i imrobot@X.Y.Z jose
# issue with ProofTokenIssuer (imrobot/server), verify with jose.jwtVerify(token, secret, { algorithms: ['HS256'] })
python -m venv venv && venv/bin/pip install imrobot==X.Y.Z PyJWT
# issue with imrobot.ProofTokenIssuer, verify with jwt.decode(token, secret, algorithms=["HS256"])
```

Both must pass, and the signature segment must be 43 characters (base64url of the
32 raw HMAC bytes). Also compare `npm view imrobot@X.Y.Z readme` with the tag's
`README.md`. `pypi.org/pypi/imrobot/json` is CDN-cached for up to 15 minutes; right
after a release use `pypi.org/pypi/imrobot/X.Y.Z/json`. 0.9.1 passed all of this on
2026-11-24.
