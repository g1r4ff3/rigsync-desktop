/**
 * WS3("창고 모델 1차" — cheerful-growing-fairy 계획) SyncItemsView가 쓰는 순수
 * 판정 로직 — 구독 Switch·그룹 단위 모두 구독/해제 버튼·Register/"Remove
 * from catalog" 버튼의 표시 조건을 컴포넌트 밖으로 뺐다(vitest는 node
 * 환경이라 .tsx를 직접 테스트할 수 없다 — 로직만 여기 .ts로 분리해 테스트한다).
 */
import {
  isPendingRegisterableCapability,
  isRegisterableCapability,
  type SyncItemGroupDto,
  type SyncItemState
} from '../../shared/ipc'

type Item = SyncItemGroupDto['items'][number]

export type SubscribeGroupState = 'all-on' | 'all-off' | 'mixed'

/**
 * managed && !ignored 항목만 구독 개념이 성립한다(engine `computeSyncItemState`
 * 우선순위와 동일 — unresolvable/pending-remove/pending-add/excluded는 구독
 * 대상이 아니다). 이 조건을 만족하는 항목의 `state`는 반드시 'synced' 아니면
 * 'not-subscribed' 둘 중 하나이므로(engine 쪽 불변식), 별도 DTO 필드 없이
 * `state`만으로 구독 여부를 그대로 읽을 수 있다.
 */
export function isSubscribeEligible(item: Pick<Item, 'managed' | 'ignored'>): boolean {
  return item.managed && !item.ignored
}

/** subscribeEligible한 항목의 현재 구독 여부 — 'not-subscribed'가 아니면 구독 중. */
export function isSubscribedOn(item: Pick<Item, 'state'>): boolean {
  return item.state !== 'not-subscribed'
}

/** 그룹 단위 "모두 구독/해제" 버튼의 3상태 — 구독 대상 항목이 하나도 없으면 null(버튼 숨김). */
export function computeSubscribeGroupState(
  items: readonly Pick<Item, 'managed' | 'ignored' | 'state'>[]
): SubscribeGroupState | null {
  const eligible = items.filter(isSubscribeEligible)
  if (eligible.length === 0) return null
  const onCount = eligible.filter(isSubscribedOn).length
  if (onCount === eligible.length) return 'all-on'
  if (onCount === 0) return 'all-off'
  return 'mixed'
}

/** 그룹 벌크 구독 토글이 대상으로 삼을 key 목록 — 구독 개념이 없는 항목(미관리·ignore됨)은 제외. */
export function subscribeEligibleKeys(
  items: readonly Pick<Item, 'key' | 'managed' | 'ignored'>[]
): string[] {
  return items.filter(isSubscribeEligible).map((i) => i.key)
}

/**
 * 클릭 시 다음에 적용할 subscribed 값 — 그룹 ignore 토글(toggleGroup)과 같은
 * 관례: 전부 켜져 있으면 전부 끄고, 그 외(전부 꺼짐/혼합)면 전부 켠다.
 */
export function nextBulkSubscribedValue(state: SubscribeGroupState): boolean {
  return state !== 'all-on'
}

/**
 * Register 버튼 표시 조건 — pending-add 또는 unresolvable 상태이고, dotfiles를
 * 제외한 발견형 capability(apt/flatpak/appimage/fonts/tools/repos)일 때만.
 * dotfiles pending-add는 이번 배치 registerEntry가 지원하지 않는 신규 경로라
 * 버튼을 아예 안 보여준다(눌러도 실패하는 버튼을 만들지 않는다).
 */
export function showsRegisterButton(
  capability: SyncItemGroupDto['capability'],
  state: SyncItemState
): boolean {
  return (
    isPendingRegisterableCapability(capability) &&
    (state === 'pending-add' || state === 'unresolvable')
  )
}

/**
 * "Remove from catalog" 보조 액션 표시 조건 — 카탈로그(manifest)에 실제로
 * 있는(managed) 항목이고, registry.ts가 그 capability의 unregister를
 * 지원할 때만(REGISTERABLE_CAPABILITIES — snap·services·settings·scheduled·
 * binaries는 대상 밖이라 이 조건 하나로 자연히 숨는다).
 */
export function showsUnregisterButton(
  capability: SyncItemGroupDto['capability'],
  managed: boolean
): boolean {
  return isRegisterableCapability(capability) && managed
}
