import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import {
  captureApt,
  diffApt,
  findKeyringRef,
  parseAptRemoveDryRun,
  planApt,
  planAptUninstall
} from './apt'
import { writeAptBaseline } from './aptBaseline'
import { readCommonPackages, readEffectivePackages, writeCommonAptSection } from './io'
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
    // 대부분의 기존 케이스는 "capture가 그냥 캡처한다"는 전제라, baseline
    // 스냅샷 자체를 다루는 케이스만 빼고 여기서 빈 baseline을 미리 심어
    // 첫 capture부터 정상적으로 캡처되게 한다 (P2c apt baseline 필터 전용
    // 테스트는 아래 별도 describe에서 이 프리셋 없이 검증한다).
    writeAptBaseline(fixture.ctx, [])
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

// 신규 — FORWARD.md §7/정책 §8-B apt baseline 필터. 구 repo엔 이 개념이 없다
// (§8-B는 "확정 필요" 항목으로만 남아 있었다) — 이 fixture는 위 describe의
// `beforeEach`가 빈 baseline을 미리 심어두는 것과 달리, 진짜 "첫 capture"
// 상황(baseline 파일이 아예 없음)을 그대로 검증한다.
describe('apt baseline filter (first capture snapshots the distro-default set)', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('first capture snapshots everything as baseline and captures nothing new', async () => {
    expect(fs.existsSync(fixture.ctx.aptBaselinePath)).toBe(false)

    const provider = makeFakeAptProvider({ manual: ['bash', 'coreutils', 'git'] })
    const report = await captureApt(fixture.ctx, provider, { dryRun: false })

    expect(report.manualInstalled).toBe(3) // 원본 apt-mark 총계는 그대로 보고
    expect(report.packagesInManifest).toBe(0) // 하지만 baseline 자체라 manifest엔 아무것도 안 남는다
    expect(report.notes.some((n) => n.includes('baseline'))).toBe(true)
    expect(fs.existsSync(fixture.ctx.aptBaselinePath)).toBe(true)
    expect(fs.readFileSync(fixture.ctx.aptBaselinePath, 'utf-8')).toContain('git')
  })

  it('a second capture only picks up packages installed after the baseline snapshot', async () => {
    const first = makeFakeAptProvider({ manual: ['bash', 'coreutils', 'git'] })
    await captureApt(fixture.ctx, first, { dryRun: false })

    const second = makeFakeAptProvider({ manual: ['bash', 'coreutils', 'git', 'ripgrep'] })
    const report = await captureApt(fixture.ctx, second, { dryRun: false })

    expect(report.packagesInManifest).toBe(1)
    const apt = readEffectivePackages(fixture.ctx).apt
    expect(apt?.packages).toEqual(['ripgrep'])
  })

  it('dry-run on the first capture does not write the baseline file', async () => {
    const provider = makeFakeAptProvider({ manual: ['bash'] })
    await captureApt(fixture.ctx, provider, { dryRun: true })
    expect(fs.existsSync(fixture.ctx.aptBaselinePath)).toBe(false)
  })

  it('diff also excludes baseline packages from uncaptured candidates', async () => {
    const provider = makeFakeAptProvider({ manual: ['bash', 'coreutils'] })
    await captureApt(fixture.ctx, provider, { dryRun: false }) // baseline = {bash, coreutils}

    const diff = await diffApt(fixture.ctx, provider)
    expect(diff.uncaptured).toEqual([]) // 둘 다 baseline이라 후보로 안 뜬다
  })
})

// 항목 삭제(uninstall) 엔진 — 안전 불변식 5(2026-07-26 개정). REMOVE_HEADER
// 아래 실기 출력 샘플은 이 머신에서 실제로 실행한 `apt-get remove --dry-run
// curl`(읽기 전용 시뮬레이션, 아무것도 바꾸지 않음)의 원문을 그대로 따온다.
describe('parseAptRemoveDryRun', () => {
  it('extracts the REMOVED section from a real apt-get remove --dry-run transcript', () => {
    const output = [
      'NOTE: This is only a simulation!',
      '      apt-get needs root privileges for real execution.',
      '      Keep also in mind that locking is deactivated,',
      "      so don't depend on the relevance to the real current situation!",
      'Reading package lists...',
      'Building dependency tree...',
      'Reading state information...',
      'The following packages were automatically installed and are no longer required:',
      '  libarchive-tools libbson-1.0-0t64',
      "Use 'apt autoremove' to remove them.",
      'The following packages will be REMOVED:',
      '  curl rustdesk',
      '0 upgraded, 0 newly installed, 2 to remove and 0 not upgraded.',
      'Remv rustdesk [1.4.3]',
      'Remv curl [8.5.0-2ubuntu10.11]',
      ''
    ].join('\n')

    const report = parseAptRemoveDryRun(output, ['curl'])
    expect(report.willRemove).toEqual(['curl', 'rustdesk'])
    expect(report.extra).toEqual(['rustdesk'])
    expect(report.requested).toEqual(['curl'])
  })

  it('wraps across multiple indented lines for long REMOVED lists', () => {
    const output = [
      'The following packages will be REMOVED:',
      '  pkgA pkgB pkgC pkgD pkgE pkgF pkgG pkgH pkgI pkgJ pkgK pkgL pkgM pkgN pkgO',
      '  pkgP pkgQ',
      '0 upgraded, 0 newly installed, 17 to remove, 0 not upgraded.'
    ].join('\n')

    const report = parseAptRemoveDryRun(output, ['pkgA', 'pkgP'])
    expect(report.willRemove).toHaveLength(17)
    expect(report.willRemove).toContain('pkgQ')
    expect(report.extra).not.toContain('pkgA')
    expect(report.extra).not.toContain('pkgP')
    expect(report.extra).toContain('pkgB')
  })

  it('reports no extra when the REMOVED list matches the request exactly', () => {
    const output = ['The following packages will be REMOVED:', '  ripgrep', '0 upgraded'].join('\n')
    const report = parseAptRemoveDryRun(output, ['ripgrep'])
    expect(report.willRemove).toEqual(['ripgrep'])
    expect(report.extra).toEqual([])
  })

  it('does not mistake the "automatically installed" autoremove section for REMOVED', () => {
    const output = [
      'The following packages were automatically installed and are no longer required:',
      '  autoremove-candidate',
      "Use 'apt autoremove' to remove them.",
      'The following packages will be REMOVED:',
      '  ripgrep',
      '0 upgraded'
    ].join('\n')
    const report = parseAptRemoveDryRun(output, ['ripgrep'])
    expect(report.willRemove).toEqual(['ripgrep'])
    expect(report.willRemove).not.toContain('autoremove-candidate')
  })

  it('returns an empty (non-throwing) report when apt reports an error instead of a REMOVED section', () => {
    const output = [
      'Some packages could not be installed. This may mean that you have',
      'requested an impossible situation...',
      'E: Error, pkgProblemResolver::Resolve generated breaks, this may be caused by held packages.'
    ].join('\n')
    const report = parseAptRemoveDryRun(output, ['python3'])
    expect(report.willRemove).toEqual([])
    expect(report.extra).toEqual([])
  })
})

