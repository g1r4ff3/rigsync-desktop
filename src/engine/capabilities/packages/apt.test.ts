import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import { captureApt, diffApt, findKeyringRef, planApt } from './apt'
import { readCommonPackages, readEffectivePackages } from './io'
import { makeFakeAptProvider } from './testHelpers'

// 케이스 출처: 구 repo ~/repos/rigsync/rigsync.py capture_apt/diff_apt/plan_apt +
// tests/test_ignore.py TestIgnoreAptCapture/TestIgnoreAptDiff (행동만 옮김).

describe('findKeyringRef', () => {
  it('extracts a deb822 Signed-By path', () => {
    const text =
      'Types: deb\nURIs: https://example.com\nSigned-By: /usr/share/keyrings/example.gpg\n'
    expect(findKeyringRef(text)).toBe('/usr/share/keyrings/example.gpg')
  })

  it('extracts a one-line signed-by=... reference', () => {
    const text = 'deb [signed-by=/usr/share/keyrings/example.gpg] https://example.com stable main\n'
    expect(findKeyringRef(text)).toBe('/usr/share/keyrings/example.gpg')
  })

  it('returns empty for an inline armored key (nothing to copy)', () => {
    const text = 'Signed-By:\n -----BEGIN PGP PUBLIC KEY BLOCK-----\n'
    expect(findKeyringRef(text)).toBe('')
  })

  it('returns empty when there is no Signed-By at all', () => {
    expect(findKeyringRef('deb https://example.com stable main\n')).toBe('')
  })
})

