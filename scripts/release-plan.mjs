#!/usr/bin/env node
// Release planner for the Friday auto-release (and manual dispatch).
//
// Why this exists: from 2026-09-30 to 2026-11-24 the auto-release workflow
// reported SUCCESS every week and published nothing. The version-bump PR
// (#135) had been closed, package.json stayed at 0.7.3, the tag v0.7.3
// already existed, the workflow printed a warning and exited 0. Unreleased
// commits sat on main for two months behind a green run.
//
// The decision is now a pure, unit-tested function (planRelease). The rule
// it enforces: a run is green only when main is fully released (or a release
// was just made). Unreleased commits behind an already-released version make
// the run FAIL with the reason, after it has (re)opened the bump PR.
//
// Usage (CI):
//   node scripts/release-plan.mjs plan            -> JSON plan on stdout, GITHUB_OUTPUT + step summary
//   node scripts/release-plan.mjs notes <version> -> CHANGELOG section for <version> on stdout
//   node scripts/release-plan.mjs bump <version>  -> set package.json, pyproject.toml, _version.py to <version>
//   node scripts/release-plan.mjs verify --npm <v> | --pypi <v> [--timeout-s N]
//                                                 -> exit 0 once the registry serves <v>, 1 on timeout

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const BUMP_COMMIT_RE = /^chore: bump version to \d+\.\d+\.\d+/

/** Next patch version ("0.8.0" -> "0.8.1"). */
export function nextPatch(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`not a plain semver version: ${version}`)
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

/**
 * Decide what a release run must do. Pure: every fact comes in through `s`.
 *
 * @param {object} s
 * @param {string} s.npmVersion        package.json version
 * @param {string} s.pyVersion         python/pyproject.toml [project].version
 * @param {string} s.pyModuleVersion   python/src/imrobot/_version.py __version__
 * @param {boolean} s.tagExists        git tag v<npmVersion> exists
 * @param {boolean} s.pyTagExists      git tag py-v<npmVersion> exists
 * @param {string|null} s.lastTag      newest v* tag reachable from HEAD (null = none)
 * @param {string[]} s.commitSubjects  subjects of commits lastTag..HEAD (all commits if no tag)
 * @param {boolean} s.npmPublished     npm serves imrobot@<npmVersion>
 * @param {boolean} s.pypiPublished    PyPI serves imrobot==<npmVersion>
 */
export function planRelease(s) {
  const version = s.npmVersion
  const plan = {
    version,
    tag: `v${version}`,
    pyTag: `py-v${version}`,
    createRelease: false,
    publishNpm: false,
    pushPyTag: false,
    openBumpPr: false,
    nextVersion: nextPatch(version),
    unreleasedCommits: 0,
    errors: [],
    summary: '',
  }

  if (s.pyVersion !== version || s.pyModuleVersion !== version) {
    plan.errors.push(
      `version drift: package.json=${version}, pyproject.toml=${s.pyVersion}, ` +
        `_version.py=${s.pyModuleVersion}. The JS and Python SDKs release in lockstep; ` +
        `set all three to the same version.`,
    )
    plan.summary = 'BLOCKED: version drift'
    return plan
  }

  const releasable = s.commitSubjects.filter((subj) => !BUMP_COMMIT_RE.test(subj))
  plan.unreleasedCommits = releasable.length

  if (!s.tagExists) {
    if (s.lastTag !== null && releasable.length === 0) {
      plan.summary = `nothing to release: ${version} is staged but main has no commits since ${s.lastTag} besides version bumps`
      return plan
    }
    plan.createRelease = true
    plan.publishNpm = !s.npmPublished
    plan.pushPyTag = !s.pyTagExists && !s.pypiPublished
    plan.openBumpPr = true
    plan.summary = `release ${plan.tag} (${releasable.length} commit(s) since ${s.lastTag ?? 'the start'})`
    return plan
  }

  // Tag already exists: heal half-finished releases, then refuse to stay silent
  // about commits that no release will ever pick up.
  plan.publishNpm = !s.npmPublished
  plan.pushPyTag = !s.pyTagExists && !s.pypiPublished
  if (s.pyTagExists && !s.pypiPublished) {
    plan.errors.push(
      `${plan.pyTag} exists but PyPI does not serve imrobot==${version}: the "Publish Python SDK" run for that tag failed. ` +
        `Fix it and re-run that workflow.`,
    )
  }
  // The commits counted here are lastTag..HEAD; lastTag is the existing tag for this version.
  if (releasable.length > 0) {
    plan.openBumpPr = true
    plan.errors.push(
      `${releasable.length} unreleased commit(s) on main since ${plan.tag}, but package.json is still ${version}. ` +
        `Merge the "chore: bump version to ${plan.nextVersion}" PR (or bump to a higher version) and re-run.`,
    )
  }
  const healed = [plan.publishNpm && 'npm publish', plan.pushPyTag && `push ${plan.pyTag}`].filter(Boolean)
  if (plan.errors.length) plan.summary = 'BLOCKED: ' + plan.errors.join(' ')
  else if (healed.length) plan.summary = `${plan.tag} already tagged; finishing: ${healed.join(', ')}`
  else plan.summary = `up to date: ${plan.tag} is tagged and on npm + PyPI, no unreleased commits`
  return plan
}

