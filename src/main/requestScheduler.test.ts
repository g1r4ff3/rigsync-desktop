import { describe, expect, it, vi } from 'vitest'
import { ReadWriteLock, RequestScheduler } from './requestScheduler'

/** 마이크로태스크 큐가 비워질 시간을 준다 — 락 진입 여부를 관찰할 때 쓴다. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ReadWriteLock', () => {
  it('읽기끼리는 동시 실행을 허용한다', async () => {
    const lock = new ReadWriteLock()
    let concurrentReads = 0
    let maxConcurrent = 0
    const runRead = (): Promise<void> =>
      lock.withRead(async () => {
        concurrentReads++
        maxConcurrent = Math.max(maxConcurrent, concurrentReads)
        await tick()
        concurrentReads--
      })
    await Promise.all([runRead(), runRead(), runRead()])
    expect(maxConcurrent).toBe(3)
  })

  it('쓰기는 진행 중인 읽기가 전부 끝난 뒤에야 진입한다', async () => {
    const lock = new ReadWriteLock()
    const events: string[] = []
    let releaseRead!: () => void
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })

    const readTask = lock.withRead(async () => {
      events.push('read-start')
      await readGate
      events.push('read-end')
    })

    await tick() // read가 락에 진입할 시간을 준다.

    const writeTask = lock.withWrite(async () => {
      events.push('write-start')
      events.push('write-end')
    })

    await tick()
    expect(events).toEqual(['read-start']) // write는 아직 진입 못 함.

    releaseRead()
    await Promise.all([readTask, writeTask])
    expect(events).toEqual(['read-start', 'read-end', 'write-start', 'write-end'])
  })

  it('쓰기가 대기 중이면 그 뒤에 도착한 읽기는 쓰기 완료까지 큐잉된다', async () => {
    const lock = new ReadWriteLock()
    const events: string[] = []
    let releaseWrite!: () => void
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })

    const writeTask = lock.withWrite(async () => {
      events.push('write-start')
      await writeGate
      events.push('write-end')
    })
    await tick()

    const readTask = lock.withRead(async () => {
      events.push('read-start')
      events.push('read-end')
    })
    await tick()
    expect(events).toEqual(['write-start']) // 읽기는 아직 큐잉 상태.

    releaseWrite()
    await Promise.all([writeTask, readTask])
    expect(events).toEqual(['write-start', 'write-end', 'read-start', 'read-end'])
  })

  it('쓰기끼리는 완전 배타적이다', async () => {
    const lock = new ReadWriteLock()
    let concurrentWrites = 0
    let maxConcurrent = 0
    const runWrite = (): Promise<void> =>
      lock.withWrite(async () => {
        concurrentWrites++
        maxConcurrent = Math.max(maxConcurrent, concurrentWrites)
        await tick()
        concurrentWrites--
      })
    await Promise.all([runWrite(), runWrite(), runWrite()])
    expect(maxConcurrent).toBe(1)
  })
})

describe('RequestScheduler', () => {
  it('read로 분류된 메서드는 동시에 실행된다', async () => {
    const scheduler = new RequestScheduler({
      classify: () => 'read',
      coalesce: () => false
    })
    let concurrent = 0
    let maxConcurrent = 0
    const exec = async (): Promise<string> => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await tick()
      concurrent--
      return 'ok'
    }
    await Promise.all([
      scheduler.run('diffPackages', {}, exec),
      scheduler.run('diffPackages', { a: 1 }, exec) // args 달라서 병합 안 됨(coalesce=false라 무관)
    ])
    expect(maxConcurrent).toBe(2)
  })

  it('write로 분류된 메서드는 read와 겹치지 않는다', async () => {
    const scheduler = new RequestScheduler({
      classify: (m) => (m === 'capturePackages' ? 'write' : 'read'),
      coalesce: () => false
    })
    const events: string[] = []
    let releaseRead!: () => void
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })

    const readPromise = scheduler.run('diffPackages', {}, async () => {
      events.push('read-start')
      await readGate
      events.push('read-end')
    })
    await tick()

    const writePromise = scheduler.run('capturePackages', { dryRun: true }, async () => {
      events.push('write-start')
      events.push('write-end')
    })
    await tick()
    expect(events).toEqual(['read-start'])

    releaseRead()
    await Promise.all([readPromise, writePromise])
    expect(events).toEqual(['read-start', 'read-end', 'write-start', 'write-end'])
  })

  it('unlocked 메서드는 진행 중인 write와 무관하게 즉시 실행된다 (cancelApply 시나리오)', async () => {
    const scheduler = new RequestScheduler({
      classify: (m) => (m === 'apply' ? 'write' : m === 'cancelApply' ? 'unlocked' : 'read'),
      coalesce: () => false
    })
    const events: string[] = []
    let releaseApply!: () => void
    const applyGate = new Promise<void>((resolve) => {
      releaseApply = resolve
    })

    const applyPromise = scheduler.run('apply', {}, async () => {
      events.push('apply-start')
      await applyGate
      events.push('apply-end')
    })
    await tick()

    await scheduler.run('cancelApply', {}, async () => {
      events.push('cancel-ran')
    })
    // cancelApply는 apply의 배타 락을 기다리지 않고 즉시 실행돼야 한다.
    expect(events).toEqual(['apply-start', 'cancel-ran'])

    releaseApply()
    await applyPromise
    expect(events).toEqual(['apply-start', 'cancel-ran', 'apply-end'])
  })

  it('coalesce 대상 메서드는 동일 method+args의 in-flight 요청을 같은 Promise로 병합한다', async () => {
    const scheduler = new RequestScheduler({
      classify: () => 'read',
      coalesce: () => true
    })
    const exec = vi.fn(async () => {
      await tick()
      return 'result'
    })
    const [a, b] = await Promise.all([
      scheduler.run('diffPackages', { x: 1 }, exec),
      scheduler.run('diffPackages', { x: 1 }, exec)
    ])
    expect(exec).toHaveBeenCalledTimes(1)
    expect(a).toBe('result')
    expect(b).toBe('result')
  })

  it('args가 다르면 병합하지 않는다', async () => {
    const scheduler = new RequestScheduler({
      classify: () => 'read',
      coalesce: () => true
    })
    const exec = vi.fn(async () => {
      await tick()
      return 'result'
    })
    await Promise.all([
      scheduler.run('diffPackages', { x: 1 }, exec),
      scheduler.run('diffPackages', { x: 2 }, exec)
    ])
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('args 키 순서가 달라도 같은 요청으로 병합한다 (stableStringify)', async () => {
    const scheduler = new RequestScheduler({
      classify: () => 'read',
      coalesce: () => true
    })
    const exec = vi.fn(async () => {
      await tick()
      return 'result'
    })
    await Promise.all([
      scheduler.run('diffPackages', { a: 1, b: 2 }, exec),
      scheduler.run('diffPackages', { b: 2, a: 1 }, exec)
    ])
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('coalesce=false 메서드는 동일 args라도 매번 새로 실행한다', async () => {
    const scheduler = new RequestScheduler({
      classify: () => 'write',
      coalesce: () => false
    })
    const exec = vi.fn(async () => {
      await tick()
      return 'result'
    })
    await Promise.all([
      scheduler.run('capturePackages', { dryRun: true }, exec),
      scheduler.run('capturePackages', { dryRun: true }, exec)
    ])
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('완료된 요청은 in-flight 맵에서 정리돼 다음 호출은 새로 실행된다', async () => {
    const scheduler = new RequestScheduler({
      classify: () => 'read',
      coalesce: () => true
    })
    const exec = vi.fn(async () => 'result')
    await scheduler.run('diffPackages', {}, exec)
    await scheduler.run('diffPackages', {}, exec)
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('실패한 요청도 in-flight 맵에서 정리돼 재시도를 막지 않는다', async () => {
    const scheduler = new RequestScheduler({
      classify: () => 'read',
      coalesce: () => true
    })
    const exec = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
    await expect(scheduler.run('diffPackages', {}, exec)).rejects.toThrow('boom')
    await expect(scheduler.run('diffPackages', {}, exec)).resolves.toBe('ok')
    expect(exec).toHaveBeenCalledTimes(2)
  })
})
