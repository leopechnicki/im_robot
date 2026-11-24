// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM script, no type declarations
import { bumpVersionText, changelogSection, nextPatch, parseVersions, planRelease, readVersions } from '../scripts/release-plan.mjs'

const base = {
  npmVersion: '0.8.0',
  pyVersion: '0.8.0',
  pyModuleVersion: '0.8.0',
  tagExists: false,
  pyTagExists: false,
  lastTag: 'v0.7.3',
  commitSubjects: ['feat!: remove an image provider (#136)'],
  npmPublished: false,
  pypiPublished: false,
}

describe('planRelease', () => {
  it('releases a new version with unreleased commits: tag, npm, PyPI tag, bump PR', () => {
    const p = planRelease(base)
    expect(p).toMatchObject({
      tag: 'v0.8.0',
      pyTag: 'py-v0.8.0',
      createRelease: true,
      publishNpm: true,
      pushPyTag: true,
      openBumpPr: true,
      nextVersion: '0.8.1',
      errors: [],
    })
  })

  it('reproduces the 2026-10 silent no-op and now BLOCKS (fails loudly) instead', () => {
    // package.json still 0.7.3, tag v0.7.3 exists, 0.7.3 on npm, 3 commits since the tag.
    const p = planRelease({
      ...base,
      npmVersion: '0.7.3',
      pyVersion: '0.7.3',
      pyModuleVersion: '0.7.3',
      tagExists: true,
      pyTagExists: false,
      lastTag: 'v0.7.3',
      commitSubjects: ['build(deps-dev): bump vitest (#138)', 'build(deps-dev): bump group (#137)', 'feat!: remove an image provider (#136)'],
      npmPublished: true,
      pypiPublished: false,
    })
    expect(p.createRelease).toBe(false)
    expect(p.publishNpm).toBe(false)
    expect(p.openBumpPr).toBe(true)
    expect(p.errors).toHaveLength(1)
    expect(p.errors[0]).toMatch(/3 unreleased commit\(s\) on main since v0\.7\.3/)
    expect(p.summary).toMatch(/^BLOCKED/)
    // PyPI never got this version: the plan still heals it by pushing the py tag.
    expect(p.pushPyTag).toBe(true)
  })

  it('is green and does nothing when the tagged version is fully published and main has no new commits', () => {
    const p = planRelease({ ...base, tagExists: true, pyTagExists: true, commitSubjects: [], npmPublished: true, pypiPublished: true })
    expect(p).toMatchObject({ createRelease: false, publishNpm: false, pushPyTag: false, openBumpPr: false, errors: [] })
    expect(p.summary).toMatch(/^up to date/)
  })

  it('does not cut an empty release when the only new commit is the version bump', () => {
    const p = planRelease({ ...base, commitSubjects: ['chore: bump version to 0.8.0 (#140)'] })
    expect(p.createRelease).toBe(false)
    expect(p.errors).toEqual([])
    expect(p.summary).toMatch(/nothing to release/)
  })

  it('does not count bump commits as unreleased work behind an existing tag', () => {
    const p = planRelease({ ...base, tagExists: true, pyTagExists: true, npmPublished: true, pypiPublished: true, commitSubjects: ['chore: bump version to 0.8.1'] })
    expect(p.errors).toEqual([])
  })

  it('heals a tag that exists but never reached npm', () => {
    const p = planRelease({ ...base, tagExists: true, pyTagExists: true, commitSubjects: [], npmPublished: false, pypiPublished: true })
    expect(p.publishNpm).toBe(true)
    expect(p.createRelease).toBe(false)
    expect(p.errors).toEqual([])
    expect(p.summary).toMatch(/finishing: npm publish/)
  })

  it('fails loudly when the py tag exists but PyPI never got the version', () => {
    const p = planRelease({ ...base, tagExists: true, pyTagExists: true, commitSubjects: [], npmPublished: true, pypiPublished: false })
    expect(p.pushPyTag).toBe(false)
    expect(p.errors[0]).toMatch(/py-v0\.8\.0 exists but PyPI does not serve/)
  })

  it('skips npm publish when the version was published manually before tagging', () => {
    const p = planRelease({ ...base, npmPublished: true })
    expect(p.createRelease).toBe(true)
    expect(p.publishNpm).toBe(false)
  })

  it('refuses to release when the JS and Python versions drift', () => {
    const p = planRelease({ ...base, pyVersion: '0.7.2' })
    expect(p.createRelease).toBe(false)
    expect(p.publishNpm).toBe(false)
    expect(p.errors[0]).toMatch(/version drift/)
  })

  it('blocks when the version tag exists but is not an ancestor of HEAD', () => {
    const p = planRelease({ ...base, tagExists: true, tagIsAncestor: false, pyTagExists: true, npmPublished: true, pypiPublished: true })
    expect(p.publishNpm).toBe(false)
    expect(p.pushPyTag).toBe(false)
    expect(p.errors[0]).toMatch(/not an ancestor of HEAD/)
  })

  it('releases when there is no previous tag at all', () => {
    const p = planRelease({ ...base, lastTag: null, commitSubjects: ['chore: bump version to 0.8.0'] })
    expect(p.createRelease).toBe(true)
  })
})