/** Extract the "## [version]" section body from a Keep-a-Changelog file. */
export function changelogSection(text, version) {
  const lines = text.split(/\r?\n/)
  const head = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`)
  const start = lines.findIndex((l) => head.test(l))
  if (start === -1) return null
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l))
  if (end === -1) end = lines.length
  return lines.slice(start + 1, end).join('\n').trim()
}

/**
 * Rewrite the three version sources (package.json, pyproject.toml [project],
 * _version.py) to `version`. Text in, text out, so it is testable without a repo.
 */
export function bumpVersionText({ pkg, py, mod }, version) {
  nextPatch(version) // validates plain semver
  const pkgJson = JSON.parse(pkg)
  pkgJson.version = version
  const newPkg = JSON.stringify(pkgJson, null, 2) + '\n'
  const newPy = py.replace(/(^\[project\]\s*$[\s\S]*?^version\s*=\s*")[^"]+(")/m, `$1${version}$2`)
  const newMod = mod.replace(/^(__version__\s*=\s*")[^"]+(")/m, `$1${version}$2`)
  if (newPy === py && !py.includes(`version = "${version}"`)) throw new Error('pyproject.toml: [project] version not found')
  if (newMod === mod && !mod.includes(`"${version}"`)) throw new Error('_version.py: __version__ not found')
  return { pkg: newPkg, py: newPy, mod: newMod }
}

// ---------------------------------------------------------------- IO helpers

const NPM_NAME = 'imrobot'
const PYPI_NAME = 'imrobot'

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd)
  } catch {
    return null
  }
}

export function readVersions(root) {
  const npmVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version
  const pyproject = readFileSync(path.join(root, 'python', 'pyproject.toml'), 'utf8')
  const projectBlock = /^\[project\]\s*$([\s\S]*?)(?=^\[)/m.exec(pyproject)
  const pyVersion = projectBlock && /^version\s*=\s*"([^"]+)"/m.exec(projectBlock[1])?.[1]
  const mod = readFileSync(path.join(root, 'python', 'src', 'imrobot', '_version.py'), 'utf8')
  const pyModuleVersion = /^__version__\s*=\s*"([^"]+)"/m.exec(mod)?.[1]
  return { npmVersion, pyVersion: pyVersion ?? '(missing)', pyModuleVersion: pyModuleVersion ?? '(missing)' }
}

/** GET a registry URL; 404 -> null, other non-200 or network error -> throw (never guess). */
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.json()
}

export async function npmHasVersion(version) {
  const doc = await getJson(`https://registry.npmjs.org/${NPM_NAME}`)
  return Boolean(doc && doc.versions && doc.versions[version])
}

export async function pypiHasVersion(version) {
  const doc = await getJson(`https://pypi.org/pypi/${PYPI_NAME}/${version}/json`)
  return Boolean(doc && doc.info && doc.info.version === version)
}

