import { describe, expect, it } from 'vitest'
import {
  captureReportCopy,
  describeSyncItemState,
  formatSyncItemStateSummary,
  isFollowerToggleDisabled,
  pendingChangesCopy,
  shouldShowPendingCaptureBanner,
  syncItemStateCopy,
  toggleDisabledReason,
  detectionOnlyDisabledReason,
  followerToggleDisabledReason,
  bulkSubscribeCopy,
  registerActionCopy,
  subscribeToggleCopy,
  unregisterActionCopy
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

  it('follower의 pending-add는 라벨까지 "manifest에 없음"으로 바뀐다 — 실사용 실패 + F1 거짓 단정 재현 방지', () => {
    // refactor-spec-v0.2 F1 후속: 구 라벨 "이 머신에만 있음"은 follower가 알 수
    // 없는 단정이라(reference에도 있는데 baseline이 삼킨 실사고에서 거짓)
    // "manifest에 없음"으로 바뀌었다 — 판단 원칙 3 "화면은 머신이 아는 것만".
    const result = describeSyncItemState('pending-add', 'follower')
    expect(result.label).toBe('manifest에 없음')
    expect(result.label).not.toBe(syncItemStateCopy['pending-add'].label)
    // "추가 예정"(밀린 할 일로 오독됐던 문구)도, "이 머신에만"(알 수 없는
    // 단정)도 어떤 형태로도 다시 나오면 안 된다.
    expect(result.label).not.toContain('추가 예정')
    expect(result.label).not.toContain('이 머신에만')
    expect(result.description).not.toContain('이 머신에만')
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

  it('follower 집계는 같은 수치에 "manifest에 없음"을 쓴다 — "전체: 동기화 중 26 · 추가 예정 99" 재발 방지', () => {
    const summary = formatSyncItemStateSummary(counts, 'follower')
    expect(summary).toContain('manifest에 없음 99')
    expect(summary).not.toContain('추가 예정')
    expect(summary).not.toContain('이 머신에만')
    expect(summary).toContain('동기화 중 26')
  })

  it('apt-distro 그룹 집계에는 "배포판 기본" 카운트가 붙는다 (있을 때만)', () => {
    const summary = formatSyncItemStateSummary({ ...counts, distroDefault: 28 }, 'reference')
    expect(summary).toContain('배포판 기본 28')
    const without = formatSyncItemStateSummary(counts, 'reference')
    expect(without).not.toContain('배포판 기본')
  })

  it('0건인 상태는 생략한다', () => {
    const summary = formatSyncItemStateSummary(
      { synced: 0, pendingAdd: 0, pendingRemove: 0, excluded: 0 },
      'reference'
    )
    expect(summary).toBe('')
  })

  // v0.1.20 4번: appimage 전용 "추가 불가" 상태 — 있을 때만 보이고, pendingAdd와는
  // 별개 카운트라 서로의 값에 섞이지 않는다.
  it('unresolvable 카운트가 있으면 "추가 불가 N"이 붙는다 (있을 때만)', () => {
    const summary = formatSyncItemStateSummary({ ...counts, unresolvable: 3 }, 'reference')
    expect(summary).toContain('추가 불가 3')
    const without = formatSyncItemStateSummary(counts, 'reference')
    expect(without).not.toContain('추가 불가')
  })
})

describe('syncItemStateCopy.unresolvable / describeSyncItemState', () => {
  it('role과 무관하게 같은 설명을 쓴다 — capture 가능 여부는 role이 아니라 gearlever.conf 상태의 문제', () => {
    expect(describeSyncItemState('unresolvable', 'reference')).toEqual(
      syncItemStateCopy.unresolvable
    )
    expect(describeSyncItemState('unresolvable', 'follower')).toEqual(
      syncItemStateCopy.unresolvable
    )
  })

  it('설명에 해소 방법(Gear Lever)이 포함된다', () => {
    expect(syncItemStateCopy.unresolvable.description).toContain('Gear Lever')
  })
})

describe('pendingChangesCopy.bannerItemNames', () => {
  it('5개 이하면 전부 그대로 나열한다', () => {
    expect(pendingChangesCopy.bannerItemNames(['a', 'b', 'c'])).toBe('a, b, c')
  })

  it('5개를 넘으면 앞 5개 + "외 M건"으로 접는다', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(pendingChangesCopy.bannerItemNames(names)).toBe('a, b, c, d, e 외 2건')
  })

  it('빈 배열이면 빈 문자열', () => {
    expect(pendingChangesCopy.bannerItemNames([])).toBe('')
  })
})

