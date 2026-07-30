import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  autostartDesktopFilePath,
  disableAutostart,
  enableAutostart,
  isAutostartEnabled,
  readAutostartExecPath,
  selfHealAutostart,
  setAutostart
} from './autostart'

describe('autostart (XDG ~/.config/autostart/*.desktop)', () => {
  let homeDir: string

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigsync-autostart-'))
  })

  afterEach(() => {
    fs.rmSync(homeDir, { recursive: true, force: true })
  })

  it('is disabled by default (no .desktop file yet)', () => {
    expect(isAutostartEnabled(homeDir)).toBe(false)
  })

  it('enableAutostart writes a valid Desktop Entry with the given Exec path', () => {
    enableAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage')
    expect(isAutostartEnabled(homeDir)).toBe(true)
    const content = fs.readFileSync(autostartDesktopFilePath(homeDir), 'utf-8')
    expect(content).toContain('[Desktop Entry]')
    expect(content).toContain('Type=Application')
    expect(content).toContain('Exec=/opt/rigsync/rigsync-desktop.AppImage')
  })

  it('disableAutostart removes the file (and is a no-op if already absent)', () => {
    enableAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage')
    disableAutostart(homeDir)
    expect(isAutostartEnabled(homeDir)).toBe(false)
    expect(() => disableAutostart(homeDir)).not.toThrow()
  })

  it('setAutostart(true/false) dispatches to enable/disable', () => {
    setAutostart(homeDir, true, '/bin/rigsync')
    expect(isAutostartEnabled(homeDir)).toBe(true)
    setAutostart(homeDir, false, '/bin/rigsync')
    expect(isAutostartEnabled(homeDir)).toBe(false)
  })

  describe('readAutostartExecPath', () => {
    it('returns null when the .desktop file does not exist', () => {
      expect(readAutostartExecPath(homeDir)).toBeNull()
    })

    it('reads back the Exec= value written by enableAutostart', () => {
      enableAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage')
      expect(readAutostartExecPath(homeDir)).toBe('/opt/rigsync/rigsync-desktop.AppImage')
    })
  })

  // v0.1.20: 패키지 모드 기동 시 stale Exec 경로(이동된 AppImage·잔존 dev
  // 경로)를 자동 치유 — 어제 실사고("Capture 눌러도 반영 안 되는 것처럼
  // 보였다")의 재발 방지 축 중 하나(autostart는 별개 위험이지만 같은
  // "조용히 깨진 상태" 계열이라 함께 다룬다).
  describe('selfHealAutostart', () => {
    it('does nothing in dev mode, even with a stale Exec value', () => {
      enableAutostart(homeDir, '/old/dev/electron')
      const result = selfHealAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage', true)
      expect(result).toEqual({ healed: false })
      expect(readAutostartExecPath(homeDir)).toBe('/old/dev/electron')
    })

    it('does nothing when autostart is not enabled (no .desktop file)', () => {
      const result = selfHealAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage', false)
      expect(result).toEqual({ healed: false })
      expect(isAutostartEnabled(homeDir)).toBe(false)
    })

    it('does nothing when the Exec value already matches execPath', () => {
      enableAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage')
      const result = selfHealAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage', false)
      expect(result).toEqual({ healed: false })
    })

    it('rewrites Exec= to the current execPath when it is stale (moved AppImage)', () => {
      enableAutostart(homeDir, '/opt/rigsync-old-location/rigsync-desktop.AppImage')
      const result = selfHealAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage', false)
      expect(result).toEqual({
        healed: true,
        staleExecPath: '/opt/rigsync-old-location/rigsync-desktop.AppImage'
      })
      expect(readAutostartExecPath(homeDir)).toBe('/opt/rigsync/rigsync-desktop.AppImage')
      expect(isAutostartEnabled(homeDir)).toBe(true)
    })

    it('rewrites a leftover dev Exec path in non-dev mode (yesterday incident shape)', () => {
      enableAutostart(homeDir, '/home/x/repos/rigsync-desktop/node_modules/electron/dist/electron')
      const result = selfHealAutostart(homeDir, '/opt/rigsync/rigsync-desktop.AppImage', false)
      expect(result.healed).toBe(true)
      expect(readAutostartExecPath(homeDir)).toBe('/opt/rigsync/rigsync-desktop.AppImage')
    })
  })
})