describe('nextPatch', () => {
  it('bumps the patch number', () => {
    expect(nextPatch('0.8.0')).toBe('0.8.1')
    expect(nextPatch('1.2.9')).toBe('1.2.10')
  })
  it('rejects pre-release strings', () => {
    expect(() => nextPatch('0.8.0-rc.1')).toThrow()
  })
})

describe('changelogSection', () => {
  const md = '# Changelog\n\n## [Unreleased]\n\n## [0.8.0] - 2026-11-24\n\n### Removed\n\n- BREAKING: x\n\n## [0.7.3] - 2026-09-30\n\n- deps\n'
  it('extracts exactly one version section', () => {
    expect(changelogSection(md, '0.8.0')).toBe('### Removed\n\n- BREAKING: x')
    expect(changelogSection(md, '0.7.3')).toBe('- deps')
  })
  it('returns null for a missing version and does not treat dots as wildcards', () => {
    expect(changelogSection(md, '0.9.0')).toBeNull()
    expect(changelogSection(md, '0x8x0')).toBeNull()
  })
})

describe('repository state', () => {
  const root = path.resolve(__dirname, '..')
  it('keeps package.json, pyproject.toml and _version.py in lockstep', () => {
    const v = readVersions(root)
    expect(v.pyVersion).toBe(v.npmVersion)
    expect(v.pyModuleVersion).toBe(v.npmVersion)
  })
  it('has a CHANGELOG section for 0.8.0', () => {
    const body = changelogSection(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), '0.8.0')
    expect(body).toMatch(/BREAKING/)
  })
})

describe('bumpVersionText', () => {
  it('rewrites the three version sources and nothing else', () => {
    const pkg = '{\n  "name": "imrobot",\n  "version": "0.8.0",\n  "dependencies": { "x": "0.8.0" }\n}\n'
    const py = '[project]\nname = "imrobot"\nversion = "0.8.0"\n\n[tool.ruff]\ntarget-version = "py39"\n'
    const mod = '"""doc"""\n\n__version__ = "0.8.0"\n'
    const out = bumpVersionText({ pkg, py, mod }, '0.8.1')
    expect(JSON.parse(out.pkg).version).toBe('0.8.1')
    expect(JSON.parse(out.pkg).dependencies.x).toBe('0.8.0')
    expect(out.py).toContain('version = "0.8.1"')
    expect(out.py).toContain('target-version = "py39"')
    expect(out.mod).toContain('__version__ = "0.8.1"')
  })

  it('only touches the [project] table, also when it is the last table', () => {
    const pkg = '{"version": "0.8.0"}'
    const mod = '__version__ = "0.8.0"\n'
    const py = '[tool.x]\nversion = "9.9.9"\n\n[project]\nname = "imrobot"\nversion = "0.8.0"\n'
    const out = bumpVersionText({ pkg, py, mod }, '0.8.1')
    expect(out.py).toContain('[tool.x]\nversion = "9.9.9"')
    expect(parseVersions(out).pyVersion).toBe('0.8.1')
  })

  it('refuses a dynamic [project] version instead of rewriting another table', () => {
    const pkg = '{"version": "0.8.0"}'
    const mod = '__version__ = "0.8.0"\n'
    const py = '[project]\nname = "imrobot"\ndynamic = ["version"]\n\n[tool.hatch.version]\nversion = "0.8.0"\n'
    expect(() => bumpVersionText({ pkg, py, mod }, '0.8.1')).toThrow(/no static version/)
  })

  it('refuses when _version.py has no __version__', () => {
    const py = '[project]\nversion = "0.8.0"\n'
    expect(() => bumpVersionText({ pkg: '{"version": "0.8.0"}', py, mod: 'VERSION = "0.8.0"\n' }, '0.8.1')).toThrow(
      /did not take/,
    )
  })
})
