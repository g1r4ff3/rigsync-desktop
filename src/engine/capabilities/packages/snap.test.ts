import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFixture, writeIgnore, type TestFixture } from '../../testFixtures'
import { readEffectivePackages } from './io'
import { captureSnap, diffSnap, planSnap } from './snap'
import { makeFakeSnapProvider } from './testHelpers'

// 케이스 출처: 구 repo rigsync.py capture_snap/diff_snap/plan_snap +
// tests/test_ignore.py TestIgnoreSnap (행동만 옮김).

describe('captureSnap / diffSnap / planSnap', () => {
  let fixture: TestFixture

  beforeEach(() => {
    fixture = makeFixture('reference')
  })

  afterEach(() => {
    fixture.cleanup()
  })

  it('reports skipped when snap is unavailable', async () => {
    const provider = makeFakeSnapProvider([], false)
    const report = await captureSnap(fixture.ctx, provider, { dryRun: false })
    expect(report.skipped).toBe(true)
  })

  it('captures installed snaps, detects classic, skips base snaps', async () => {
    const provider = makeFakeSnapProvider([
      { name: 'code', notes: 'classic' },
      { name: 'firefox', notes: '-' },
      { name: 'core22', notes: 'base' }
    ])
    const report = await captureSnap(fixture.ctx, provider, { dryRun: false })
    expect(report.added).toBe(2)

    const snap = readEffectivePackages(fixture.ctx).snap
    const names = (snap?.snap ?? []).map((s) => s.name)
    expect(names).toEqual(expect.arrayContaining(['code', 'firefox']))
    expect(names).not.toContain('core22')
    const code = (snap?.snap ?? []).find((s) => s.name === 'code')
    expect(code?.classic).toBe(true)
  })

  it('diff reports a manifested snap that is not installed', async () => {
    const provider1 = makeFakeSnapProvider([{ name: 'code', notes: 'classic' }])
    await captureSnap(fixture.ctx, provider1, { dryRun: false })

    const provider2 = makeFakeSnapProvider([]) // uninstalled since capture
    const diff = await diffSnap(fixture.ctx, provider2)
    expect(diff.toInstall.map((s) => s.name)).toEqual(['code'])
  })

  it('plan produces a privileged snap install action with --classic when applicable', async () => {
    const diff = { skipped: false, toInstall: [{ name: 'code', classic: true }], uncaptured: [] }
    const actions = planSnap(diff)
    expect(actions).toHaveLength(1)
    expect(actions[0].privileged).toBe(true)
    expect(actions[0].commands[0]).toBe('sudo snap install code --classic')
  })

  // 케이스 출처: tests/test_ignore.py TestIgnoreSnap
  it('capture and diff skip an ignored snap (test_capture_and_diff_skip_ignored_snap)', async () => {
    writeIgnore(fixture, { snap: { packages: ['firefox'] } })
    const provider = makeFakeSnapProvider([
      { name: 'code', notes: 'classic' },
      { name: 'firefox', notes: '-' }
    ])
    await captureSnap(fixture.ctx, provider, { dryRun: false })

    const snap = readEffectivePackages(fixture.ctx).snap
    const names = (snap?.snap ?? []).map((s) => s.name)
    expect(names).toContain('code')
    expect(names).not.toContain('firefox')

    const diff = await diffSnap(fixture.ctx, provider)
    expect(diff.toInstall).toEqual([])
  })

  it('removes an already-manifested ignored snap (test_capture_removes_already_manifested_ignored_snap)', async () => {
    const provider1 = makeFakeSnapProvider([{ name: 'firefox', notes: '-' }])
    await captureSnap(fixture.ctx, provider1, { dryRun: false })
    writeIgnore(fixture, { snap: { packages: ['firefox'] } })

    const provider2 = makeFakeSnapProvider([])
    await captureSnap(fixture.ctx, provider2, { dryRun: false })

    const snap = readEffectivePackages(fixture.ctx).snap
    expect(snap?.snap ?? []).toEqual([])
  })
})
