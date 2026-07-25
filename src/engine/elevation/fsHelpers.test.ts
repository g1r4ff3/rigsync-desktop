import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { commandExists } from '../providers/linux/exec'
import { makeCancelFilePath, pkexecAvailable, safeUnlink, writeSudoScript } from './fsHelpers'

// 케이스 출처: 구 repo gui.py TestBuildSudoScript.test_write_sudo_script_private_file
// (행동만 옮김 — 코드 복사 아님). pkexec_available()엔 구 repo에도 전용
// 테스트가 없다(trivial `shutil.which` 래핑) — commandExists와 동치임을 확인.

describe('writeSudoScript', () => {
  it('writes a private (0700) file (test_write_sudo_script_private_file)', () => {
    const scriptPath = writeSudoScript('#!/bin/sh\necho hi\n')
    try {
      expect(fs.existsSync(scriptPath)).toBe(true)
      const mode = fs.statSync(scriptPath).mode & 0o777
      expect(mode).toBe(0o700)
      expect(fs.readFileSync(scriptPath, 'utf-8')).toContain('echo hi')
    } finally {
      safeUnlink(scriptPath)
    }
  })
})

describe('makeCancelFilePath', () => {
  it('returns a path that does not exist yet (buildSudoScript checks `[ -f path ]`)', () => {
    const p = makeCancelFilePath()
    expect(fs.existsSync(p)).toBe(false)
  })
})

describe('pkexecAvailable', () => {
  it('is equivalent to commandExists("pkexec")', () => {
    expect(pkexecAvailable()).toBe(commandExists('pkexec'))
  })
})