describe('captureApt / diffApt / planApt', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reports skipped when apt-mark is unavailable', async () => {
    const provider = makeFakeAptProvider({ available: false })
    const report = await captureApt(fixture.ctx, provider, { dryRun: false })
    expect(report.skipped).toBe(true)

    const diff = await diffApt(fixture.ctx, provider)
    expect(diff.skipped).toBe(true)
  })

  it('captures manually-installed packages into the manifest', async () => {
    const provider = makeFakeAptProvider({ manual: ['git', 'curl'] })
    const report = await captureApt(fixture.ctx, provider, { dryRun: false })

    expect(report.packagesInManifest).toBe(2)
    expect(report.packagesAdded).toBe(2)

    const apt = readCommonPackages(fixture.ctx).apt
    expect(apt?.packages).toEqual(['curl', 'git'])
  })

  it('captures a source file and its referenced keyring', async () => {
    const sourceContent =
      'Types: deb\nURIs: https://example.com\nSigned-By: /usr/share/keyrings/example.gpg\n'
    const provider = makeFakeAptProvider({
      manual: [],
      sourceFiles: [{ name: 'example.sources', content: sourceContent }],
      files: { '/usr/share/keyrings/example.gpg': 'PGPKEYBYTES' }
    })

    const report = await captureApt(fixture.ctx, provider, { dryRun: false })
    expect(report.sourcesCaptured).toBe(1)
    expect(report.keyringsCaptured).toBe(1)

    const apt = readCommonPackages(fixture.ctx).apt
    const source = apt?.sources?.[0]
    expect(source?.name).toBe('example.sources')
    expect(source?.keyringDest).toBe('/usr/share/keyrings/example.gpg')

    const storedSource = path.join(fixture.manifestDir, source!.file)
    expect(fs.readFileSync(storedSource, 'utf-8')).toBe(sourceContent)
    const storedKeyring = path.join(
      fixture.manifestDir,
      'packages',
      'apt',
      'keyrings',
      'example.gpg'
    )
    expect(fs.readFileSync(storedKeyring, 'utf-8')).toBe('PGPKEYBYTES')
  })

  it('dry-run computes counts but writes nothing', async () => {
    const provider = makeFakeAptProvider({ manual: ['git'] })
    await captureApt(fixture.ctx, provider, { dryRun: true })
    expect(fs.existsSync(path.join(fixture.manifestDir, 'common', 'packages.toml'))).toBe(false)
  })

  it('diff reports to_install (manifested, not manually installed) and uncaptured (installed, not manifested)', async () => {
    const provider = makeFakeAptProvider({ manual: ['git'] })
    await captureApt(fixture.ctx, provider, { dryRun: false }) // seeds "git" into manifest

    const laterProvider = makeFakeAptProvider({ manual: ['git', 'unityhub'] })
    const diff = await diffApt(fixture.ctx, laterProvider)
    expect(diff.toInstall).toEqual([]) // git is both manifested and installed
    expect(diff.uncaptured).toEqual(['unityhub'])
  })

  it('plan produces one privileged apt-get install action for to_install packages', async () => {
    const provider = makeFakeAptProvider({ manual: [] })
    const diff = {
      skipped: false,
      toInstall: ['git', 'curl'],
      uncaptured: [],
      sourcesMissing: [],
      sourcesContentChanged: []
    }
    const actions = planApt(fixture.ctx, provider, diff)
    expect(actions).toHaveLength(1)
    expect(actions[0].privileged).toBe(true)
    expect(actions[0].commands[0]).toBe('sudo apt-get install -y git curl')
  })

  // 케이스 출처: tests/test_ignore.py TestIgnoreAptCapture
  it('never adds an ignored package (test_capture_never_adds_ignored_package)', async () => {
    writeIgnore(fixture, { apt: { packages: ['unityhub'], sources: [] } })
    const provider = makeFakeAptProvider({ manual: ['git', 'unityhub'] })
    await captureApt(fixture.ctx, provider, { dryRun: false })

    const apt = readEffectivePackages(fixture.ctx).apt
    expect(apt?.packages).toContain('git')
    expect(apt?.packages).not.toContain('unityhub')
  })

  it('removes an already-manifested package once ignored (test_capture_removes_already_manifested_then_ignored_package)', async () => {
    const provider1 = makeFakeAptProvider({ manual: ['git', 'unityhub'] })
    await captureApt(fixture.ctx, provider1, { dryRun: false })
    writeIgnore(fixture, { apt: { packages: ['unityhub'], sources: [] } })

    const provider2 = makeFakeAptProvider({ manual: ['git'] })
    await captureApt(fixture.ctx, provider2, { dryRun: false })

    const apt = readEffectivePackages(fixture.ctx).apt
    expect(apt?.packages).not.toContain('unityhub')
    expect(apt?.packages).toContain('git')
  })

  it('removes an already-manifested ignored source (test_capture_removes_already_manifested_ignored_source)', async () => {
    const provider1 = makeFakeAptProvider({
      manual: [],
      sourceFiles: [
        { name: 'tailscale.list', content: 'deb https://pkgs.tailscale.com stable main\n' }
      ]
    })
    await captureApt(fixture.ctx, provider1, { dryRun: false })
    writeIgnore(fixture, { apt: { packages: [], sources: ['tailscale.list'] } })

    const provider2 = makeFakeAptProvider({ manual: [], sourceFiles: [] })
    await captureApt(fixture.ctx, provider2, { dryRun: false })

    const apt = readEffectivePackages(fixture.ctx).apt
    const names = (apt?.sources ?? []).map((s) => s.name)
    expect(names).not.toContain('tailscale.list')
  })

  // 케이스 출처: tests/test_ignore.py TestIgnoreAptDiff
  it('is silent in diff for an ignored package (test_diff_silent_for_ignored_package)', async () => {
    const provider1 = makeFakeAptProvider({ manual: ['git', 'unityhub'] })
    await captureApt(fixture.ctx, provider1, { dryRun: false })
    writeIgnore(fixture, { apt: { packages: ['unityhub'], sources: [] } })

    const provider2 = makeFakeAptProvider({ manual: ['git'] })
    const diff = await diffApt(fixture.ctx, provider2)
    expect(diff.toInstall).not.toContain('unityhub')
    expect(diff.uncaptured).not.toContain('unityhub')
  })

  it('is silent in diff when an ignored package is installed but uncaptured (test_diff_silent_when_ignored_package_installed_but_uncaptured)', async () => {
    const provider1 = makeFakeAptProvider({ manual: ['git'] })
    await captureApt(fixture.ctx, provider1, { dryRun: false })
    writeIgnore(fixture, { apt: { packages: ['unityhub'], sources: [] } })

    const provider2 = makeFakeAptProvider({ manual: ['git', 'unityhub'] })
    const diff = await diffApt(fixture.ctx, provider2)
    expect(diff.uncaptured).not.toContain('unityhub')
  })
})