async function gatherState(root) {
  const v = readVersions(root)
  const lastTag = tryGit(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'], root)
  const range = lastTag ? [`${lastTag}..HEAD`] : ['HEAD']
  const log = git(['log', '--no-merges', '--format=%s', ...range], root)
  return {
    ...v,
    tagExists: tryGit(['rev-parse', '-q', '--verify', `refs/tags/v${v.npmVersion}`], root) !== null,
    pyTagExists: tryGit(['rev-parse', '-q', '--verify', `refs/tags/py-v${v.npmVersion}`], root) !== null,
    lastTag,
    commitSubjects: log ? log.split('\n') : [],
    npmPublished: await npmHasVersion(v.npmVersion),
    pypiPublished: await pypiHasVersion(v.npmVersion),
  }
}

function writeGithubOutputs(plan) {
  const out = process.env.GITHUB_OUTPUT
  if (out) {
    const kv = {
      version: plan.version,
      tag: plan.tag,
      py_tag: plan.pyTag,
      next_version: plan.nextVersion,
      create_release: plan.createRelease,
      publish_npm: plan.publishNpm,
      push_py_tag: plan.pushPyTag,
      open_bump_pr: plan.openBumpPr,
      blocked: plan.errors.length > 0,
      blocked_reason: plan.errors.join(' ').replace(/\r?\n/g, ' '),
    }
    appendFileSync(out, Object.entries(kv).map(([k, val]) => `${k}=${val}\n`).join(''))
  }
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) {
    appendFileSync(summary, `### Release plan\n\n${plan.summary}\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n`)
  }
}

async function verify(kind, version, timeoutS) {
  const check = kind === 'npm' ? npmHasVersion : pypiHasVersion
  const deadline = Date.now() + timeoutS * 1000
  for (;;) {
    try {
      if (await check(version)) {
        console.log(`${kind}: imrobot ${version} is live`)
        return 0
      }
    } catch (e) {
      console.log(`${kind}: check failed (${e.message}), retrying`)
    }
    if (Date.now() > deadline) {
      console.error(`::error::${kind} does not serve imrobot ${version} after ${timeoutS}s`)
      return 1
    }
    await new Promise((r) => setTimeout(r, 15000))
  }
}

async function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const [cmd, ...rest] = argv
  if (cmd === 'plan') {
    const plan = planRelease(await gatherState(root))
    writeGithubOutputs(plan)
    console.log(JSON.stringify(plan, null, 2))
    return 0
  }
  if (cmd === 'notes') {
    const version = rest[0]
    const body = changelogSection(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version)
    if (!body) {
      console.error(`::error::CHANGELOG.md has no "## [${version}]" section. Write the release notes before releasing.`)
      return 1
    }
    console.log(body)
    return 0
  }
  if (cmd === 'bump') {
    const version = rest[0]
    const files = {
      pkg: path.join(root, 'package.json'),
      py: path.join(root, 'python', 'pyproject.toml'),
      mod: path.join(root, 'python', 'src', 'imrobot', '_version.py'),
    }
    const out = bumpVersionText(
      { pkg: readFileSync(files.pkg, 'utf8'), py: readFileSync(files.py, 'utf8'), mod: readFileSync(files.mod, 'utf8') },
      version,
    )
    for (const k of Object.keys(files)) writeFileSync(files[k], out[k])
    console.log(`bumped package.json, pyproject.toml, _version.py to ${version}`)
    return 0
  }
  if (cmd === 'verify') {
    const kind = rest[0] === '--npm' ? 'npm' : rest[0] === '--pypi' ? 'pypi' : null
    const version = rest[1]
    const t = rest.indexOf('--timeout-s')
    const timeoutS = t >= 0 ? Number(rest[t + 1]) : 600
    if (!kind || !version) {
      console.error('usage: release-plan.mjs verify --npm|--pypi <version> [--timeout-s N]')
      return 2
    }
    return verify(kind, version, timeoutS)
  }
  console.error('usage: release-plan.mjs plan | notes <version> | verify --npm|--pypi <version>')
  return 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`::error::release-plan failed: ${err.stack || err}`)
      process.exit(1)
    },
  )
}
