import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ElevationSpawnOptions, ElevationSpawnResult } from './execTypes'
import { writeSudoScript } from './fsHelpers'
import { runSudoScript } from './runner'
import { buildSudoScript } from './script'
import { makeFakeElevationExec } from './testHelpers'

// 케이스 출처: 구 repo gui.py TestRunSudoScript (행동만 옮김 — 코드 복사
// 아님). 실제 pkexec는 쓰지 않는다 — fake exec의 "run" 모드가 argv에서
// "pkexec"만 떼고 나머지를 실제로 실행해, 스트리밍·파싱 경로 전체(argv 조립
// 제외)를 진짜로 검증한다.

describe('runSudoScript', () => {
  const cleanupPaths: string[] = []

  afterEach(() => {
    for (const p of cleanupPaths.splice(0)) {
      try {
        fs.unlinkSync(p)
      } catch {
        // 이미 없음 -- 무시.
      }
    }
  })

  it('runs the real command end-to-end and reports ok (test_success_end_to_end_runs_real_command)', async () => {
    const marker = path.join(os.tmpdir(), `rigsync-elevation-test-ran-${process.pid}-${Date.now()}`)
    const scriptPath = writeSudoScript(buildSudoScript([`touch ${marker}`]))
    cleanupPaths.push(scriptPath, marker)

    const events: unknown[] = []
    const result = await runSudoScript(makeFakeElevationExec('run'), scriptPath, 1, (ev) =>
      events.push(ev)
    )

    expect(result.returncode).toBe(0)
    expect(result.outcome).toBe('ok')
    expect(result.statuses).toEqual(['ok'])
    expect(fs.existsSync(marker)).toBe(true)
    expect(events).toContainEqual({ kind: 'start', index: 0 })
    expect(events).toContainEqual({ kind: 'done' })
  })

  it('surfaces a dismissed auth distinctly -- script never ran (test_dismissed_is_surfaced_distinctly_script_never_ran)', async () => {
    const marker = path.join(
      os.tmpdir(),
      `rigsync-elevation-test-should-not-exist-${process.pid}-${Date.now()}`
    )
    const scriptPath = writeSudoScript(buildSudoScript([`touch ${marker}`]))
    cleanupPaths.push(scriptPath)

    const result = await runSudoScript(makeFakeElevationExec('dismiss'), scriptPath, 1)
    expect(result.returncode).toBe(126)
    expect(result.outcome).toBe('dismissed')
    expect(result.statuses).toEqual(['not-run'])
    expect(fs.existsSync(marker)).toBe(false)
  })

  it('surfaces unauthorized distinctly from dismissed (test_unauthorized_is_surfaced_distinctly_from_dismissed)', async () => {
    const scriptPath = writeSudoScript(buildSudoScript(['true']))
    cleanupPaths.push(scriptPath)

    const result = await runSudoScript(makeFakeElevationExec('unauthorized'), scriptPath, 1)
    expect(result.returncode).toBe(127)
    expect(result.outcome).toBe('unauthorized')
    expect(result.outcome).not.toBe('dismissed')
  })

  it('mid-script failure surfaces stderr and marks the rest not-run (test_mid_script_failure_surfaces_stderr_and_marks_rest_not_run)', async () => {
    const commands = ['true', 'sh -c "echo custom-stderr-message >&2; exit 1"', 'echo unreached']
    const scriptPath = writeSudoScript(buildSudoScript(commands))
    cleanupPaths.push(scriptPath)

    const result = await runSudoScript(makeFakeElevationExec('run'), scriptPath, commands.length)
    expect(result.outcome).toBe('script-failed')
    expect(result.statuses).toEqual(['ok', 'failed', 'not-run'])
    expect(result.stderr).toContain('custom-stderr-message')
  })

  it('argv passed to the exec interface is exactly ["pkexec", "/bin/sh", scriptPath] (test_argv_is_exact_and_environment_is_inherited_unmodified)', async () => {
    // "환경이 그대로 상속되는지"는 ElevationSpawnOptions 자체에 env 오버라이드
    // 필드가 아예 없어 구조적으로 항상 참이다(상속을 끌 방법이 없다) --
    // 여기서는 argv 조립이 정확히 그 셋인지만 스파이로 확인한다.
    const scriptPath = writeSudoScript(buildSudoScript(['true']))
    cleanupPaths.push(scriptPath)

    let capturedArgv: readonly string[] | null = null
    const spyExec = {
      spawn: (options: ElevationSpawnOptions): Promise<ElevationSpawnResult> => {
        capturedArgv = options.argv
        return Promise.resolve({ code: 0, stderr: '' })
      }
    }
    await runSudoScript(spyExec, scriptPath, 1)
    expect(capturedArgv).toEqual(['pkexec', '/bin/sh', scriptPath])
  })
})
