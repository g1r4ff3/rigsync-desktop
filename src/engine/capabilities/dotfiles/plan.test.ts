import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectiveLayer, writeCommonLayer } from '../../manifest'
import { PlanExecutor } from '../../plan'
import { captureDotfiles } from './capture'
import { DOTFILES_LAYER } from './constants'
import { diffDotfiles } from './diff'
import { planDotfiles, planDotfilesUninstall } from './plan'
import { makeFixture, writeHomeFile, writeIgnore, type TestFixture } from '../../testFixtures'

// 케이스 출처: 구 repo tests/test_dotfiles.py
// TestDotfilesDiffAndApplySymlink / TestDotfilesLinkFalseModeCopy /
// TestDotfilesDenylistApplyRejection / TestDotfilesInvalidStoreApplyRefusal
// (행동만 옮김 — 코드 복사 아님). CLI print-layer 전용 케이스
// (test_cmd_apply_prints_refused_line_and_exits_nonzero_*)는 이 엔진에
// 대응하는 텍스트 CLI가 없어 이식하지 않았다 — 동일한 거부 행동은
// "plan dry-run surfaces refusal"/"plan executed mode also refuses" 두
// 케이스가 엔진 레벨에서 그대로 검증한다.

describe('planDotfiles + PlanExecutor (dotfiles walking skeleton)', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  // TestDotfilesDiffAndApplySymlink.test_diff_to_link_then_apply_creates_symlink_and_backup
  it('links a to_link entry and backs up the original file', async () => {
    const homeFile = writeHomeFile(fixture, '.zshrc', 'seed content\n')
    await captureDotfiles(fixture.ctx, { dryRun: false })

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.toLink).toContain('~/.zshrc')

    const runTs = 'run-link'
    const plan = planDotfiles(fixture.ctx, diff, runTs)
    const results = await new PlanExecutor().execute(plan, { confirm: true })
    expect(results.some((r) => r.status === 'ok')).toBe(true)

    expect(fs.lstatSync(homeFile).isSymbolicLink()).toBe(true)
    const storePath = path.join(fixture.manifestDir, 'dotfiles', '.zshrc')
    expect(fs.realpathSync(homeFile)).toBe(path.resolve(storePath))

    const backupFile = path.join(fixture.ctx.backupRoot, runTs, '.zshrc')
    expect(fs.existsSync(backupFile)).toBe(true)
    expect(fs.readFileSync(backupFile, 'utf-8')).toBe('seed content\n')

    const diff2 = await diffDotfiles(fixture.ctx)
    expect(diff2.toLink).not.toContain('~/.zshrc')
  })

  // TestDotfilesDiffAndApplySymlink.test_apply_without_yes_mutates_nothing
  it('dry-run (confirm:false) plans everything but mutates nothing', async () => {
    const homeFile = writeHomeFile(fixture, '.zshrc', 'seed content\n')
    await captureDotfiles(fixture.ctx, { dryRun: false })

    const diff = await diffDotfiles(fixture.ctx)
    const plan = planDotfiles(fixture.ctx, diff, 'run-dry')
    const results = await new PlanExecutor().execute(plan, { confirm: false })

    expect(results.every((r) => r.status === 'planned')).toBe(true)
    expect(fs.lstatSync(homeFile).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(homeFile, 'utf-8')).toBe('seed content\n')
  })

  // TestDotfilesLinkFalseModeCopy.test_link_false_copy_and_chmod
  it('copies (not links) a link:false entry and applies its mode', async () => {
    const homeFile = writeHomeFile(fixture, '.ssh/config', 'Host foo\n', 0o644)
    await captureDotfiles(fixture.ctx, { dryRun: false })

    const entry = (
      effectiveLayer(fixture.ctx, DOTFILES_LAYER, { entry: 'home' }).entry as Array<{
        home: string
        link?: boolean
        mode?: string
      }>
    ).find((e) => e.home === '~/.ssh/config')
    expect(entry?.link).toBe(false)
    expect(entry?.mode).toBe('600')

    // 드리프트 시뮬레이션: 스토어 내용을 홈과 다르게 바꾼다.
    const storePath = path.join(fixture.manifestDir, 'dotfiles', '.ssh', 'config')
    fs.writeFileSync(storePath, 'Host bar\n')

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.contentChanged.some((c) => c.includes('~/.ssh/config'))).toBe(true)

    const plan = planDotfiles(fixture.ctx, diff, 'run-copy')
    const results = await new PlanExecutor().execute(plan, { confirm: true })
    expect(results.some((r) => r.status === 'ok')).toBe(true)

    expect(fs.readFileSync(homeFile, 'utf-8')).toBe('Host bar\n')
    const mode = fs.statSync(homeFile).mode & 0o777
    expect(mode).toBe(0o600)
  })

  // TestDotfilesDenylistApplyRejection.test_apply_refuses_denylisted_entry
  it('refuses to apply a manually-injected denylisted entry and leaves home untouched', async () => {
    const homeFile = writeHomeFile(fixture, '.config/credentials_test', 'SECRET=1\n')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [
        {
          home: '~/.config/credentials_test',
          store: 'dotfiles/.config/credentials_test',
          type: 'file',
          link: true
        }
      ]
    })

    const diff = await diffDotfiles(fixture.ctx)
    expect(diff.toLink).toContain('~/.config/credentials_test')

    const runTs = 'run-denylist'
    const plan = planDotfiles(fixture.ctx, diff, runTs)
    const results = await new PlanExecutor().execute(plan, { confirm: true })

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
    expect(results[0].detail).toContain('denylist')

    expect(fs.lstatSync(homeFile).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(homeFile, 'utf-8')).toBe('SECRET=1\n')
    const backupRoot = fixture.ctx.backupRoot
    if (fs.existsSync(backupRoot)) {
      expect(fs.existsSync(path.join(backupRoot, runTs, '.config', 'credentials_test'))).toBe(false)
    }
  })

  // TestDotfilesInvalidStoreApplyRefusal.test_plan_dry_run_surfaces_refusal_not_silently_omitted
  it('surfaces an invalid-store refusal even in dry-run (does not silently omit it)', async () => {
    const home = injectEscapingEntry(fixture)
    const diff = await diffDotfiles(fixture.ctx)
    const plan = planDotfiles(fixture.ctx, diff, 'run-refuse-dry')
    expect(plan).toHaveLength(1)

    const results = await new PlanExecutor().execute(plan, { confirm: false })
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('refused')
    expect(results[0].detail).toContain('escapes repo root')
    void home
  })

  // TestDotfilesInvalidStoreApplyRefusal.test_plan_executed_mode_also_refuses_and_mutates_nothing
  it('also refuses an invalid-store entry in executed mode and mutates nothing', async () => {
    const home = injectEscapingEntry(fixture)
    const homePath = path.join(fixture.homeDir, '.config', 'escape_test')

    const diff = await diffDotfiles(fixture.ctx)
    const plan = planDotfiles(fixture.ctx, diff, 'run-refuse-exec')
    const results = await new PlanExecutor().execute(plan, { confirm: true })

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('refused')
    expect(results[0].detail).toContain('escapes repo root')
    expect(fs.lstatSync(homePath).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(homePath, 'utf-8')).toBe('content\n')
    void home
  })
})

