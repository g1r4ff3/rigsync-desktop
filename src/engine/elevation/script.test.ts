import { describe, expect, it } from 'vitest'
import { buildSudoScript } from './script'

// 케이스 출처: 구 repo ~/repos/rigsync/gui.py TestBuildSudoScript /
// TestBuildSudoScriptCancelFile (행동만 옮김 — 코드 복사 아님).

const CMDS = ['sudo apt-get install -y git vim', 'sudo snap install code --classic']

describe('buildSudoScript', () => {
  it('strips leading sudo and adds markers (test_strips_sudo_and_adds_markers)', () => {
    const script = buildSudoScript(CMDS)
    expect(script.startsWith('#!/bin/sh')).toBe(true)
    // pkexec가 이미 root로 실행하므로 앞의 sudo는 벗겨야 한다.
    expect(script).not.toContain('sudo apt-get')
    expect(script).toContain('apt-get install -y git vim')
    expect(script).toContain('snap install code --classic')
    expect(script).toContain('===RIGSYNC CMD 0===')
    expect(script).toContain('===RIGSYNC CMD 1===')
    expect(script).toContain('===RIGSYNC FAIL 1===')
    expect(script).toContain('===RIGSYNC DONE===')
  })

  it('keeps a non-sudo command verbatim (test_non_sudo_command_kept_verbatim)', () => {
    const script = buildSudoScript(['cp /a /b'])
    expect(script).toContain('cp /a /b')
  })

  // TestBuildSudoScriptCancelFile
  it('inserts a cancel-file check before each command (test_inserts_check_before_each_command)', () => {
    const script = buildSudoScript(['cmd-a', 'cmd-b'], '/tmp/x-cancel')
    const occurrences = script.split("[ -f '/tmp/x-cancel' ] && exit 3").length - 1
    expect(occurrences).toBe(2)
    expect(script.indexOf('exit 3')).toBeLessThan(script.indexOf('cmd-a'))
  })

  it('has no cancel check by default (test_default_has_no_cancel_check)', () => {
    const script = buildSudoScript(['cmd-a'])
    expect(script).not.toContain('exit 3')
  })
})
