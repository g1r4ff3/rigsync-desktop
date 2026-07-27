/**
 * "동기화 항목" 화면(Candidates)의 services 그룹 — F2(docs/refactor-spec-v0.2.md)
 * "이 머신 전용" 전환을 dotfiles와 나란히 보여주기 위한 최소 그룹이다.
 *
 * dotfiles/apt 등과 달리 이 그룹은 unmanaged 후보 탐지·ignore를 지원하지
 * 않는다 — captureServices는 provider가 보고하는 유닛을 전부 캡처하고
 * ignore.toml을 참조하지 않는다(capture.ts 확인). 그래서 여기 나열하는
 * 항목은 항상 manifest(effective)에 있는(=이미 capture된) 유닛뿐이고, 전부
 * managed=true·ignored=false로 채운다 — engine `computeSyncItemState`가 이
 * 값들을 그대로 `synced`로 판정한다(렌더러는 별도로
 * `isIgnoreUnsupportedCapability`를 보고 Sync/Pause 컨트롤을 비활성화한다).
 */
import type { RigsyncContext } from '../../context'
import { effectiveLayer, readHostLayer } from '../../manifest'
import type { SyncItemGroup } from '../../syncItems'
import { SERVICES_KEY_FIELDS, SERVICES_LAYER } from './constants'
import type { ServicesManifest, ServiceUnitEntry } from './types'

export function buildServicesSyncGroup(ctx: RigsyncContext): SyncItemGroup | null {
  const merged = effectiveLayer(ctx, SERVICES_LAYER, SERVICES_KEY_FIELDS) as ServicesManifest
  const units = merged.unit ?? []
  if (units.length === 0) return null

  // F2: 이 머신의 host 계층에 이미 있는 유닛 — "이 머신 전용" 배지·토글의
  // 현재 상태 판정용.
  const hostNames = new Set(
    (
      ((readHostLayer(ctx, SERVICES_LAYER) as ServicesManifest).unit ?? []) as ServiceUnitEntry[]
    ).map((u) => u.name)
  )

  return {
    capability: 'services',
    title: 'services',
    items: units.map((u) => ({
      key: u.name,
      label: u.name,
      managed: true,
      ignored: false,
      hostOnly: hostNames.has(u.name)
    }))
  }
}