// 항목 삭제(uninstall) 엔진 — 안전 불변식 5(2026-07-26 개정).
describe('planDotfilesUninstall', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('rejects a managed (manifest-declared) home even if ignored — safety invariant 5', () => {
    writeHomeFile(fixture, '.zshrc', 'seed\n')
    writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
      entry: [{ home: '~/.zshrc', store: 'dotfiles/.zshrc', type: 'file', link: true }]
    })
    writeIgnore(fixture, { dotfiles: { homes: ['~/.zshrc'] } })

    const result = planDotfilesUninstall(fixture.ctx, ['~/.zshrc'], 'run-reject-managed')

    expect(result.actions).toEqual([])
    expect(result.excluded).toEqual([
      { capability: 'dotfiles', key: '~/.zshrc', reason: expect.stringContaining('managed') }
    ])
  })

  it('rejects a home that is not ignored (paused) yet', () => {
    writeHomeFile(fixture, '.zshrc', 'seed\n')
    const result = planDotfilesUninstall(fixture.ctx, ['~/.zshrc'], 'run-not-ignored')
    expect(result.actions).toEqual([])
    expect(result.excluded[0].reason).toContain('일시중지')
  })

  it('rejects a home that does not exist on this machine', () => {
    writeIgnore(fixture, { dotfiles: { homes: ['~/.ghostrc'] } })
    const result = planDotfilesUninstall(fixture.ctx, ['~/.ghostrc'], 'run-not-installed')
    expect(result.actions).toEqual([])
    expect(result.excluded[0].reason).toContain('설치돼 있지 않음')
  })

  it('backs up then deletes a plain file that is ignored and unmanaged, without touching the store', async () => {
    const homeFile = writeHomeFile(fixture, '.oldtoolrc', 'leftover config\n')
    writeIgnore(fixture, { dotfiles: { homes: ['~/.oldtoolrc'] } })

    const runTs = 'run-delete-file'
    const result = planDotfilesUninstall(fixture.ctx, ['~/.oldtoolrc'], runTs)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].privileged).toBeFalsy()

    const runResult = await result.actions[0].run()
    expect(runResult.ok).toBe(true)

    expect(fs.existsSync(homeFile)).toBe(false)
    const backupFile = path.join(fixture.ctx.backupRoot, runTs, '.oldtoolrc')
    expect(fs.existsSync(backupFile)).toBe(true)
    expect(fs.readFileSync(backupFile, 'utf-8')).toBe('leftover config\n')
  })

  it('backs up then removes a symlinked home (does not follow into and delete the store target)', async () => {
    const storeDir = path.join(fixture.manifestDir, 'dotfiles')
    fs.mkdirSync(storeDir, { recursive: true })
    const storeFile = path.join(storeDir, '.linkedrc')
    fs.writeFileSync(storeFile, 'store content\n')
    const homePath = path.join(fixture.homeDir, '.linkedrc')
    fs.symlinkSync(storeFile, homePath)
    writeIgnore(fixture, { dotfiles: { homes: ['~/.linkedrc'] } })

    const runTs = 'run-delete-symlink'
    const result = planDotfilesUninstall(fixture.ctx, ['~/.linkedrc'], runTs)
    const runResult = await result.actions[0].run()
    expect(runResult.ok).toBe(true)

    expect(fs.existsSync(homePath)).toBe(false)
    expect(fs.existsSync(storeFile)).toBe(true) // store는 건드리지 않는다 — manifest는 별개
  })

  it('exposes the delete command in dry-run form so the UI can show it before confirming', () => {
    writeHomeFile(fixture, '.oldtoolrc', 'leftover\n')
    writeIgnore(fixture, { dotfiles: { homes: ['~/.oldtoolrc'] } })
    const result = planDotfilesUninstall(fixture.ctx, ['~/.oldtoolrc'], 'run-dry')
    expect(result.actions[0].commands.some((c) => c.startsWith('backup'))).toBe(true)
    expect(result.actions[0].commands.some((c) => c.includes('rm'))).toBe(true)
  })
})

function injectEscapingEntry(fixture: TestFixture): string {
  const home = '~/.config/escape_test'
  writeHomeFile(fixture, '.config/escape_test', 'content\n')
  writeCommonLayer(fixture.ctx, DOTFILES_LAYER, {
    entry: [{ home, store: '../outside_repo/escape_test', type: 'file', link: true }]
  })
  return home
}
