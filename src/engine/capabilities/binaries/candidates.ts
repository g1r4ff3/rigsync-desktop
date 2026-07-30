/**
 * "동기화 항목" 화면의 binaries 그룹 — fonts/appimage capability와 같은
 * shape(SyncItemGroup)를 쓴다. managed = manifest에 있는 도구 이름, unmanaged
 * = 레지스트리로 식별됐지만 manifest엔 없는 것. 레지스트리에 없는 실행파일
 * (사용자 스크립트 등)은 여기 전혀 나타나지 않는다(fonts의 동일 계약 —
 * groupInstalledBinaries가 애초에 unresolvedFiles로 분리해 둔다).
 */
import type { RigsyncContext } from '../../context'
import { readIgnoreSet } from '../../ignore'
import { effectiveLayer } from '../../manifest'
import { isSubscribed, readSelectionFilter } from '../../selection'
import type { SyncItemGroup } from '../../syncItems'
import { BINARIES_KEY_FIELDS, BINARIES_LAYER } from './constants'
import { groupInstalledBinaries } from './scan'
import type { BinaryEntry } from './types'

export async function buildBinariesSyncGroup(ctx: RigsyncContext): Promise<SyncItemGroup | null> {
  const ignore = readIgnoreSet(ctx, 'binaries', 'names')
  const manifest =
    (effectiveLayer(ctx, BINARIES_LAYER, BINARIES_KEY_FIELDS).binary as
      BinaryEntry[] | undefined) ?? []
  const managedSet = new Set(manifest.map((e) => e.name))
  const { resolvedByName } = groupInstalledBinaries(ctx)
  const names = [...new Set([...managedSet, ...resolvedByName.keys()])].sort()
  if (names.length === 0) return null

  // WS2("창고 모델" 구독): 목록에서 빼지 않고 부착만 한다.
  const selection = readSelectionFilter(ctx, 'binaries')

  return {
    capability: 'binaries',
    title: 'binaries',
    items: names.map((name) => {
      const files = resolvedByName.get(name)
      return {
        key: name,
        label: name,
        managed: managedSet.has(name),
        ignored: ignore.has(name),
        // 이 머신에 실제로 설치돼 있어야만(resolvedByName에 잡혀야만) 알 수
        // 있다 -- manifest엔 있지만 이 머신엔 없는 항목은 description이 없다.
        description: files ? `${files.join(', ')} 설치됨` : undefined,
        ...(isSubscribed(selection, name) ? {} : { subscribed: false })
      }
    })
  }
}
