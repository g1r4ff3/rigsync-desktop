import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  autostartDesktopFilePath,
  disableAutostart,
  enableAutostart,
  isAutostartEnabled,
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
})
