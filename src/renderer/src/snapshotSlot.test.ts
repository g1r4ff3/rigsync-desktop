import { describe, expect, it, vi } from 'vitest'
import { Slot } from './snapshotSlot'

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Slot', () => {
  it('초기 스냅샷은 data/error 없음, loading/revalidating false다', () => {
    const slot = new Slot<number>()
    expect(slot.getSnapshot()).toEqual({
      data: null,
      error: null,
      loading: false,
      revalidating: false
    })
  })

  it('data가 없는 첫 revalidate는 loading을 true로, 완료 후 data를 채운다', async () => {
    const slot = new Slot<number>()
    const snapshots: Array<ReturnType<typeof slot.getSnapshot>> = []
    slot.subscribe(() => snapshots.push(slot.getSnapshot()))

    const promise = slot.revalidate(async () => {
      await tick()
      return 42
    })
    expect(slot.getSnapshot().loading).toBe(true)
    expect(slot.getSnapshot().revalidating).toBe(false)

    await promise
    expect(slot.getSnapshot()).toEqual({
      data: 42,
      error: null,
      loading: false,
      revalidating: false
    })
  })

  it('data가 이미 있으면 revalidate 중에도 이전 data를 유지하며 revalidating만 true다 (SWR)', async () => {
    const slot = new Slot<number>()
    await slot.revalidate(async () => 1)
    expect(slot.getSnapshot().data).toBe(1)

    const promise = slot.revalidate(async () => {
      await tick()
      return 2
    })
    // 재검증 중: 이전 데이터가 그대로 보인다 (스켈레톤 없음).
    expect(slot.getSnapshot()).toMatchObject({ data: 1, loading: false, revalidating: true })

    await promise
    expect(slot.getSnapshot()).toMatchObject({ data: 2, loading: false, revalidating: false })
  })

  it('진행 중인 revalidate가 있으면 같은 Promise를 공유한다 (fetcher 중복 호출 방지)', async () => {
    const slot = new Slot<number>()
    const fetcher = vi.fn(async () => {
      await tick()
      return 7
    })
    const [a, b] = await Promise.all([slot.revalidate(fetcher), slot.revalidate(fetcher)])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(a).toBe(7)
    expect(b).toBe(7)
  })

  it('완료 후 새 revalidate 호출은 fetcher를 다시 부른다', async () => {
    const slot = new Slot<number>()
    const fetcher = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)
    await slot.revalidate(fetcher)
    await slot.revalidate(fetcher)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(slot.getSnapshot().data).toBe(2)
  })

  it('fetcher 실패 시 error를 기록하고 이전 data는 그대로 남긴다', async () => {
    const slot = new Slot<number>()
    await slot.revalidate(async () => 1)
    await expect(
      slot.revalidate(async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(slot.getSnapshot()).toMatchObject({
      data: 1,
      error: 'boom',
      loading: false,
      revalidating: false
    })
  })

  it('set()은 fetch 없이 즉시 data를 교체한다 (변조 응답 재사용)', () => {
    const slot = new Slot<string[]>()
    slot.set(['a', 'b'])
    expect(slot.getSnapshot()).toEqual({
      data: ['a', 'b'],
      error: null,
      loading: false,
      revalidating: false
    })
  })

  it('subscribe 해제 후에는 알림을 받지 않는다', async () => {
    const slot = new Slot<number>()
    const listener = vi.fn()
    const unsubscribe = slot.subscribe(listener)
    unsubscribe()
    await slot.revalidate(async () => 1)
    expect(listener).not.toHaveBeenCalled()
  })
})