describe('planAptUninstall', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
    writeAptBaseline(fixture.ctx, [])
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('rejects a managed (manifest-declared) package even if ignored — safety invariant 5', async () => {
    writeCommonAptSection(fixture.ctx, { packages: ['ripgrep'] })
    writeIgnore(fixture, { apt: { packages: ['ripgrep'] } })
    const provider = makeFakeAptProvider({ manual: ['ripgrep'] })

    const result = planAptUninstall(fixture.ctx, provider, ['ripgrep'])

    expect(result.actions).toEqual([])
    expect(result.excluded).toEqual([
      {
        capability: 'apt',
        key: 'ripgrep',
        reason: expect.stringContaining('managed')
      }
    ])
  })

  it('rejects a package that is not ignored (paused) yet', async () => {
    const provider = makeFakeAptProvider({ manual: ['ripgrep'] })
    const result = planAptUninstall(fixture.ctx, provider, ['ripgrep'])
    expect(result.actions).toEqual([])
    expect(result.excluded[0].reason).toContain('일시중지')
  })

  it('rejects a package that is not actually installed on this machine', async () => {
    writeIgnore(fixture, { apt: { packages: ['ghost-package'] } })
    const provider = makeFakeAptProvider({ manual: [] })
    const result = planAptUninstall(fixture.ctx, provider, ['ghost-package'])
    expect(result.actions).toEqual([])
    expect(result.excluded[0].reason).toContain('설치돼 있지 않음')
  })

  it('bundles multiple valid packages into a single apt-get remove command (no --auto-remove/purge)', async () => {
    writeIgnore(fixture, { apt: { packages: ['ripgrep', 'fd-find'] } })
    const provider = makeFakeAptProvider({
      manual: ['ripgrep', 'fd-find'],
      removeDryRunOutput: [
        'The following packages will be REMOVED:',
        '  ripgrep fd-find',
        '0 upgraded'
      ].join('\n')
    })

    const result = planAptUninstall(fixture.ctx, provider, ['ripgrep', 'fd-find'])

    expect(result.actions).toHaveLength(1)
    const action = result.actions[0]
    expect(action.privileged).toBe(true)
    expect(action.commands).toHaveLength(1)
    expect(action.commands[0]).toBe('sudo apt-get remove -y fd-find ripgrep')
    expect(action.commands[0]).not.toContain('--auto-remove')
    expect(action.commands[0]).not.toContain('purge')
    expect(result.excluded).toEqual([])
    expect(result.dependencies?.willRemove).toEqual(['fd-find', 'ripgrep'])
    expect(result.dependencies?.extra).toEqual([])
  })

  it('surfaces an apt dependency warning when removing would take more than requested', async () => {
    writeIgnore(fixture, { apt: { packages: ['curl'] } })
    const provider = makeFakeAptProvider({
      manual: ['curl'],
      removeDryRunOutput: [
        'The following packages will be REMOVED:',
        '  curl rustdesk',
        '0 upgraded, 0 newly installed, 2 to remove and 0 not upgraded.'
      ].join('\n')
    })

    const result = planAptUninstall(fixture.ctx, provider, ['curl'])

    expect(result.dependencies?.extra).toEqual(['rustdesk'])
  })

  it('a privileged remove action is never actually run by the plan executor path', async () => {
    writeIgnore(fixture, { apt: { packages: ['ripgrep'] } })
    const provider = makeFakeAptProvider({ manual: ['ripgrep'] })
    const result = planAptUninstall(fixture.ctx, provider, ['ripgrep'])
    await expect(result.actions[0].run()).rejects.toThrow('P2b')
  })

  it('reports skipped-with-reason when apt-mark is unavailable', async () => {
    const provider = makeFakeAptProvider({ available: false })
    const result = planAptUninstall(fixture.ctx, provider, ['ripgrep'])
    expect(result.actions).toEqual([])
    expect(result.excluded[0].reason).toContain('apt-mark')
  })
})
