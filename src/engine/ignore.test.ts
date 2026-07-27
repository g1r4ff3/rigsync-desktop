import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RigsyncContext } from './context'
import {
  applyAptDistroToggle,
  readAptIncludeSet,
  readIgnoreSet,
  setIgnored,
  setIgnoredBulk
} from './ignore'
import { readCommonLayer, writeCommonLayer, writeManifestFile, hostLayerPath } from './manifest'

// 케이스 출처: 구 repo tests/test_ignore.py TestIgnoreHostOverlayUnion
// (행동만 옮김 — 코드 복사 아님).

describe('readIgnoreSet', () => {
  let root: string
  let ctx: RigsyncContext

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-ignore-test-'))
    ctx = {
      machineId: 'testhost',
      role: 'reference',
      manifestDir: path.join(root, 'manifest'),
      homeDir: path.join(root, 'home'),
      backupRoot: path.join(root, 'home', '.rigsync-backup'),
      settings: {},
      autostartEnabled: false
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  // test_host_overlay_adds_to_common_not_replace
  it('unions a host-overlay ignore list onto common, does not replace it', () => {
    writeCommonLayer(ctx, 'ignore', { apt: { packages: ['unityhub'], sources: [] } })
    writeManifestFile(hostLayerPath(ctx, 'ignore'), { apt: { packages: ['zoom'], sources: [] } })

    const ignored = readIgnoreSet(ctx, 'apt', 'packages')
    expect(ignored).toEqual(new Set(['unityhub', 'zoom']))
  })

  // test_host_overlay_dotfiles_union
  it('unions host+common ignore lists for a different capability (dotfiles)', () => {
    writeCommonLayer(ctx, 'ignore', { dotfiles: { homes: ['~/a'] } })
    writeManifestFile(hostLayerPath(ctx, 'ignore'), { dotfiles: { homes: ['~/b'] } })

    const ignored = readIgnoreSet(ctx, 'dotfiles', 'homes')
    expect(ignored).toEqual(new Set(['~/a', '~/b']))
  })

  it('returns an empty set when nothing is ignored', () => {
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set())
  })
})

describe('setIgnoredBulk', () => {
  let root: string
  let ctx: RigsyncContext

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-ignore-bulk-test-'))
    ctx = {
      machineId: 'testhost',
      role: 'reference',
      manifestDir: path.join(root, 'manifest'),
      homeDir: path.join(root, 'home'),
      backupRoot: path.join(root, 'home', '.rigsync-backup'),
      settings: {},
      autostartEnabled: false
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('ignores every key in one call', () => {
    setIgnoredBulk(ctx, 'apt', 'packages', ['git', 'curl', 'vim'], true)
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set(['curl', 'git', 'vim']))
  })

  it('un-ignores every key in one call, leaving unrelated keys untouched', () => {
    setIgnoredBulk(ctx, 'apt', 'packages', ['git', 'curl', 'vim', 'zoom'], true)
    setIgnoredBulk(ctx, 'apt', 'packages', ['git', 'curl'], false)
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set(['vim', 'zoom']))
  })

  it('is a no-op for an empty key list (does not touch the file at all)', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    setIgnoredBulk(ctx, 'apt', 'packages', [], true)
    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })

  it('performs exactly one read and one write regardless of how many keys are toggled (no per-item commit bomb)', () => {
    const readSpy = vi.spyOn(fs, 'readFileSync')
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    setIgnoredBulk(ctx, 'apt', 'packages', ['a', 'b', 'c', 'd', 'e'], true)
    // ignore.toml 자체에 대한 읽기/쓰기는 각 1회여야 한다(다른 파일 IO가 섞여
    // 있을 수 있으니 ignore.toml 경로로 필터링).
    const ignorePathCallCount = (calls: readonly unknown[][]): number =>
      calls.filter((args) => String(args[0]).endsWith('ignore.toml')).length
    expect(ignorePathCallCount(readSpy.mock.calls)).toBeLessThanOrEqual(1)
    expect(ignorePathCallCount(writeSpy.mock.calls)).toBe(1)
    readSpy.mockRestore()
    writeSpy.mockRestore()
  })

  it('setIgnored (single-item) is expressed in terms of setIgnoredBulk and still works standalone', () => {
    setIgnored(ctx, 'flatpak', 'apps', 'org.deskflow.deskflow', true)
    expect(readIgnoreSet(ctx, 'flatpak', 'apps')).toEqual(new Set(['org.deskflow.deskflow']))
  })

  it('writes the common ignore.toml layer only (not a host overlay)', () => {
    setIgnoredBulk(ctx, 'apt', 'packages', ['git'], true)
    const doc = readCommonLayer(ctx, 'ignore') as { apt?: { packages?: string[] } }
    expect(doc.apt?.packages).toEqual(['git'])
  })
})

// refactor-spec-v0.2 §1: "배포판 기본" 그룹 스위치의 include/ignore 의미론 —
// managed 여부에 따라 건드리는 예외 리스트가 갈리고, 끔이 include를 함께
// 지워 캡처 진동(제거 -> 재추가)을 막는다.
describe('applyAptDistroToggle', () => {
  let root: string
  let ctx: RigsyncContext

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-distro-toggle-test-'))
    ctx = {
      machineId: 'testhost',
      role: 'reference',
      manifestDir: path.join(root, 'manifest'),
      homeDir: path.join(root, 'home'),
      backupRoot: path.join(root, 'home', '.rigsync-backup'),
      settings: {},
      autostartEnabled: false
    }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('turning on an unmanaged distro item records an include exception', () => {
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: false }], true)
    expect(readAptIncludeSet(ctx)).toEqual(new Set(['wpasupplicant']))
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set())
  })

  it('turning off an unmanaged distro item just removes the include exception', () => {
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: false }], true)
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: false }], false)
    expect(readAptIncludeSet(ctx)).toEqual(new Set())
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set())
  })

  it('turning off a managed distro item sets ignore AND clears include (no capture oscillation)', () => {
    // include로 들어와 managed가 된 항목을 끄는 시나리오: ignore만 넣고
    // include를 남기면 다음 capture가 제거한 뒤 그다음 capture가 도로 담는다.
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: false }], true)
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: true }], false)
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set(['wpasupplicant']))
    expect(readAptIncludeSet(ctx)).toEqual(new Set())
  })

  it('turning a managed-but-ignored distro item back on clears the ignore', () => {
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: true }], false)
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: true }], true)
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set())
  })

  it('preserves unrelated ignore/include entries and other capabilities', () => {
    setIgnoredBulk(ctx, 'apt', 'packages', ['zoom'], true)
    setIgnoredBulk(ctx, 'flatpak', 'apps', ['org.example.App'], true)
    applyAptDistroToggle(ctx, [{ key: 'wpasupplicant', managed: false }], true)
    expect(readIgnoreSet(ctx, 'apt', 'packages')).toEqual(new Set(['zoom']))
    expect(readIgnoreSet(ctx, 'flatpak', 'apps')).toEqual(new Set(['org.example.App']))
    expect(readAptIncludeSet(ctx)).toEqual(new Set(['wpasupplicant']))
  })

  it('is a no-op for an empty item list', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    applyAptDistroToggle(ctx, [], true)
    expect(writeSpy).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })
})
