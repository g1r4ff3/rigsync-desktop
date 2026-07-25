import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupPath, doBackup } from './backup'

// 추가 요구사항: 백업 생성 자체를 dotfiles 통합 흐름과 별개로 단위 검증한다
// (구 repo `backup_path`/`_do_backup` 행동 이식 — P1 확정 결정 ④: 백업 루트는
// ctx로 주입 가능해야 한다).

describe('doBackup', () => {
  let root: string
  let ctx: { homeDir: string; backupRoot: string }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-backup-test-'))
    const homeDir = path.join(root, 'home')
    fs.mkdirSync(homeDir, { recursive: true })
    ctx = { homeDir, backupRoot: path.join(homeDir, '.rigsync-backup') }
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('copies a regular file into <backupRoot>/<runTs>/<relToHome>', () => {
    const homeFile = path.join(ctx.homeDir, '.zshrc')
    fs.writeFileSync(homeFile, 'original\n')

    const dest = doBackup(ctx, homeFile, '2026-01-01T00-00-00Z')
    expect(dest).toBe(backupPath(ctx, homeFile, '2026-01-01T00-00-00Z'))
    expect(dest).toBeDefined()
    expect(fs.readFileSync(dest!, 'utf-8')).toBe('original\n')

    // 원본은 그대로 남아 있어야 한다 — 백업은 복사지 이동이 아니다.
    expect(fs.readFileSync(homeFile, 'utf-8')).toBe('original\n')
  })

  it('preserves a symlink as a symlink in the backup (not its resolved content)', () => {
    const target = path.join(ctx.homeDir, 'real-target')
    fs.writeFileSync(target, 'payload\n')
    const homeLink = path.join(ctx.homeDir, '.linked')
    fs.symlinkSync(target, homeLink)

    const dest = doBackup(ctx, homeLink, 'run-symlink')
    expect(dest).toBeDefined()
    expect(fs.lstatSync(dest!).isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(dest!)).toBe(target)
  })

  it('copies a directory tree recursively into the backup', () => {
    const dir = path.join(ctx.homeDir, '.config', 'wezterm')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'wezterm.lua'), 'return {}\n')

    const dest = doBackup(ctx, dir, 'run-dir')
    expect(dest).toBeDefined()
    expect(fs.statSync(dest!).isDirectory()).toBe(true)
    expect(fs.readFileSync(path.join(dest!, 'wezterm.lua'), 'utf-8')).toBe('return {}\n')
  })

  it('returns undefined when there is nothing at homePath to back up', () => {
    const missing = path.join(ctx.homeDir, '.does-not-exist')
    expect(doBackup(ctx, missing, 'run-missing')).toBeUndefined()
  })
})
