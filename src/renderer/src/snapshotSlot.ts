/**
 * 앱 수준 스냅샷 스토어의 범용 슬롯 — 성능 리팩토링 2라운드(v0.1.17) 4단계.
 * App.tsx는 활성 탭만 마운트하므로(`tab === 'diff' ? <DiffView/> : ...`)
 * 탭을 벗어났다 돌아올 때마다 뷰가 리마운트되며 v0.1.16의 스켈레톤부터
 * 다시 보여줬다 — 매 탭 전환이 새 IPC 왕복을 기다리는 체감이었다. 이 슬롯이
 * 그걸 "스토어에 있으면 즉시 렌더 + 백그라운드 재검증(stale-while-
 * revalidate)"으로 바꾼다: 스켈레톤은 스토어에 정말 아무 것도 없는 첫 로드
 * 에만 나오고, 이후 재방문은 이전 데이터를 즉시 보여주며 조용히 새로고침한다.
 *
 * React 외부 상태이므로 `useSyncExternalStore`(React 18+ 내장 API — 새 상태
 * 라이브러리 도입이 아니다, CLAUDE.md "새 상태 라이브러리 도입 금지" 제약
 * 준수)로 구독한다. 도메인별(diff/syncItems/doctor) 싱글턴 Slot 하나씩을
 * 각 `*SnapshotStore.ts` 모듈이 만들어 쓴다 — 이 파일은 그 공용 뼈대만
 * 제공하는 프레임워크 무관 순수 로직이라(React import는 훅 하나뿐) node
 * 환경에서 그대로 단위 테스트한다.
 */
import { useCallback, useSyncExternalStore } from 'react'

export interface SlotSnapshot<T> {
  readonly data: T | null
  readonly error: string | null
  /** data가 아직 없는 첫 로드 중에만 true — 스켈레톤 트리거. */
  readonly loading: boolean
  /** data는 있고 백그라운드에서 새로 받는 중 — "갱신 중" 미세 표시 트리거. */
  readonly revalidating: boolean
}

type Listener = () => void

export class Slot<T> {
  private data: T | null = null
  private error: string | null = null
  private loading = false
  private revalidating = false
  private inFlight: Promise<T> | null = null
  private readonly listeners = new Set<Listener>()
  private snapshot: SlotSnapshot<T> = this.buildSnapshot()

  private buildSnapshot(): SlotSnapshot<T> {
    return {
      data: this.data,
      error: this.error,
      loading: this.loading,
      revalidating: this.revalidating
    }
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot()
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): SlotSnapshot<T> => this.snapshot

  /**
   * data가 없으면 loading, 있으면 revalidating으로 표시하며 fetcher를 부른다
   * — 이전 data는 완료 전까지 그대로 남아있다(스켈레톤 대신 이전 화면
   * 유지가 핵심). 이미 진행 중인 fetch가 있으면 그걸 그대로 반환한다
   * (중복 IPC 방지 — 워커의 read 요청 병합(requestScheduler.ts)과 같은
   * 취지를 렌더러 쪽에서도 지킨다).
   */
  revalidate(fetcher: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.inFlight
    this.loading = this.data === null
    this.revalidating = this.data !== null
    this.emit()
    const promise = fetcher()
      .then((result) => {
        this.data = result
        this.error = null
        return result
      })
      .catch((err: unknown) => {
        this.error = err instanceof Error ? err.message : String(err)
        throw err
      })
      .finally(() => {
        this.loading = false
        this.revalidating = false
        this.inFlight = null
        this.emit()
      })
    this.inFlight = promise
    return promise
  }

  /**
   * 변조 응답이 이미 최신 데이터를 담고 있을 때(예: toggleIgnore/moveEntry가
   * 새 `SyncItemGroupDto[]`를 바로 반환) — 재조회 없이 스토어를 바로 갱신한다.
   */
  set(value: T): void {
    this.data = value
    this.error = null
    this.loading = false
    this.revalidating = false
    this.emit()
  }
}

/** Slot 하나를 구독하는 훅 — 값이 바뀔 때만 리렌더된다(useSyncExternalStore 표준 패턴). */
export function useSlot<T>(slot: Slot<T>): SlotSnapshot<T> {
  const subscribe = useCallback(
    (onStoreChange: () => void) => slot.subscribe(onStoreChange),
    [slot]
  )
  const getSnapshot = useCallback(() => slot.getSnapshot(), [slot])
  return useSyncExternalStore(subscribe, getSnapshot)
}
