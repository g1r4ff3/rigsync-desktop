import { describe, expect, it } from 'vitest'
import {
  describeSyncItemState,
  formatSyncItemStateSummary,
  isFollowerToggleDisabled,
  shouldShowPendingCaptureBanner,
  syncItemStateCopy,
  toggleDisabledReason,
  detectionOnlyDisabledReason,
  followerToggleDisabledReason
} from './copy'

/**
 * R8 (Candidates 화면 explainability 재작업) — 실사용 실패 수정 검증.
 * 코디네이터 지시: "role별 배너 노출 여부·상태 라벨 분기·follower 토글
 * 비활성에 유닛/렌더 로직 테스트 추가". 이 repo는 renderer 컴포넌트 렌더
 * 테스트 인프라(jsdom/testing-library)가 없어(package.json 확인 결과 미설치)
 * 컴포넌트를 직접 마운트해 검증할 수 없다 — 대신 SyncItemsView가 그대로
 * 소비하는 순수 결정 함수(copy.ts)를 여기서 직접 검증한다: 컴포넌트는 이
 * 함수들의 반환값을 그대로 렌더할 뿐이라 로직 커버리지는 동일하다.
 */

describe('describeSyncItemState', () => {
  it('reference에서는 기본 syncItemStateCopy를 그대로 돌려준다', () => {
    expect(describeSyncItemState('pending-add', 'reference')).toEqual(
      syncItemStateCopy['pending-add']
    )
    expect(describeSyncItemState('synced', 'reference')).toEqual(syncItemStateCopy.synced)
    expect(describeSyncItemState('pending-remove', 'reference')).toEqual(
      syncItemStateCopy['pending-remove']
    )
    expect(describeSyncItemState('excluded', 'reference')).toEqual(syncItemStateCopy.excluded)
  })

  it('role이 없을 때도(로딩 중 등) reference와 동일하게 취급한다', () => {
    expect(describeSyncItemState('pending-add', undefined)).toEqual(
      syncItemStateCopy['pending-add']
    )
  })

  it('follower의 pending-add는 라벨까지 "이 머신에만 있음"으로 바뀐다 — 실사용 실패 재현 방지', () => {
    const result = describeSyncItemState('pending-add', 'follower')
    expect(result.label).toBe('이 머신에만 있음')
    expect(result.label).not.toBe(syncItemStateCopy['pending-add'].label)
    // "추가 예정"(밀린 할 일로 오독됐던 문구)이 어떤 형태로도 다시 나오면 안 된다.
    expect(result.label).not.toContain('추가 예정')
    expect(result.description).toContain('reference')
    expect(result.description).not.toContain('다음 Capture')
  })

  it('follower의 pending-remove/excluded는 라벨은 유지하되 주어를 reference로 명시한다', () => {
    const pendingRemove = describeSyncItemState('pending-remove', 'follower')
    expect(pendingRemove.label).toBe(syncItemStateCopy['pending-remove'].label)
    expect(pendingRemove.description).toContain('reference')

    const excluded = describeSyncItemState('excluded', 'follower')
    expect(excluded.label).toBe(syncItemStateCopy.excluded.label)
    expect(excluded.description).toContain('reference')
  })

  it('follower라도 synced/detected는 role과 무관한 사실이라 문구가 그대로다', () => {
    expect(describeSyncItemState('synced', 'follower')).toEqual(syncItemStateCopy.synced)
    expect(describeSyncItemState('detected', 'follower')).toEqual(syncItemStateCopy.detected)
  })
})

describe('formatSyncItemStateSummary', () => {
  const counts = { synced: 26, pendingAdd: 99, pendingRemove: 1, excluded: 2 }

  it('reference 집계에는 "추가 예정"이 나온다', () => {
    const summary = formatSyncItemStateSummary(counts, 'reference')
    expect(summary).toContain('추가 예정 99')
  })

  it('follower 집계는 같은 수치에 "이 머신에만 있음"을 쓴다 — "전체: 동기화 중 26 · 추가 예정 99" 재발 방지', () => {
    const summary = formatSyncItemStateSummary(counts, 'follower')
    expect(summary).toContain('이 머신에만 있음 99')
    expect(summary).not.toContain('추가 예정')
    expect(summary).toContain('동기화 중 26')
  })

  it('0건인 상태는 생략한다', () => {
    const summary = formatSyncItemStateSummary(
      { synced: 0, pendingAdd: 0, pendingRemove: 0, excluded: 0 },
      'reference'
    )
    expect(summary).toBe('')
  })
})

describe('shouldShowPendingCaptureBanner', () => {
  it('reference는 보류 건수가 있으면 배너를 띄운다', () => {
    expect(shouldShowPendingCaptureBanner(1, 'reference')).toBe(true)
  })

  it('follower는 보류 건수가 있어도 배너를 띄우지 않는다 — capture 불가에 "Capture를 실행하세요"는 불가능한 행동 지시', () => {
    expect(shouldShowPendingCaptureBanner(99, 'follower')).toBe(false)
  })

  it('보류 건수가 0이면 role과 무관하게 배너를 띄우지 않는다', () => {
    expect(shouldShowPendingCaptureBanner(0, 'reference')).toBe(false)
    expect(shouldShowPendingCaptureBanner(0, 'follower')).toBe(false)
  })

  it('role이 아직 없을 때(로딩 중)는 reference와 동일하게 취급한다', () => {
    expect(shouldShowPendingCaptureBanner(1, undefined)).toBe(true)
  })
})

describe('isFollowerToggleDisabled / toggleDisabledReason', () => {
  it('reference·비-detectionOnly면 비활성이 아니다', () => {
    expect(isFollowerToggleDisabled('reference')).toBe(false)
    expect(toggleDisabledReason(false, 'reference')).toBeUndefined()
  })

  it('follower면 detectionOnly 여부와 무관하게 토글이 비활성이다', () => {
    expect(isFollowerToggleDisabled('follower')).toBe(true)
    expect(toggleDisabledReason(false, 'follower')).toBe(followerToggleDisabledReason)
  })

  it('detectionOnly 그룹은 role과 무관하게 detectionOnly 사유가 우선한다', () => {
    expect(toggleDisabledReason(true, 'reference')).toBe(detectionOnlyDisabledReason)
    expect(toggleDisabledReason(true, 'follower')).toBe(detectionOnlyDisabledReason)
  })
})