describe('captureReportCopy', () => {
  it('changesHeading은 신규·갱신을 나눠 보여준다', () => {
    expect(captureReportCopy.changesHeading(3, 2)).toBe('반영 5건 (신규 3 · 갱신 2)')
  })

  it('errorsHeading은 실패한 capability 수를 말한다', () => {
    expect(captureReportCopy.errorsHeading(2)).toContain('2')
  })
})

describe('shouldShowPendingCaptureBanner', () => {
  it('보류 건수가 있으면 role과 무관하게 배너를 띄운다', () => {
    expect(shouldShowPendingCaptureBanner(1)).toBe(true)
  })

  // WS3("창고 모델" 전 머신 저작): 배치 A(WS5)로 follower도 git 저작 경로를
  // 갖춰 개별 등록(register)이 가능해졌다 — 더는 "Capture를 실행하세요"가
  // follower에 불가능한 행동 지시가 아니므로(각 행의 Register 버튼으로 대체
  // 가능) follower도 배너를 띄운다(내용은 registerInsteadText로 갈린다).
  it('follower도 보류 건수가 있으면 배너를 띄운다(개별 등록 안내로 대체)', () => {
    expect(shouldShowPendingCaptureBanner(99)).toBe(true)
  })

  it('보류 건수가 0이면 배너를 띄우지 않는다', () => {
    expect(shouldShowPendingCaptureBanner(0)).toBe(false)
  })
})

describe('pendingChangesCopy.registerInsteadText', () => {
  it('개수와 함께 개별 등록 안내를 만든다', () => {
    expect(pendingChangesCopy.registerInsteadText(3)).toBe(
      '3개 항목을 개별 등록할 수 있습니다 — 각 행의 Register 버튼을 누르세요.'
    )
  })
})

describe('subscribeToggleCopy / registerActionCopy / unregisterActionCopy / bulkSubscribeCopy', () => {
  it('subscribeToggleCopy는 라벨과 on/off 툴팁을 제공한다', () => {
    expect(subscribeToggleCopy.label).toBe('Subscribe')
    expect(subscribeToggleCopy.onTooltip).toMatch(/구독합니다/)
    expect(subscribeToggleCopy.offTooltip).toMatch(/구독하지 않습니다/)
  })

  it('registerActionCopy 라벨은 영어(버튼), 부제는 한국어(언어 정책)', () => {
    expect(registerActionCopy.label).toBe('Register')
    expect(registerActionCopy.subtitle).toMatch(/창고에 등록/)
  })

  it('unregisterActionCopy는 기존 Delete와 구분되는 라벨·로컬 불간섭 안내를 담는다', () => {
    expect(unregisterActionCopy.label).toBe('Remove from catalog')
    expect(unregisterActionCopy.label).not.toBe('Delete')
    expect(unregisterActionCopy.localFilesNotice).toMatch(/로컬 파일·설치는 절대 건드리지 않습니다/)
    expect(unregisterActionCopy.dialogTitle('zsh')).toBe('Remove "zsh" from catalog?')
  })

  it('unregisterActionCopy.subscribersFound/noSubscribersFound/unlistableSubscribersNotice — 정직한 한계 안내', () => {
    expect(unregisterActionCopy.subscribersFound(['lab-main', 'lab-2'])).toBe(
      '선택 구독 머신 중 구독: lab-main, lab-2'
    )
    expect(unregisterActionCopy.noSubscribersFound).toMatch(/구독 중인 곳은 없습니다/)
    expect(unregisterActionCopy.unlistableSubscribersNotice).toMatch(/열거할 수 없습니다/)
  })

  it('bulkSubscribeCopy는 all-on/all-off/mixed 세 상태의 버튼 문구를 제공한다', () => {
    expect(bulkSubscribeCopy.allOn.label).toBe('Unsubscribe all')
    expect(bulkSubscribeCopy.allOff.label).toBe('Subscribe all')
    expect(bulkSubscribeCopy.mixed.label).toBe('Subscribe all')
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
