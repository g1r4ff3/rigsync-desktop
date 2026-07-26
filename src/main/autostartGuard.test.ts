import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autostartDesktopFilePath, isAutostartEnabled } from '../engine/autostart'
import { guardedSetAutostart, shouldBlockAutostartEnable } from './autostartGuard'

describe('shouldBlockAutostartEnable', () => {
  it('blocks enabling in dev mode', () => {
    expect(shouldBlockAutostartEnable(true, true)).toBe(true)
  })

  it('allows enabling outside dev mode', () => {
    expect(shouldBlockAutostartEnable(false, true)).toBe(false)
  })

  it('allows disabling regardless of dev mode', () => {
    expect(shouldBlockAutostartEnable(true, false)).toBe(false)
    expect(shouldBlockAutostartEnable(false, false)).toBe(false)
  })
})

describe('guardedSetAutostart', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-autostart-guard-'))
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('does not write the .desktop file when asked to enable in dev mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    guardedSetAutostart(homeDir, true, '/repo/node_modules/electron/dist/electron', true)
    expect(isAutostartEnabled(homeDir)).toBe(false)
    expect(fs.existsSync(autostartDesktopFilePath(homeDir))).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('writes the .desktop file when enabling outside dev mode', () => {
    guardedSetAutostart(homeDir, true, '/opt/rigsync/rigsync-desktop.AppImage', false)
    expect(isAutostartEnabled(homeDir)).toBe(true)
  })

  it('still disables in dev mode (safe no matter what)', () => {
    guardedSetAutostart(homeDir, true, '/opt/rigsync/rigsync-desktop.AppImage', false)
    guardedSetAutostart(homeDir, false, '/opt/rigsync/rigsync-desktop.AppImage', true)
    expect(isAutostartEnabled(homeDir)).toBe(false)
  })
})
