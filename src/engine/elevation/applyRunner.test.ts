import { describe, expect, it } from 'vitest'
import type { PlanAction } from '../plan'
import { ApplyRunner } from './applyRunner'
import { makeFakeElevationExec } from './testHelpers'

// 신규 테스트 (구 repo에 해당하는 것은 GUI 레벨 `_run_apply_worker`이고, 그
// 회귀 테스트들은 GTK 콜백 인자 개수 검증이라 TS에 대응 버그 클래스가 없어
// 이식하지 않았다 — 대신 오케스트레이션 자체의 행동을 직접 검증한다).

function unprivilegedAction(summary: string, onRun: () => void): PlanAction {
  return {
    capability: 'dotfiles',
    summary,
    commands: [`echo ${summary}`],
    privileged: false,
    run: async () => {
      onRun()
      return { ok: true, detail: 'ok' }
    }
  }
}

function privilegedAction(summary: string, commands: string[]): PlanAction {
  return {
    capability: 'packages',
    summary,
    commands,
    privileged: true,
    run: async () => ({ ok: true, detail: '' })
  }
}

describe('ApplyRunner', () => {
  it('dry-run (confirm:false) previews everything as planned, runs nothing', async () => {
    let ran = false
    const plan = [
      unprivilegedAction('link x', () => (ran = true)),
      privilegedAction('apt install y', ['sudo apt-get install -y y'])
    ]

    const runner = new ApplyRunner()
    const results = await runner.run(plan, {
      confirm: false,
      elevationExec: makeFakeElevationExec('run')
    })

    expect(ran).toBe(false)
    expect(results.map((r) => r.status)).toEqual(['planned', 'planned'])
  })

  it('when pkexec is unavailable, unprivileged actions still run and privileged ones are skipped with a reason', async () => {
    let ran = false
    const plan = [
      unprivilegedAction('link x', () => (ran = true)),
      privilegedAction('apt install y', ['sudo apt-get install -y y'])
    ]

    const runner = new ApplyRunner()
    const results = await runner.run(plan, {
      confirm: true,
      elevationExec: makeFakeElevationExec('run'),
      isPkexecAvailable: () => false
    })

    expect(ran).toBe(true)
    expect(results[0].status).toBe('ok')
    expect(results[1].status).toBe('skipped')
    expect(results[1].detail).toContain('pkexec 없음')
  })

  it('executes privileged actions for real through the elevation exec when pkexec is available', async () => {
    // "sudo "가 벗겨진 뒤 실제로 실행되는 명령이라 apt-get 같은 진짜 시스템
    // 변경 명령이 아니라 항상 성공하는 무해한 명령을 쓴다 (fake exec의 "run"
    // 모드는 실제로 셸을 실행한다).
    const plan = [privilegedAction('harmless no-op', ['sudo true'])]

    const runner = new ApplyRunner()
    const events: unknown[] = []
    runner.on('action_start', (e) => events.push({ type: 'action_start', ...e }))
    runner.on('action_done', (e) => events.push({ type: 'action_done', ...e }))

    const results = await runner.run(plan, {
      confirm: true,
      elevationExec: makeFakeElevationExec('run'),
      isPkexecAvailable: () => true
    })

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
    expect(events.some((e) => (e as { type: string }).type === 'action_start')).toBe(true)
    expect(events.some((e) => (e as { type: string }).type === 'action_done')).toBe(true)
  })

  it('rolls a multi-command privileged action up to "failed" if any of its commands fail', async () => {
    // 두 번째 명령이 실패하는 걸 흉내내려면 셸에서 실제로 실패하는 명령을 쓴다.
    const action: PlanAction = {
      capability: 'packages',
      summary: 'apt source restore',
      commands: ['true', 'false'],
      privileged: true,
      run: async () => ({ ok: true, detail: '' })
    }
    const runner = new ApplyRunner()
    const results = await runner.run([action], {
      confirm: true,
      elevationExec: makeFakeElevationExec('run'),
      isPkexecAvailable: () => true
    })

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('failed')
  })

  it('reports dismissed auth as skipped with a clear reason', async () => {
    const plan = [privilegedAction('apt install foo', ['sudo apt-get install -y foo'])]
    const runner = new ApplyRunner()
    const results = await runner.run(plan, {
      confirm: true,
      elevationExec: makeFakeElevationExec('dismiss'),
      isPkexecAvailable: () => true
    })
    expect(results[0].status).toBe('skipped')
    expect(results[0].detail).toContain('관리자 인증이 취소됨')
  })

  it('cancel() before run() skips both unprivileged and privileged phases as not-run, reflected in summary.cancelled', async () => {
    let ran = false
    const plan = [
      unprivilegedAction('link x', () => (ran = true)),
      privilegedAction('apt install y', ['sudo apt-get install -y y'])
    ]

    const runner = new ApplyRunner()
    let summary: { ok: number; failed: number; skipped: number; cancelled: number } | null = null
    runner.on('summary', (s) => (summary = s))
    runner.cancel()

    const results = await runner.run(plan, {
      confirm: true,
      elevationExec: makeFakeElevationExec('run'),
      isPkexecAvailable: () => true
    })

    expect(ran).toBe(false)
    expect(results.every((r) => r.status === 'not-run')).toBe(true)
    expect(summary).toEqual({ ok: 0, failed: 0, skipped: 0, cancelled: 2 })
  })
})
