import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DriftSummary } from '../engine/drift'
import { createDriftCheckScheduler } from './scheduler'

function makeSummary(total: number, hash: string, checkedAt = 't'): DriftSummary {
  return { checkedAt, total, byCapability: total > 0 ? { apt: total } : {}, hash }
}

describe('createDriftCheckScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not run any check before the first-check delay elapses', async () => {
    const runCheck = vi.fn(async () => makeSummary(0, 'h0'))
    const notify = vi.fn()
    const scheduler = createDriftCheckScheduler({
      runCheck,
      notify,
      intervalHours: 6,
      firstCheckDelayMs: 5 * 60 * 1000
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1)
    expect(runCheck).not.toHaveBeenCalled()
    scheduler.stop()
  })

  it('runs the first check exactly once after the delay, and repeats on the configured interval', async () => {
    const runCheck = vi.fn(async () => makeSummary(0, 'h0'))
    const notify = vi.fn()
    const scheduler = createDriftCheckScheduler({
      runCheck,
      notify,
      intervalHours: 6,
      firstCheckDelayMs: 1000
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(runCheck).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(runCheck).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(runCheck).toHaveBeenCalledTimes(3)
    scheduler.stop()
  })

  it('intervalHours=0 disables the scheduler entirely (no first check either)', async () => {
    const runCheck = vi.fn(async () => makeSummary(1, 'h0'))
    const notify = vi.fn()
    const scheduler = createDriftCheckScheduler({
      runCheck,
      notify,
      intervalHours: 0,
      firstCheckDelayMs: 1000
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(runCheck).not.toHaveBeenCalled()
  })

  it('stop() cancels a pending first check', async () => {
    const runCheck = vi.fn(async () => makeSummary(0, 'h0'))
    const scheduler = createDriftCheckScheduler({
      runCheck,
      notify: vi.fn(),
      intervalHours: 6,
      firstCheckDelayMs: 1000
    })
    scheduler.start()
    scheduler.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runCheck).not.toHaveBeenCalled()
  })

  it('notifies on the none -> something transition but not on repeated identical drift', async () => {
    let call = 0
    const results = [makeSummary(0, 'h0'), makeSummary(2, 'h1'), makeSummary(2, 'h1')]
    const runCheck = vi.fn(async () => results[call++])
    const notify = vi.fn()
    const scheduler = createDriftCheckScheduler({
      runCheck,
      notify,
      intervalHours: 6,
      firstCheckDelayMs: 1000
    })
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000) // check 1: total=0, no notify
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000) // check 2: total=2, notify (transition)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000) // check 3: same content, no re-notify
    expect(runCheck).toHaveBeenCalledTimes(3)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith(results[1])
    scheduler.stop()
  })

  it('runNow() runs immediately regardless of the schedule and updates getLastResult()', async () => {
    const runCheck = vi.fn(async () => makeSummary(3, 'h1', 'now'))
    const notify = vi.fn()
    const scheduler = createDriftCheckScheduler({ runCheck, notify, intervalHours: 6 })
    expect(scheduler.getLastResult()).toBeNull()
    await scheduler.runNow()
    expect(runCheck).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(scheduler.getLastResult()).toEqual(makeSummary(3, 'h1', 'now'))
  })

  it('a runCheck error is routed to onError and does not throw or notify', async () => {
    const runCheck = vi.fn(async () => {
      throw new Error('boom')
    })
    const notify = vi.fn()
    const onError = vi.fn()
    const scheduler = createDriftCheckScheduler({ runCheck, notify, intervalHours: 6, onError })
    await scheduler.runNow()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
    expect(scheduler.getLastResult()).toBeNull()
  })

  it('start() restarts cleanly if called twice (no duplicate timers)', async () => {
    const runCheck = vi.fn(async () => makeSummary(0, 'h0'))
    const scheduler = createDriftCheckScheduler({
      runCheck,
      notify: vi.fn(),
      intervalHours: 6,
      firstCheckDelayMs: 1000
    })
    scheduler.start()
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(runCheck).toHaveBeenCalledTimes(1)
    scheduler.stop()
  })
})
